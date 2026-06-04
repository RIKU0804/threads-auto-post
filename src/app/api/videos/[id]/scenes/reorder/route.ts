import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * シーンの並び順を一括更新する。
 *
 * body: { order: string[] }    // scene.id の配列。0 番目が先頭シーン。
 *
 * バリデーション:
 *   - order に含まれる全 id が video_id=:id のシーンと完全一致すること
 *     (欠落 / 重複 / 他動画のシーン混入を拒否)
 *
 * 生成処理中は不可。並べ替えで final_video_url=null にして再レンダリング対象にする。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { data: video, error: lookupErr } = await supabase
      .from('videos')
      .select('id, status, generation_mode')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (lookupErr) throw lookupErr
    if (!video) return NextResponse.json({ error: '動画が見つかりません' }, { status: 404 })
    if (video.generation_mode !== 'remotion') {
      return NextResponse.json(
        { error: 'HeyGen アバター動画はシーン操作に対応していません' },
        { status: 400 },
      )
    }
    if (video.status === 'generating_script' || video.status === 'generating_images' ||
        video.status === 'generating_voice' || video.status === 'rendering') {
      return NextResponse.json(
        { error: '生成処理中です。完了してから操作してください', code: 'VIDEO_BUSY' },
        { status: 409 },
      )
    }

    const body = await req.json() as { order?: unknown }
    if (!Array.isArray(body.order) || body.order.some(v => typeof v !== 'string')) {
      return NextResponse.json({ error: 'order は文字列配列で指定してください' }, { status: 400 })
    }
    const order = body.order as string[]
    if (order.length === 0) {
      return NextResponse.json({ error: 'order が空です' }, { status: 400 })
    }
    if (new Set(order).size !== order.length) {
      return NextResponse.json({ error: 'order に重複があります' }, { status: 400 })
    }

    const admin = createAdminClient()

    // 現在の scenes を取得して order と完全一致するか検証
    const { data: scenes, error: scenesErr } = await admin
      .from('scenes')
      .select('id')
      .eq('video_id', id)
    if (scenesErr) throw scenesErr
    const existingIds = new Set((scenes ?? []).map(s => s.id))
    if (existingIds.size !== order.length) {
      return NextResponse.json(
        { error: `order の件数 (${order.length}) がシーン数 (${existingIds.size}) と一致しません` },
        { status: 400 },
      )
    }
    for (const sceneId of order) {
      if (!existingIds.has(sceneId)) {
        return NextResponse.json(
          { error: `不正なシーン ID が含まれています: ${sceneId}` },
          { status: 400 },
        )
      }
    }

    // 一括 update。Postgres 側に bulk update は無いのでループだが
    // シーンは最大 10 件なので問題なし。
    // 注意: 一意制約 (video_id, order_index) があると衝突する可能性あり。
    // 一旦全部負の数に逃がしてから本来の値を入れる二段階更新で衝突回避。
    for (let i = 0; i < order.length; i++) {
      const { error } = await admin
        .from('scenes')
        .update({ order_index: -(i + 1) })
        .eq('id', order[i])
      if (error) throw error
    }
    for (let i = 0; i < order.length; i++) {
      const { error } = await admin
        .from('scenes')
        .update({ order_index: i })
        .eq('id', order[i])
      if (error) throw error
    }

    // 動画は古くなったので final_video_url クリア
    await admin.from('videos').update({ final_video_url: null }).eq('id', id)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[scenes/reorder POST]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '並べ替えに失敗しました' }, { status: 500 })
  }
}
