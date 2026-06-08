// X OAuth 2.0 (PKCE) コールバック (GET /api/auth/x/callback)
//
// フロー:
//   1. ログイン中ユーザーを Supabase セッションから取得
//   2. state cookie と query.state を一致確認（CSRF）
//   3. code + code_verifier を token endpoint で交換 → access_token / refresh_token
//   4. /users/me で X ユーザー情報を取得
//   5. access_token / refresh_token を ENCRYPTION_KEY で暗号化して accounts へ upsert
//   6. /dashboard/accounts?platform=x&success=1 へリダイレクト

import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import { encryptSecret, isEncryptionAvailable } from '@/lib/crypto'
import { fetchXOAuthCredentials } from '@/lib/ai/api-keys'
import { exchangeXCode, XOAuthError } from '@/lib/platforms/x-oauth'
import { getXMe } from '@/lib/platforms/x'
import { xRedirectUri } from '../route'

const X_OAUTH_STATE_COOKIE = 'x_oauth_state'
const X_OAUTH_VERIFIER_COOKIE = 'x_oauth_verifier'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://threads-auto-post-umber.vercel.app'
}

function redirectFailure(reason: string): NextResponse {
  const url = new URL('/dashboard/accounts', appUrl())
  url.searchParams.set('platform', 'x')
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

function redirectSuccess(): NextResponse {
  const url = new URL('/dashboard/accounts', appUrl())
  url.searchParams.set('platform', 'x')
  url.searchParams.set('success', '1')
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return redirectFailure('unauthorized')
  }

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const stateFromQuery = searchParams.get('state')
  const oauthError = searchParams.get('error')

  if (oauthError) {
    console.error('[x/callback] provider error', oauthError)
    return redirectFailure('provider_error')
  }
  if (!code || !stateFromQuery) {
    return redirectFailure('missing_params')
  }

  // state 検証（CSRF）+ PKCE verifier 取り出し
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(X_OAUTH_STATE_COOKIE)?.value
  const verifier = cookieStore.get(X_OAUTH_VERIFIER_COOKIE)?.value
  cookieStore.delete(X_OAUTH_STATE_COOKIE)
  cookieStore.delete(X_OAUTH_VERIFIER_COOKIE)
  if (!stateCookie || !verifier) {
    return redirectFailure('state_missing')
  }
  const a = Buffer.from(stateCookie)
  const b = Buffer.from(stateFromQuery)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return redirectFailure('state_mismatch')
  }

  // Client ID / Secret は環境変数ではなくユーザーごとに DB 保存（BYOK）。
  const { clientId, clientSecret } = await fetchXOAuthCredentials()
  if (!clientId || !clientSecret) {
    return redirectFailure('app_not_configured')
  }
  if (!isEncryptionAvailable()) {
    console.error('[x/callback] ENCRYPTION_KEY が未設定です')
    return redirectFailure('server_misconfigured')
  }

  // code → access_token / refresh_token 交換（PKCE）
  let tokens
  try {
    tokens = await exchangeXCode(clientId, clientSecret, code, xRedirectUri(), verifier)
  } catch (e) {
    console.error('[x/callback] exchange failed', e instanceof XOAuthError ? e.message : 'unknown')
    return redirectFailure('token_exchange_failed')
  }

  // 書き込みスコープ検証: アプリの App permissions が「Read」のままだと、tweet.write を要求しても
  // 付与スコープから外れ、投稿時に 403「not permitted」になる。連携時点で検知して即案内する。
  // （X が scope を返さない場合は誤ブロックを避けてフェイルオープン）
  if (tokens.scope && !tokens.scope.split(/\s+/).includes('tweet.write')) {
    console.error('[x/callback] granted scope lacks tweet.write:', tokens.scope)
    return redirectFailure('x_no_write_scope')
  }

  // X ユーザー情報（id / username / name）
  let me
  try {
    me = await getXMe({ mode: 'oauth2', accessToken: tokens.accessToken })
  } catch (e) {
    console.error('[x/callback] getXMe failed', e instanceof Error ? e.message : 'unknown')
    return redirectFailure('userinfo_failed')
  }

  const admin = createAdminClient()

  // 同じ user_id + platform=x + x_user_id があれば update、なければ insert（手動 upsert）
  const { data: existing, error: selectError } = await admin
    .from('accounts')
    .select('id')
    .eq('user_id', user.id)
    .eq('platform', 'x')
    .eq('x_user_id', me.id)
    .maybeSingle()

  if (selectError) {
    console.error('[x/callback] select existing failed', selectError.message)
    return redirectFailure('db_error')
  }

  const accessTokenEnc = encryptSecret(tokens.accessToken)
  const refreshTokenEnc = encryptSecret(tokens.refreshToken)
  const tokenExpiresAt = new Date(tokens.expiresAt).toISOString()
  const name = (me.name || me.username || 'X アカウント').slice(0, 100)

  if (existing?.id) {
    const { error: updateError } = await admin
      .from('accounts')
      .update({
        name,
        access_token: accessTokenEnc,
        x_refresh_token: refreshTokenEnc,
        token_expires_at: tokenExpiresAt,
        // 旧 OAuth1 の4キーが残っていると publisher が OAuth1 と誤判定するため明示的にクリア
        x_api_key: null,
        x_api_secret: null,
        x_access_secret: null,
        is_active: true,
      })
      .eq('id', existing.id)
    if (updateError) {
      console.error('[x/callback] update failed', updateError.message)
      return redirectFailure('db_error')
    }
  } else {
    const { error: insertError } = await admin
      .from('accounts')
      .insert({
        user_id: user.id,
        platform: 'x',
        name,
        tone: 'friendly',
        access_token: accessTokenEnc,
        x_user_id: me.id,
        x_refresh_token: refreshTokenEnc,
        token_expires_at: tokenExpiresAt,
        is_active: true,
      })
    if (insertError) {
      console.error('[x/callback] insert failed', insertError.message)
      return redirectFailure('db_error')
    }
  }

  return redirectSuccess()
}
