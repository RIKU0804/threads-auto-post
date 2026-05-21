// TikTok OAuth 開始エンドポイント (GET /api/auth/tiktok)
//
// フロー:
//   1. ログイン中ユーザーを Supabase セッションから取得
//   2. CSRF 対策の state を生成 → HttpOnly Cookie に保存
//   3. TikTok 認可 URL にリダイレクト
//
// 必須環境変数:
//   - TIKTOK_CLIENT_KEY:    TikTok Developer Portal のアプリ client_key
//   - TIKTOK_CLIENT_SECRET: TikTok Developer Portal のアプリ client_secret
//     （ここでは使わないが callback で必要）
//   - TIKTOK_REDIRECT_URI:  Developer Portal に登録した callback URL
//     （例: https://example.com/api/auth/tiktok/callback）
//   - ENCRYPTION_KEY:       refresh_token 暗号化に使う 32 バイト鍵
//
// 要求スコープ:
//   - user.info.basic: open_id を取得し account に紐付ける
//   - video.publish:   Direct Post で公開する
//   - video.upload:    将来 FILE_UPLOAD 経路を使う場合に必要

import 'server-only'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServerSupabaseClient } from '@/lib/supabase'
import { TIKTOK_OAUTH_AUTHORIZE_URL } from '@/lib/platforms/tiktok'

const TIKTOK_OAUTH_STATE_COOKIE = 'tiktok_oauth_state'
const TIKTOK_OAUTH_STATE_MAX_AGE_SEC = 600 // 10 分
const TIKTOK_SCOPES = ['user.info.basic', 'video.publish', 'video.upload']

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const redirectUri = process.env.TIKTOK_REDIRECT_URI
  if (!clientKey || !redirectUri) {
    console.error('[tiktok/oauth] TIKTOK_CLIENT_KEY/REDIRECT_URI が未設定です')
    return NextResponse.json(
      { error: 'TikTok 連携の設定が不足しています' },
      { status: 500 },
    )
  }

  // state は CSRF 対策。Cookie の値と TikTok から戻る state を一致確認する。
  const state = crypto.randomBytes(24).toString('hex')

  const cookieStore = await cookies()
  cookieStore.set(TIKTOK_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TIKTOK_OAUTH_STATE_MAX_AGE_SEC,
  })

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: TIKTOK_SCOPES.join(','),
    redirect_uri: redirectUri,
    state,
  })

  return NextResponse.redirect(`${TIKTOK_OAUTH_AUTHORIZE_URL}?${params.toString()}`)
}
