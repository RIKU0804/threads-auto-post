import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const status = searchParams.get('status')

    let query = supabase
      .from('posts')
      .select('*, account:accounts(id, name, platform, persona)')
      .order('created_at', { ascending: false })
      .limit(50)

    if (accountId) query = query.eq('account_id', accountId)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json(data)
  } catch (e) {
    const message = e instanceof Error ? e.message : '取得に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const body = await req.json() as {
      accountId: string
      textContent: string
      imageUrl?: string
      imagePrompt?: string
      theme?: string
      scheduledAt?: string
      summary?: string
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({
        account_id: body.accountId,
        text_content: body.textContent,
        image_url: body.imageUrl ?? null,
        image_prompt: body.imagePrompt ?? null,
        theme: body.theme ?? null,
        scheduled_at: body.scheduledAt ?? null,
        status: body.scheduledAt ? 'scheduled' : 'draft',
        summary: body.summary ?? null,
      })
      .select()
      .single()

    if (error) throw error

    await supabase.from('post_logs').insert({
      post_id: data.id,
      action: body.scheduledAt ? 'scheduled' : 'generated',
      message: body.scheduledAt ? `${body.scheduledAt} に予約投稿` : '下書き保存',
    })

    return NextResponse.json(data)
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
