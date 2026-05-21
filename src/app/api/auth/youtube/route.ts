// YouTube OAuth 2.0 開始エンドポイント (Google Identity)
//
// 必要な環境変数:
//   YOUTUBE_OAUTH_CLIENT_ID      Google Cloud Console > 認証情報 > OAuth 2.0 クライアント ID
//   YOUTUBE_OAUTH_CLIENT_SECRET  同上のシークレット
//   YOUTUBE_OAUTH_REDIRECT_URI   例: https://app.example.com/api/auth/youtube/callback
//                                Google Cloud Console の「承認済みリダイレクト URI」と
//                                完全一致している必要がある
//
// 単一クライアント納品向けテストモード運用:
//   OAuth スコープ `youtube.upload` は機微 (sensitive) 扱いなので、本番公開には
//   Google の verification (数週間〜) が必要になる。納品先が 1 アカウントだけなら、
//   Google Cloud Console の OAuth 同意画面を「テスト」モードのままにし、納品先の
//   Gmail アドレスを「テストユーザー」に追加することで verification を回避できる。
//   テストモードは「テストユーザー」に追加された Google アカウントだけが利用可能。
//   refresh token は 7 日で失効する仕様だが、active な利用が続けば実質無期限になる。
//
// 流れ:
//   1. CSRF 対策の state を生成し HttpOnly cookie に保存
//   2. Google の OAuth 同意画面へリダイレクト
//      access_type=offline + prompt=consent を付けて毎回 refresh_token を確実に得る

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { createServerSupabaseClient } from '@/lib/supabase'

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const STATE_COOKIE = 'yt_oauth_state'
const STATE_COOKIE_MAX_AGE_SEC = 600 // 10 分

// minimum: upload。 readonly はチャンネル情報取得用に併用（callback で /channels?mine=true）
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
]

export async function GET(_req: NextRequest) {
  try {
    // 認証済みユーザーのみが OAuth を開始できる
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID
    const redirectUri = process.env.YOUTUBE_OAUTH_REDIRECT_URI
    if (!clientId || !redirectUri) {
      console.error('[youtube/oauth] missing env: YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_REDIRECT_URI')
      return NextResponse.json({ error: 'YouTube OAuth が未設定です' }, { status: 500 })
    }

    // state は CSRF 用ランダム + ユーザー ID をペアで持つ（cookie とクエリ両方を照合）
    const state = crypto.randomBytes(32).toString('base64url')

    const cookieStore = await cookies()
    cookieStore.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: STATE_COOKIE_MAX_AGE_SEC,
    })

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      include_granted_scopes: 'true',
    })

    return NextResponse.redirect(`${GOOGLE_AUTHORIZE_URL}?${params.toString()}`)
  } catch (e) {
    console.error('[youtube/oauth]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'OAuth 開始に失敗しました' }, { status: 500 })
  }
}
