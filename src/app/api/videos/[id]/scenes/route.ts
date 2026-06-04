import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import { regenerateSceneTracked } from '@/lib/video/pipeline'
import { videoCapability } from '@/lib/runtime-env'

const MAX_SCENES = 10
const MAX_CAPTION_LEN = 500
const MAX_NARRATION_LEN = 1000
const MAX_PROMPT_LEN = 1000
const DEFAULT_DURATION_SEC = 4

/**
 * 動画にシーンを末尾追加する。
 *
 * 入力された caption_text / narration_text / image_prompt から
 * scenes 行を 1 件 INSERT し、image と audio を fire-and-forget で生成する。
 * 並行リクエストでも order_index がぶつからないよう DB 側で max+1 を計算。
 *
 * 制約:
 *   - 動画 1 本あたり最大 MAX_SCENES シーン
 *   - 生成処理中 (generating_*) は不可
 *   - heygen_avatar モードは scenes を使わないため不可
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const capability = videoCapability()
    if (!capability.enabled) {
      return NextResponse.json(
        { error: capability.message, code: 'LOCAL_ONLY' },
        { status: 503 },
      )
    }

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

    const body = await req.json() as {
      caption_text?: unknown
      narration_text?: unknown
      image_prompt?: unknown
    }
    const caption = typeof body.caption_text === 'string' ? body.caption_text.trim() : ''
    const narration = typeof body.narration_text === 'string' ? body.narration_text.trim() : ''
    const prompt = typeof body.image_prompt === 'string' ? body.image_prompt.trim() : ''
    if (!caption || !narration || !prompt) {
      return NextResponse.json(
        { error: 'caption_text / narration_text / image_prompt をすべて入力してください' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()

    // 現在のシーン数 + max order を取得（max() を使う代わりに範囲取得）
    const { data: existing, error: existingErr } = await admin
      .from('scenes')
      .select('order_index')
      .eq('video_id', id)
      .order('order_index', { ascending: false })
      .limit(1)
    if (existingErr) throw existingErr

    const { count: totalCount, error: countErr } = await admin
      .from('scenes')
      .select('id', { count: 'exact', head: true })
      .eq('video_id', id)
    if (countErr) throw countErr

    if ((totalCount ?? 0) >= MAX_SCENES) {
      return NextResponse.json(
        { error: `シーンは最大 ${MAX_SCENES} 個までです` },
        { status: 400 },
      )
    }

    const nextOrder = (existing?.[0]?.order_index ?? -1) + 1

    const { data: inserted, error: insertErr } = await admin
      .from('scenes')
      .insert({
        video_id: id,
        order_index: nextOrder,
        caption_text: caption.slice(0, MAX_CAPTION_LEN),
        narration_text: narration.slice(0, MAX_NARRATION_LEN),
        image_prompt: prompt.slice(0, MAX_PROMPT_LEN),
        duration: DEFAULT_DURATION_SEC,
      })
      .select()
      .single()
    if (insertErr) throw insertErr
    if (!inserted) return NextResponse.json({ error: 'シーンの作成に失敗しました' }, { status: 500 })

    // 動画は古くなったので final_video_url をクリア + status を同期遷移（UI ポーリング発火）。
    await admin.from('videos').update({ final_video_url: null, status: 'generating_images' }).eq('id', id)

    // 画像と音声を status 追跡付きで生成（完了で ready に戻る）。expectedVideoId=id で TOCTOU 防御。
    void regenerateSceneTracked(id, inserted.id, 'both', id).catch(err => {
      console.error('[videos/scenes POST] media gen failed', inserted.id, err instanceof Error ? err.message : 'unknown')
    })

    return NextResponse.json({ ok: true, scene: inserted }, { status: 201 })
  } catch (e) {
    console.error('[videos/scenes POST]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '追加に失敗しました' }, { status: 500 })
  }
}
