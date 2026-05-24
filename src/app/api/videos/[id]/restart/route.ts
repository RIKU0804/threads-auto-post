import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { restartFailedVideo } from '@/lib/video/pipeline'
import { enqueueVideoPipeline } from '@/lib/video/jobs'
import { videoCapability } from '@/lib/runtime-env'

/**
 * failed 状態の動画を再開する。draft に戻して pipeline を再投入。
 * 既存の scenes / image_url / audio_url は残るため、未完了の step のみ再走する。
 */
export async function POST(
  _req: NextRequest,
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

    // 所有者検証
    const { data: video, error: lookupErr } = await supabase
      .from('videos')
      .select('id, status, title')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (lookupErr) throw lookupErr
    if (!video) return NextResponse.json({ error: '動画が見つかりません' }, { status: 404 })
    if (video.status !== 'failed') {
      return NextResponse.json({ error: 'failed 状態の動画のみ再開できます' }, { status: 400 })
    }

    await restartFailedVideo(id)

    // pipeline 再投入（fire-and-forget）
    void enqueueVideoPipeline(id, {
      theme: video.title ?? null,
      sceneCount: null,
      targetDurationSec: null,
    }).catch(err => {
      console.error('[videos/restart] enqueue failed', id, err instanceof Error ? err.message : 'unknown')
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[videos/restart]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '再開に失敗しました' }, { status: 500 })
  }
}
