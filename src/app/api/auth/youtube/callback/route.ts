// YouTube OAuth 2.0 コールバック (Google Identity)
//
// 必要な環境変数:
//   YOUTUBE_OAUTH_CLIENT_ID      Google Cloud Console の OAuth クライアント
//   YOUTUBE_OAUTH_CLIENT_SECRET
//   YOUTUBE_OAUTH_REDIRECT_URI   このルートの公開 URL と完全一致させること
//
// 流れ:
//   1. state cookie とクエリの一致を timingSafeEqual で検証
//   2. code を https://oauth2.googleapis.com/token に交換
//   3. /youtube/v3/channels?mine=true でチャンネル情報を取得
//   4. refresh_token を AES-GCM で暗号化して accounts に upsert
//   5. /dashboard/accounts?platform=youtube&success=1 にリダイレクト

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import { encryptSecret } from '@/lib/crypto'
import { getYouTubeChannel } from '@/lib/platforms/youtube'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const STATE_COOKIE = 'yt_oauth_state'
const TOKEN_REQUEST_TIMEOUT_MS = 30_000

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://threads-auto-post-umber.vercel.app'
}

function redirectWithError(reason: string): NextResponse {
  const url = new URL('/dashboard/accounts', appUrl())
  url.searchParams.set('platform', 'youtube')
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

async function exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID!
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET!
  const redirectUri = process.env.YOUTUBE_OAUTH_REDIRECT_URI!

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    // トークンエンドポイントのエラーボディは secret をエコーし得るため status のみ記録
    console.error('[youtube/callback] token exchange failed', res.status)
    throw new Error('token exchange failed')
  }
  return (await res.json()) as GoogleTokenResponse
}

export async function GET(req: NextRequest) {
  try {
    const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID
    const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET
    const redirectUri = process.env.YOUTUBE_OAUTH_REDIRECT_URI
    if (!clientId || !clientSecret || !redirectUri) {
      console.error('[youtube/callback] missing env')
      return redirectWithError('config_missing')
    }

    // 認証済みユーザー（OAuth を始めた人）に紐付ける必要がある
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return redirectWithError('not_authenticated')
    }

    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const stateQuery = url.searchParams.get('state')
    const errorParam = url.searchParams.get('error')
    if (errorParam) {
      console.warn('[youtube/callback] provider error', errorParam)
      return redirectWithError(errorParam.slice(0, 64))
    }
    if (!code || !stateQuery) {
      return redirectWithError('missing_code_or_state')
    }

    const cookieStore = await cookies()
    const stateCookie = cookieStore.get(STATE_COOKIE)?.value
    if (!stateCookie || !constantTimeStringEqual(stateCookie, stateQuery)) {
      return redirectWithError('state_mismatch')
    }
    // 使い終わった state cookie は削除
    cookieStore.delete(STATE_COOKIE)

    // 1) code → token 交換
    const token = await exchangeCodeForToken(code)
    if (!token.access_token || !token.refresh_token) {
      // prompt=consent + access_type=offline を毎回付けているので refresh_token は来るはず
      console.error('[youtube/callback] missing tokens in response')
      return redirectWithError('token_missing')
    }

    // 2) チャンネル情報を取得
    const channel = await getYouTubeChannel({ accessToken: token.access_token })

    // 3) refresh_token を暗号化（access_token は短命なので暗号化保存は任意）
    const encryptedRefresh = encryptSecret(token.refresh_token)
    const encryptedAccess = encryptSecret(token.access_token)
    const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString()

    // 4) accounts に upsert (user_id + platform + youtube_channel_id でユニーク想定)
    const admin = createAdminClient()
    const { error: upsertError } = await admin
      .from('accounts')
      .upsert(
        {
          user_id: user.id,
          platform: 'youtube',
          name: channel.title || 'YouTube Channel',
          tone: 'neutral',
          access_token: encryptedAccess,
          token_expires_at: expiresAt,
          youtube_channel_id: channel.id,
          youtube_refresh_token: encryptedRefresh,
          is_active: true,
        },
        { onConflict: 'user_id,platform,youtube_channel_id' },
      )

    if (upsertError) {
      console.error('[youtube/callback] account upsert failed', upsertError.message)
      return redirectWithError('account_upsert_failed')
    }

    // 5) ダッシュボードへ
    const dest = new URL('/dashboard/accounts', appUrl())
    dest.searchParams.set('platform', 'youtube')
    dest.searchParams.set('success', '1')
    return NextResponse.redirect(dest)
  } catch (e) {
    console.error('[youtube/callback]', e instanceof Error ? e.message : 'unknown')
    return redirectWithError('internal_error')
  }
}
