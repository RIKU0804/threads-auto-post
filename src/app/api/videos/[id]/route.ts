import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import { isValidVoiceId } from '@/lib/video/voice-presets'
import { regenerateAllSceneAudio } from '@/lib/video/pipeline'
import { videoCapability } from '@/lib/runtime-env'
import { decorateVideoWithSignedUrls } from '@/lib/video/signed-urls'
import type { VideoWithScenes } from '@/types/database'

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

    // image_url / audio_url / final_video_url を ブラウザで使える signed URL に解決
    const decorated = await decorateVideoWithSignedUrls({ ...data, scenes } as VideoWithScenes)
    return NextResponse.json(decorated)
  } catch (e) {
    console.error('[videos/[id] GET]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

const MAX_TITLE_LEN = 200

/**
 * 動画の title / elevenlabs_voice_id を編集する。
 *
 * - title 変更時: final_video_url=null (タイトルテキスト焼き込みのため再レンダー必要)
 * - elevenlabs_voice_id 変更時: 全シーンの audio_url クリア + 音声を fire-and-forget で再生成
 *   + final_video_url=null + status='generating_voice' に遷移
 *
 * voice 変更は外部 API コスト (ElevenLabs 全シーン分) が掛かるため、
 * 生成処理中 (generating_xxx / rendering) は受け付けない。
 */
export async function PATCH(
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
      .select('id, title, generation_mode, elevenlabs_voice_id, status')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (lookupErr) throw lookupErr
    if (!video) return NextResponse.json({ error: '動画が見つかりません' }, { status: 404 })

    const body = await req.json() as { title?: unknown; elevenlabsVoiceId?: unknown }

    const wantTitleChange = typeof body.title === 'string'
    const wantVoiceChange = typeof body.elevenlabsVoiceId === 'string'
    if (!wantTitleChange && !wantVoiceChange) {
      return NextResponse.json({ error: '更新項目がありません' }, { status: 400 })
    }

    // 生成処理中は title/voice いずれの編集も拒否する。
    // 走行中パイプラインの final_video_url を勝手にクリアして成果を無効化しないため。
    if (video.status === 'generating_script' || video.status === 'generating_images' ||
        video.status === 'generating_voice' || video.status === 'rendering') {
      return NextResponse.json(
        { error: '生成処理中です。完了してから操作してください', code: 'VIDEO_BUSY' },
        { status: 409 },
      )
    }

    const admin = createAdminClient()
    const updates: Record<string, unknown> = {}
    let titleChanged = false
    let voiceChanged = false

    if (wantTitleChange) {
      const title = (body.title as string).trim().slice(0, MAX_TITLE_LEN)
      if (title.length === 0) {
        return NextResponse.json({ error: 'title が空です' }, { status: 400 })
      }
      if (title !== video.title) {
        updates.title = title
        updates.final_video_url = null
        titleChanged = true
      }
    }

    if (wantVoiceChange) {
      const voiceId = (body.elevenlabsVoiceId as string).trim()
      if (!isValidVoiceId(voiceId)) {
        return NextResponse.json({ error: '未知の voice_id です' }, { status: 400 })
      }
      if (video.generation_mode !== 'remotion') {
        return NextResponse.json(
          { error: 'HeyGen アバター動画には voice 変更は適用できません' },
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
      if (voiceId !== video.elevenlabs_voice_id) {
        updates.elevenlabs_voice_id = voiceId
        updates.final_video_url = null
        voiceChanged = true
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true, changed: false })
    }

    // voice 変更は全シーン音声の再生成（外部 API キック）を伴うので、
    // DB を書き換える「前」に実行環境を検証する。後で 503 を返すと
    // DB だけ変更済み（final_video_url=null 等）の不整合が残るため。
    if (voiceChanged) {
      const capability = videoCapability()
      if (!capability.enabled) {
        return NextResponse.json(
          { error: capability.message, code: 'LOCAL_ONLY' },
          { status: 503 },
        )
      }
      // status を同期的に generating_voice へ遷移させる。
      // これで UI の即時 refresh が non-terminal を拾ってポーリングを開始でき、
      // 「ready のまま古い音声で再レンダーできてしまう」race を防ぐ。
      updates.status = 'generating_voice'
    }

    const { error: updateErr } = await admin.from('videos').update(updates).eq('id', id)
    if (updateErr) throw updateErr

    if (voiceChanged) {
      // fire-and-forget で全シーン音声を作り直す。所有者照合のため user.id も渡す。
      void regenerateAllSceneAudio(id, user.id).catch(err => {
        console.error('[videos/[id] PATCH] voice regen failed', id, err instanceof Error ? err.message : 'unknown')
      })
    }

    return NextResponse.json({ ok: true, changed: true, titleChanged, voiceChanged })
  } catch (e) {
    console.error('[videos/[id] PATCH]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }
}
