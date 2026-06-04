import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import type { Scene, VideoStatus } from '@/types/database'

type Step = 'script' | 'images' | 'voice' | 'render' | 'done' | 'needs_render' | 'failed'

interface SceneProgress {
  completed: number
  total: number
}

interface StatusResponse {
  status: VideoStatus
  step: Step
  sceneProgress?: SceneProgress
  error?: string
}

/**
 * status だけでは「ready だが最終 MP4 がまだ無い（編集/声変更後で再レンダー待ち）」を
 * 区別できないため、hasFinalVideo も渡して step を導出する。
 * ready かつ final 無しは 'needs_render'（= 完了ではない）として扱う。
 */
function deriveStep(status: VideoStatus, hasFinalVideo: boolean): Step {
  switch (status) {
    case 'draft':
    case 'generating_script':
      return 'script'
    case 'generating_images':
      return 'images'
    case 'generating_voice':
      return 'voice'
    case 'rendering':
      return 'render'
    case 'ready':
      return hasFinalVideo ? 'done' : 'needs_render'
    case 'failed':
      return 'failed'
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { data: video, error } = await supabase
      .from('videos')
      .select('id, status, error_message, final_video_url, scenes:scenes(image_url, audio_url)')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) throw error
    if (!video) {
      return NextResponse.json({ error: '動画が見つかりません' }, { status: 404 })
    }

    const status = video.status as VideoStatus
    const hasFinalVideo = !!video.final_video_url
    const step = deriveStep(status, hasFinalVideo)
    const scenes = (Array.isArray(video.scenes) ? video.scenes : []) as Pick<Scene, 'image_url' | 'audio_url'>[]

    const body: StatusResponse = { status, step }

    if (status === 'generating_images') {
      body.sceneProgress = {
        completed: scenes.filter(s => !!s.image_url).length,
        total: scenes.length,
      }
    } else if (status === 'generating_voice') {
      body.sceneProgress = {
        completed: scenes.filter(s => !!s.audio_url).length,
        total: scenes.length,
      }
    }

    if (status === 'failed' && video.error_message) {
      body.error = video.error_message
    }

    return NextResponse.json(body)
  } catch (e) {
    console.error('[videos/[id]/status GET]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}
