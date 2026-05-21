// TikTok OAuth コールバック (GET /api/auth/tiktok/callback)
//
// フロー:
//   1. ログイン中ユーザーを Supabase セッションから取得
//   2. state cookie と query.state を一致確認（CSRF）
//   3. code を TikTok の token endpoint で交換 → access_token / refresh_token / open_id
//   4. refresh_token は ENCRYPTION_KEY で暗号化して accounts へ upsert
//   5. /dashboard/accounts?platform=tiktok&success=1 へリダイレクト
//
// 必須環境変数:
//   - TIKTOK_CLIENT_KEY
//   - TIKTOK_CLIENT_SECRET
//   - TIKTOK_REDIRECT_URI (api/auth/tiktok と同一値)
//   - ENCRYPTION_KEY

import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import {
  encryptSecret,
  isEncryptionAvailable,
} from '@/lib/crypto'
import {
  exchangeTikTokCode,
  getTikTokUser,
  TikTokAuthError,
} from '@/lib/platforms/tiktok'

const TIKTOK_OAUTH_STATE_COOKIE = 'tiktok_oauth_state'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://threads-auto-post-umber.vercel.app'
}

function redirectFailure(reason: string): NextResponse {
  const url = new URL('/dashboard/accounts', appUrl())
  url.searchParams.set('platform', 'tiktok')
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

function redirectSuccess(): NextResponse {
  const url = new URL('/dashboard/accounts', appUrl())
  url.searchParams.set('platform', 'tiktok')
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
    console.error('[tiktok/callback] provider error', oauthError)
    return redirectFailure('provider_error')
  }
  if (!code || !stateFromQuery) {
    return redirectFailure('missing_params')
  }

  // state 検証（CSRF）
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(TIKTOK_OAUTH_STATE_COOKIE)?.value
  cookieStore.delete(TIKTOK_OAUTH_STATE_COOKIE)
  if (!stateCookie) {
    return redirectFailure('state_missing')
  }
  // 文字列長を揃えてからタイミング攻撃に強い比較
  const a = Buffer.from(stateCookie)
  const b = Buffer.from(stateFromQuery)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return redirectFailure('state_mismatch')
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  const redirectUri = process.env.TIKTOK_REDIRECT_URI
  if (!clientKey || !clientSecret || !redirectUri) {
    console.error('[tiktok/callback] TIKTOK_CLIENT_KEY/SECRET/REDIRECT_URI が未設定です')
    return redirectFailure('server_misconfigured')
  }

  if (!isEncryptionAvailable()) {
    // refresh_token を平文で DB に置くのを避けるため必須扱い
    console.error('[tiktok/callback] ENCRYPTION_KEY が未設定です')
    return redirectFailure('server_misconfigured')
  }

  // code → access_token / refresh_token / open_id 交換
  let exchanged
  try {
    exchanged = await exchangeTikTokCode(clientKey, clientSecret, code, redirectUri)
  } catch (e) {
    const msg = e instanceof TikTokAuthError ? e.message : 'token_exchange_failed'
    console.error('[tiktok/callback] exchange failed', msg)
    return redirectFailure('token_exchange_failed')
  }

  // 表示名取得（取れなくても致命的ではないのでフォールバックする）
  let displayName: string | undefined
  try {
    const u = await getTikTokUser({ accessToken: exchanged.accessToken })
    displayName = u.displayName
  } catch (e) {
    console.error(
      '[tiktok/callback] getTikTokUser failed (continuing)',
      e instanceof Error ? e.message : 'unknown',
    )
  }

  const admin = createAdminClient()

  // 同じ user_id + platform=tiktok + tiktok_open_id があれば update、なければ insert（手動 upsert）
  const { data: existing, error: selectError } = await admin
    .from('accounts')
    .select('id')
    .eq('user_id', user.id)
    .eq('platform', 'tiktok')
    .eq('tiktok_open_id', exchanged.openId)
    .maybeSingle()

  if (selectError) {
    console.error('[tiktok/callback] select existing failed', selectError.message)
    return redirectFailure('db_error')
  }

  const accessTokenEnc = encryptSecret(exchanged.accessToken)
  const refreshTokenEnc = encryptSecret(exchanged.refreshToken)
  const tokenExpiresAt = new Date(exchanged.expiresAt).toISOString()
  const name = displayName?.slice(0, 100) || 'TikTok アカウント'

  if (existing?.id) {
    const { error: updateError } = await admin
      .from('accounts')
      .update({
        access_token: accessTokenEnc,
        tiktok_refresh_token: refreshTokenEnc,
        token_expires_at: tokenExpiresAt,
        is_active: true,
      })
      .eq('id', existing.id)
    if (updateError) {
      console.error('[tiktok/callback] update failed', updateError.message)
      return redirectFailure('db_error')
    }
  } else {
    const { error: insertError } = await admin
      .from('accounts')
      .insert({
        user_id: user.id,
        platform: 'tiktok',
        name,
        tone: 'friendly',
        access_token: accessTokenEnc,
        tiktok_open_id: exchanged.openId,
        tiktok_refresh_token: refreshTokenEnc,
        token_expires_at: tokenExpiresAt,
        is_active: true,
      })
    if (insertError) {
      console.error('[tiktok/callback] insert failed', insertError.message)
      return redirectFailure('db_error')
    }
  }

  return redirectSuccess()
}
