import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const MAX_LEN = 4_000

interface PromptSettings {
  account_id: string
  text_extra: string | null
  image_extra: string | null
  themes_extra: string | null
  updated_at?: string
}

const empty = (accountId: string): PromptSettings => ({
  account_id: accountId,
  text_extra: null,
  image_extra: null,
  themes_extra: null,
})

async function assertOwnsAccount(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const accountId = new URL(req.url).searchParams.get('accountId')
    if (!accountId) {
      return NextResponse.json({ error: 'accountId が必要です' }, { status: 400 })
    }

    if (!(await assertOwnsAccount(supabase, user.id, accountId))) {
      return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('account_prompt_settings')
      .select('account_id, text_extra, image_extra, themes_extra, updated_at')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) throw error

    return NextResponse.json(data ?? empty(accountId))
  } catch (e) {
    console.error('[prompts GET]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

function clamp(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_LEN)
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const body = await req.json() as {
      accountId?: string
      textExtra?: unknown
      imageExtra?: unknown
      themesExtra?: unknown
    }

    const accountId = body.accountId
    if (!accountId || typeof accountId !== 'string') {
      return NextResponse.json({ error: 'accountId が必要です' }, { status: 400 })
    }

    if (!(await assertOwnsAccount(supabase, user.id, accountId))) {
      return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })
    }

    const payload = {
      account_id: accountId,
      text_extra: clamp(body.textExtra),
      image_extra: clamp(body.imageExtra),
      themes_extra: clamp(body.themesExtra),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('account_prompt_settings')
      .upsert(payload, { onConflict: 'account_id' })
      .select('account_id, text_extra, image_extra, themes_extra, updated_at')
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e) {
    console.error('[prompts PUT]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
  }
}
