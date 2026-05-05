import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { generateThreadsText } from '@/lib/ai/text'
import type { Account } from '@/types/database'

// アカウントなし時のデフォルト設定
const DEMO_ACCOUNT: Account = {
  id: 'demo',
  user_id: 'demo',
  platform: 'threads',
  name: 'デモ',
  persona: '転職ノウハウ発信者',
  tone: 'friendly',
  target_audience: 'キャリアに不安のある高卒20代',
  post_topics: ['転職ノウハウ', 'キャリア相談', '仕事の悩み'],
  access_token: null,
  token_expires_at: null,
  threads_user_id: null,
  threads_client_id: null,
  threads_client_secret: null,
  heygen_avatar_id: null,
  heygen_voice_id: null,
  x_user_id: null,
  x_refresh_token: null,
  is_active: false,
  created_at: '',
  updated_at: '',
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { accountId, theme, postType, referencePost, referenceAccountName } = await req.json() as {
      accountId?: string
      theme: string
      postType?: string
      referencePost?: string
      referenceAccountName?: string
    }
    if (!theme) {
      return NextResponse.json({ error: 'theme は必須です' }, { status: 400 })
    }

    let account: Account = DEMO_ACCOUNT
    let recentSummaries: string[] = []

    // アカウントIDが指定されている場合のみDB参照
    if (accountId) {
      const [{ data: accountData, error }, { data: recentPosts }] = await Promise.all([
        supabase
          .from('accounts')
          .select('*')
          .eq('id', accountId)
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('posts')
          .select('summary')
          .eq('account_id', accountId)
          .not('summary', 'is', null)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      if (error || !accountData) {
        return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })
      }

      account = accountData
      recentSummaries = (recentPosts ?? [])
        .map(p => p.summary as string)
        .filter(Boolean)
    }

    const result = await generateThreadsText({ account, theme, postType, recentSummaries, referencePost, referenceAccountName })
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : '生成に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
