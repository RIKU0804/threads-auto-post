import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { data, error } = await supabase
      .from('videos')
      .select('*, scenes:scenes(*)')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: '動画が見つかりません' }, { status: 404 })
    }

    // scenes を order_index で昇順に並べる（Supabase の embed では順序保証されないため）
    const scenes = Array.isArray(data.scenes)
      ? [...data.scenes].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
      : []

    return NextResponse.json({ ...data, scenes })
  } catch (e) {
    console.error('[videos/[id] GET]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}
