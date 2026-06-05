// Instagram OAuth コールバック (GET /api/auth/instagram/callback)
//
// フロー:
//   1. ログイン中ユーザーを Supabase セッションから取得
//   2. state cookie と query.state を一致確認（CSRF）
//   3. code を長期トークン＋IGユーザーID に交換
//   4. access_token は ENCRYPTION_KEY で暗号化して accounts へ upsert
//   5. /dashboard/accounts?platform=instagram&success=1 へリダイレクト
//
// 必須環境変数: INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET / ENCRYPTION_KEY
//   （任意）INSTAGRAM_REDIRECT_URI

import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import { encryptSecret, isEncryptionAvailable } from '@/lib/crypto'
import { exchangeInstagramCode, InstagramAuthError } from '@/lib/platforms/instagram'
import { instagramRedirectUri } from '../route'

const INSTAGRAM_OAUTH_STATE_COOKIE = 'instagram_oauth_state'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://threads-auto-post-umber.vercel.app'
}

function redirectFailure(reason: string): NextResponse {
  const url = new URL('/dashboard/accounts', appUrl())
  url.searchParams.set('platform', 'instagram')
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

function redirectSuccess(): NextResponse {
  const url = new URL('/dashboard/accounts', appUrl())
  url.searchParams.set('platform', 'instagram')
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
    console.error('[instagram/callback] provider error', oauthError)
    return redirectFailure('provider_error')
  }
  if (!code || !stateFromQuery) {
    return redirectFailure('missing_params')
  }

  // state 検証（CSRF）
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(INSTAGRAM_OAUTH_STATE_COOKIE)?.value
  cookieStore.delete(INSTAGRAM_OAUTH_STATE_COOKIE)
  if (!stateCookie) {
    return redirectFailure('state_missing')
  }
  const a = Buffer.from(stateCookie)
  const b = Buffer.from(stateFromQuery)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return redirectFailure('state_mismatch')
  }

  const clientId = process.env.INSTAGRAM_APP_ID
  const clientSecret = process.env.INSTAGRAM_APP_SECRET
  if (!clientId || !clientSecret) {
    console.error('[instagram/callback] INSTAGRAM_APP_ID/SECRET が未設定です')
    return redirectFailure('server_misconfigured')
  }
  if (!isEncryptionAvailable()) {
    console.error('[instagram/callback] ENCRYPTION_KEY が未設定です')
    return redirectFailure('server_misconfigured')
  }

  // code → 長期トークン＋IGユーザーID
  let result
  try {
    result = await exchangeInstagramCode(clientId, clientSecret, code, instagramRedirectUri())
  } catch (e) {
    const msg = e instanceof InstagramAuthError ? e.message : 'token_exchange_failed'
    console.error('[instagram/callback] exchange failed', msg)
    return redirectFailure('token_exchange_failed')
  }

  const admin = createAdminClient()

  // 同じ user_id + platform=instagram + instagram_user_id があれば update、なければ insert
  const { data: existing, error: selectError } = await admin
    .from('accounts')
    .select('id')
    .eq('user_id', user.id)
    .eq('platform', 'instagram')
    .eq('instagram_user_id', result.igUserId)
    .maybeSingle()

  if (selectError) {
    console.error('[instagram/callback] select existing failed', selectError.message)
    return redirectFailure('db_error')
  }

  const accessTokenEnc = encryptSecret(result.accessToken)
  const tokenExpiresAt = new Date(result.expiresAt).toISOString()
  const name = (result.username ? `@${result.username}` : 'Instagram アカウント').slice(0, 100)

  if (existing?.id) {
    const { error: updateError } = await admin
      .from('accounts')
      .update({
        name,
        access_token: accessTokenEnc,
        token_expires_at: tokenExpiresAt,
        is_active: true,
      })
      .eq('id', existing.id)
    if (updateError) {
      console.error('[instagram/callback] update failed', updateError.message)
      return redirectFailure('db_error')
    }
  } else {
    const { error: insertError } = await admin
      .from('accounts')
      .insert({
        user_id: user.id,
        platform: 'instagram',
        name,
        tone: 'friendly',
        access_token: accessTokenEnc,
        instagram_user_id: result.igUserId,
        token_expires_at: tokenExpiresAt,
        is_active: true,
      })
    if (insertError) {
      console.error('[instagram/callback] insert failed', insertError.message)
      return redirectFailure('db_error')
    }
  }

  return redirectSuccess()
}
