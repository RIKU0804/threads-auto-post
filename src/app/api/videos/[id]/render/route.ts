import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import { renderFinalVideo } from '@/lib/video/pipeline'
import { videoCapability } from '@/lib/runtime-env'

/**
 * シーン編集後に最終動画 (MP4) を作り直す。
 *
 * シーンの caption/narration/image_prompt を編集すると updateSceneTexts() が
 * videos.final_video_url を null にクリアするが、再レンダリングは自動では
 * 走らない。このエンドポイントがその「ユーザー明示の再レンダー指示」を担う。
 *
 * 前提:
 *   - video.status は 'ready' or 'failed' のいずれか (生成中は不可)
 *   - heygen_avatar モードは未対応 (HeyGen の再ジョブ投入が必要なため別フロー)
 *
 * 再レンダー対象の判定:
 *   - final_video_url が null なら、何か編集された証拠なので素直に再レンダー
 *   - そうでなければ「既に最新の動画が出来てる」とみなして 400 を返す
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

    const { data: video, error: lookupErr } = await supabase
      .from('videos')
      .select('id, status, generation_mode, final_video_url')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (lookupErr) throw lookupErr
    if (!video) return NextResponse.json({ error: '動画が見つかりません' }, { status: 404 })

    if (video.generation_mode !== 'remotion') {
      return NextResponse.json(
        { error: 'HeyGen アバター動画の再レンダリングはこのエンドポイントでは対応していません' },
        { status: 400 },
      )
    }

    if (video.status !== 'ready' && video.status !== 'failed') {
      return NextResponse.json(
        { error: '生成処理中です。完了してから操作してください', code: 'VIDEO_BUSY' },
        { status: 409 },
      )
    }

    if (video.final_video_url) {
      return NextResponse.json(
        { error: '最新の動画が既に作成されています。シーンを編集してから再レンダリングしてください' },
        { status: 400 },
      )
    }

    // status を rendering に遷移させてから fire-and-forget でレンダー
    const admin = createAdminClient()
    const { error: updateErr } = await admin
      .from('videos')
      .update({ status: 'rendering', error_message: null })
      .eq('id', id)
    if (updateErr) throw updateErr

    void renderFinalVideo(id).catch(async err => {
      console.error('[videos/render] failed', id, err instanceof Error ? err.message : 'unknown')
      // 失敗時は failed に遷移してエラーメッセージを残す
      await admin
        .from('videos')
        .update({
          status: 'failed',
          error_message: err instanceof Error ? err.message.slice(0, 500) : '再レンダリングに失敗しました',
        })
        .eq('id', id)
    })

    return NextResponse.json({ ok: true, status: 'rendering' }, { status: 202 })
  } catch (e) {
    console.error('[videos/render POST]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '再レンダリングに失敗しました' }, { status: 500 })
  }
}
