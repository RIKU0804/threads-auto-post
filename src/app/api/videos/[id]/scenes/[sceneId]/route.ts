import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createAdminClient } from '@/lib/supabase-admin'
import {
  updateSceneTexts,
  regenerateSceneTracked,
} from '@/lib/video/pipeline'

/**
 * シーンの本文 (キャプション / ナレーション / 画像プロンプト) 編集 API。
 * - narration_text を変えた場合: 自動で audio を再生成
 * - image_prompt を変えた場合: 自動で image を再生成
 * - caption_text のみ変更: 何も再生成しない（Remotion レンダー時に反映）
 *
 * いずれの場合も final_video_url は無効化される → 公開前に再レンダー必須。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> },
) {
  const { id, sceneId } = await params
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    // 所有者検証 (IDOR 防御): scene → video → user_id。
    // 生成中ガードのため status / generation_mode も同時取得する。
    const { data: scene, error: lookupErr } = await supabase
      .from('scenes')
      .select('id, video_id, video:videos!inner(user_id, status, generation_mode)')
      .eq('id', sceneId)
      .eq('video_id', id)
      .maybeSingle()
    if (lookupErr) throw lookupErr
    if (!scene) return NextResponse.json({ error: 'シーンが見つかりません' }, { status: 404 })

    type VideoRef =
      | { user_id: string; status: string; generation_mode: string }
      | { user_id: string; status: string; generation_mode: string }[]
      | null
    const videoMeta = (() => {
      const v = scene.video as VideoRef
      if (!v) return null
      if (Array.isArray(v)) return v[0] ?? null
      return v
    })()
    if (!videoMeta || videoMeta.user_id !== user.id) {
      return NextResponse.json({ error: 'シーンが見つかりません' }, { status: 404 })
    }
    // 生成処理中はパイプラインのメディア生成と衝突するので拒否（DELETE と同じガード）。
    if (videoMeta.status === 'generating_script' || videoMeta.status === 'generating_images' ||
        videoMeta.status === 'generating_voice' || videoMeta.status === 'rendering') {
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
    const patch: { caption_text?: string; narration_text?: string; image_prompt?: string } = {}
    if (typeof body.caption_text === 'string') patch.caption_text = body.caption_text
    if (typeof body.narration_text === 'string') patch.narration_text = body.narration_text
    if (typeof body.image_prompt === 'string') patch.image_prompt = body.image_prompt
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '更新項目がありません' }, { status: 400 })
    }

    const { narrationChanged, imageChanged } = await updateSceneTexts(sceneId, patch, id)

    // テキストに合わせて関連メディアを再生成。status 追跡付きで UI が完了を追える。
    // expectedVideoId=id で TOCTOU 防御（別 video の scene を触らせない）。
    if (narrationChanged || imageChanged) {
      const target: 'image' | 'audio' | 'both' =
        narrationChanged && imageChanged ? 'both' : imageChanged ? 'image' : 'audio'
      // UI のポーリングを即発火させるため、レスポンス前に同期的に status を遷移。
      const syncStatus = imageChanged ? 'generating_images' : 'generating_voice'
      const admin = createAdminClient()
      await admin.from('videos').update({ status: syncStatus }).eq('id', id)
      void regenerateSceneTracked(id, sceneId, target, id).catch(err => {
        console.error('[scenes PATCH] regen failed', sceneId, err instanceof Error ? err.message : 'unknown')
      })
    }

    return NextResponse.json({
      ok: true,
      narrationChanged,
      imageChanged,
    })
  } catch (e) {
    console.error('[scenes PATCH]', id, sceneId, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }
}

/**
 * シーンを削除する。残ったシーンの order_index を 0 から振り直し、
 * 最終動画は再レンダー必要なので final_video_url=null にクリアする。
 *
 * 生成処理中は不可。シーンが 1 つしかない動画では削除を拒否する
 * （Remotion レンダー時に scenes が空だとエラーになるため）。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sceneId: string }> },
) {
  const { id, sceneId } = await params
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    // 所有者検証 + 動画ステータス取得 (1 クエリで)
    const { data: scene, error: lookupErr } = await supabase
      .from('scenes')
      .select('id, video_id, video:videos!inner(user_id, status, generation_mode)')
      .eq('id', sceneId)
      .eq('video_id', id)
      .maybeSingle()
    if (lookupErr) throw lookupErr
    if (!scene) return NextResponse.json({ error: 'シーンが見つかりません' }, { status: 404 })

    type VideoRef = { user_id: string; status: string; generation_mode: string } | { user_id: string; status: string; generation_mode: string }[] | null
    const videoMeta = (() => {
      const v = scene.video as VideoRef
      if (!v) return null
      if (Array.isArray(v)) return v[0] ?? null
      return v
    })()
    if (!videoMeta || videoMeta.user_id !== user.id) {
      return NextResponse.json({ error: 'シーンが見つかりません' }, { status: 404 })
    }
    if (videoMeta.generation_mode !== 'remotion') {
      return NextResponse.json(
        { error: 'HeyGen アバター動画はシーン操作に対応していません' },
        { status: 400 },
      )
    }
    if (videoMeta.status === 'generating_script' || videoMeta.status === 'generating_images' ||
        videoMeta.status === 'generating_voice' || videoMeta.status === 'rendering') {
      return NextResponse.json(
        { error: '生成処理中です。完了してから操作してください', code: 'VIDEO_BUSY' },
        { status: 409 },
      )
    }

    const admin = createAdminClient()

    // 1 シーンしかない動画では削除を拒否
    const { count: totalCount, error: countErr } = await admin
      .from('scenes')
      .select('id', { count: 'exact', head: true })
      .eq('video_id', id)
    if (countErr) throw countErr
    if ((totalCount ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'シーンは 1 つ以上必要です' },
        { status: 400 },
      )
    }

    const { error: deleteErr } = await admin.from('scenes').delete().eq('id', sceneId)
    if (deleteErr) throw deleteErr

    // order_index を 0 から振り直す
    const { data: remaining, error: remainErr } = await admin
      .from('scenes')
      .select('id, order_index')
      .eq('video_id', id)
      .order('order_index', { ascending: true })
    if (remainErr) throw remainErr

    for (let i = 0; i < (remaining?.length ?? 0); i++) {
      const row = remaining![i]
      if (row.order_index === i) continue
      const { error: updErr } = await admin
        .from('scenes')
        .update({ order_index: i })
        .eq('id', row.id)
      if (updErr) throw updErr
    }

    // 動画は古くなったので final_video_url クリア
    await admin.from('videos').update({ final_video_url: null }).eq('id', id)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[scenes DELETE]', id, sceneId, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 })
  }
}
