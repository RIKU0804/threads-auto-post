import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const body = await req.json() as {
    name?: string
    persona?: string
    tone?: string
    targetAudience?: string
    postTopics?: string
    clientId?: string
    clientSecret?: string
  }

  const {
    name = '',
    persona = '',
    tone = 'friendly',
    targetAudience = '',
    postTopics = '',
    clientId: bodyClientId = '',
    clientSecret: bodyClientSecret = '',
  } = body

  const clientId = bodyClientId.trim()
  const clientSecret = bodyClientSecret.trim()

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Client ID と Client Secret を入力してください' }, { status: 400 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const state = crypto.randomUUID()
  const redirectUri = `${appUrl}/api/auth/threads/callback`

  const pendingData = JSON.stringify({
    name,
    persona,
    tone,
    targetAudience,
    postTopics,
    state,
    userId: user.id,
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
  })

  const authUrl = new URL('https://threads.net/oauth/authorize')
  authUrl.searchParams.set('client_id', clientId.trim())
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'threads_basic,threads_content_publish')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)

  const res = NextResponse.json({ url: authUrl.toString() })
  res.cookies.set('threads_oauth_pending', pendingData, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return res
}
