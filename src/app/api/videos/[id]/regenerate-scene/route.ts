import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { regenerateSceneTracked } from '@/lib/video/pipeline'
import { videoCapability } from '@/lib/runtime-env'
import { createAdminClient } from '@/lib/supabase-admin'

type Target = 'image' | 'audio'

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

    const body = await req.json() as { sceneId?: unknown; target?: unknown }
    const sceneId = typeof body.sceneId === 'string' ? body.sceneId : ''
    const target = body.target === 'image' || body.target === 'audio' ? (body.target as Target) : null

    if (!sceneId) {
      return NextResponse.json({ error: 'sceneId は必須です' }, { status: 400 })
    }
    if (!target) {
      return NextResponse.json({ error: "target は 'image' または 'audio' を指定してください" }, { status: 400 })
    }

    // 所有者検証 (IDOR 防御): scene → video → user_id。生成中ガード用に status も取得。
    const { data: scene, error: lookupErr } = await supabase
      .from('scenes')
      .select('id, video_id, video:videos!inner(user_id, status)')
      .eq('id', sceneId)
      .eq('video_id', id)
      .maybeSingle()

    if (lookupErr) throw lookupErr
    if (!scene) {
      return NextResponse.json({ error: 'シーンが見つかりません' }, { status: 404 })
    }

    type VideoRef = { user_id: string; status: string } | { user_id: string; status: string }[] | null
    const videoMeta = (() => {
      const v = scene.video as VideoRef
      if (!v) return null
      if (Array.isArray(v)) return v[0] ?? null
      return v
    })()

    if (!videoMeta || videoMeta.user_id !== user.id) {
      return NextResponse.json({ error: 'シーンが見つかりません' }, { status: 404 })
    }
    // 生成処理中はパイプラインのメディア生成と衝突するので拒否。
    if (videoMeta.status === 'generating_script' || videoMeta.status === 'generating_images' ||
        videoMeta.status === 'generating_voice' || videoMeta.status === 'rendering') {
      return NextResponse.json(
        { error: '生成処理中です。完了してから操作してください', code: 'VIDEO_BUSY' },
        { status: 409 },
      )
    }

    // UI のポーリングを即発火させるため、レスポンス前に同期的に status を遷移させる。
    // （fire-and-forget の regenerateSceneTracked も冒頭で同じ status をセットするが冪等）
    const syncStatus = target === 'image' ? 'generating_images' : 'generating_voice'
    const admin = createAdminClient()
    const { error: stErr } = await admin
      .from('videos')
      .update({ status: syncStatus })
      .eq('id', id)
    if (stErr) {
      console.error('[videos/regenerate-scene] status set failed', id, stErr.message)
      return NextResponse.json({ error: 'ステータス更新に失敗しました' }, { status: 500 })
    }

    // status 追跡付きで再生成（完了で ready に戻る）。expectedVideoId=id で TOCTOU 防御。
    void regenerateSceneTracked(id, sceneId, target, id).catch(err => {
      console.error('[videos/regenerate-scene] failed', sceneId, err instanceof Error ? err.message : 'unknown')
    })

    return NextResponse.json({ status: 'accepted', sceneId, target }, { status: 202 })
  } catch (e) {
    console.error('[videos/regenerate-scene POST]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '再生成に失敗しました' }, { status: 500 })
  }
}
