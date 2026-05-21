import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { regenerateSceneImage, regenerateSceneAudio } from '@/lib/video/pipeline'

type Target = 'image' | 'audio'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
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

    // 所有者検証 (IDOR 防御): scene → video → user_id
    const { data: scene, error: lookupErr } = await supabase
      .from('scenes')
      .select('id, video_id, video:videos!inner(user_id)')
      .eq('id', sceneId)
      .eq('video_id', id)
      .maybeSingle()

    if (lookupErr) throw lookupErr
    if (!scene) {
      return NextResponse.json({ error: 'シーンが見つかりません' }, { status: 404 })
    }

    type VideoRef = { user_id: string } | { user_id: string }[] | null
    const videoUserId = (() => {
      const v = scene.video as VideoRef
      if (!v) return null
      if (Array.isArray(v)) return v[0]?.user_id ?? null
      return v.user_id
    })()

    if (videoUserId !== user.id) {
      return NextResponse.json({ error: 'シーンが見つかりません' }, { status: 404 })
    }

    if (target === 'image') {
      void regenerateSceneImage(sceneId).catch(err => {
        console.error('[videos/regenerate-scene] image failed', sceneId, err instanceof Error ? err.message : 'unknown')
      })
    } else {
      void regenerateSceneAudio(sceneId).catch(err => {
        console.error('[videos/regenerate-scene] audio failed', sceneId, err instanceof Error ? err.message : 'unknown')
      })
    }

    return NextResponse.json({ status: 'accepted', sceneId, target }, { status: 202 })
  } catch (e) {
    console.error('[videos/regenerate-scene POST]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '再生成に失敗しました' }, { status: 500 })
  }
}
