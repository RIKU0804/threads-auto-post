import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name') ?? ''
  const persona = searchParams.get('persona') ?? ''
  const tone = searchParams.get('tone') ?? 'friendly'
  const targetAudience = searchParams.get('targetAudience') ?? ''
  const postTopics = searchParams.get('postTopics') ?? ''

  // CSRF対策のstateトークン生成
  const state = crypto.randomUUID()

  // アカウント情報をcookieに保存（OAuth完了後に使う）
  const pendingData = JSON.stringify({ name, persona, tone, targetAudience, postTopics, state })

  const clientId = process.env.THREADS_CLIENT_ID!
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirectUri = `${appUrl}/api/auth/threads/callback`

  const authUrl = new URL('https://threads.net/oauth/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'threads_basic,threads_content_publish')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)

  const res = NextResponse.redirect(authUrl.toString())
  res.cookies.set('threads_oauth_pending', pendingData, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10分
    path: '/',
  })

  return res
}
