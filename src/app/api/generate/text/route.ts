import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { generateThreadsText } from '@/lib/ai/text'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { accountId, theme, postType } = await req.json() as {
      accountId: string
      theme: string
      postType?: string
    }
    if (!accountId || !theme) {
      return NextResponse.json({ error: 'accountId と theme は必須です' }, { status: 400 })
    }

    const [{ data: account, error }, { data: recentPosts }] = await Promise.all([
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

    if (error || !account) {
      return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })
    }

    const recentSummaries = (recentPosts ?? [])
      .map(p => p.summary as string)
      .filter(Boolean)

    const result = await generateThreadsText({ account, theme, postType, recentSummaries })

    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : '生成に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
