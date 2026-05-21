import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { publishVideoToAccount } from '../../../_lib/publish-helper'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const body = await req.json() as { accountId?: unknown }
    const accountId = typeof body.accountId === 'string' ? body.accountId : ''

    return await publishVideoToAccount({
      videoId: id,
      accountId,
      platform: 'tiktok',
      userId: user.id,
      supabase,
    })
  } catch (e) {
    console.error('[videos/publish/tiktok]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'TikTok への公開に失敗しました' }, { status: 500 })
  }
}
