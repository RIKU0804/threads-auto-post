import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { publishVideo, type VideoPublishOptions as PublisherOptions } from '@/lib/platforms/publishers'
import type { Account, Platform, Video } from '@/types/database'

/**
 * 公開処理中ロック (publish_status='publishing') が古すぎる場合は再投稿を許可するための閾値。
 * Vercel Functions の最大実行時間 (約 300 秒) + バッファ。
 */
const STALE_PUBLISHING_LOCK_MS = 10 * 60 * 1000

interface VideoPublishOptions {
  videoId: string
  accountId: string
  platform: 'tiktok' | 'youtube' | 'instagram'
  userId: string
  supabase: SupabaseClient
  /** プラットフォーム固有メタデータ。caption/privacy 等の上書き用 */
  publisherOptions?: PublisherOptions
  /**
   * 投稿時の caption 上書き。指定があれば video.title の代わりにこれを使う。
   * （UIで再編集できるようにするための逃げ道）
   */
  captionOverride?: string
}

/**
 * 動画を指定アカウント宛に公開する共通フロー。
 * - 所有者検証 (IDOR 防御)
 * - status === 'ready' & final_video_url 必須
 * - publish_status === 'publishing' に遷移して二重実行を抑制
 * - 成功時は published_to に platform を追加（重複排除）
 */
export async function publishVideoToAccount({
  videoId,
  accountId,
  platform,
  userId,
  supabase,
  publisherOptions,
  captionOverride,
}: VideoPublishOptions): Promise<NextResponse> {
  if (!accountId) {
    return NextResponse.json({ error: 'accountId は必須です' }, { status: 400 })
  }

  // 動画の所有者検証
  const { data: video, error: videoErr } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .eq('user_id', userId)
    .maybeSingle()

  if (videoErr) throw videoErr
  if (!video) {
    return NextResponse.json({ error: '動画が見つかりません' }, { status: 404 })
  }

  const v = video as Video

  if (v.status !== 'ready') {
    return NextResponse.json({ error: '動画が公開可能な状態ではありません' }, { status: 400 })
  }
  if (!v.final_video_url) {
    return NextResponse.json({ error: '動画ファイルが用意できていません' }, { status: 400 })
  }

  // アカウントの所有者・プラットフォーム検証
  const { data: account, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .eq('user_id', userId)
    .eq('platform', platform)
    .maybeSingle()

  if (accErr) throw accErr
  if (!account) {
    return NextResponse.json({ error: '指定された ' + platform + ' アカウントが見つかりません' }, { status: 404 })
  }

  // 二重投稿防止: publish_status='publishing' へ遷移できる条件下のみ進む。
  // 通常は 'unpublished' / 'publish_failed' のみ許可するが、前回が Vercel タイムアウト
  // などで死んだ場合 'publishing' が永久に残るため、十分古ければ stale lock として
  // 上書きを許可する。.or() 構文は本コードベースで未使用なので 2 段階の二択で実装する。
  const { data: locked, error: lockErr } = await supabase
    .from('videos')
    .update({ publish_status: 'publishing', account_id: accountId })
    .eq('id', videoId)
    .in('publish_status', ['unpublished', 'publish_failed'])
    .select('id')
    .maybeSingle()

  if (lockErr) throw lockErr

  let acquired = !!locked
  if (!acquired) {
    // 既存 'publishing' が STALE_PUBLISHING_LOCK_MS より古ければ takeover を試みる
    const cutoffIso = new Date(Date.now() - STALE_PUBLISHING_LOCK_MS).toISOString()
    const { data: takeover, error: takeoverErr } = await supabase
      .from('videos')
      .update({ publish_status: 'publishing', account_id: accountId })
      .eq('id', videoId)
      .eq('publish_status', 'publishing')
      .lt('updated_at', cutoffIso)
      .select('id')
      .maybeSingle()
    if (takeoverErr) throw takeoverErr
    acquired = !!takeover
    if (acquired) {
      console.error('[videos/publish]', platform, videoId, 'stale_lock_takeover')
    }
  }
  if (!acquired) {
    return NextResponse.json(
      { error: 'この動画は既に公開処理中または公開済みです' },
      { status: 409 },
    )
  }

  try {
    // captionOverride があれば video.title を一時上書き（DB は変えない）
    const effectiveVideo: Video = captionOverride
      ? { ...v, title: captionOverride }
      : v

    // Instagram Reels はコンテナ作成と公開メディア確定が分かれているため、
    // コンテナ ID をまず instagram_reel_id に書き残しておき、その後 publish 成功時に
    // 最終 media ID で上書きする。途中で死んでも漏れた container は ID で追跡できる。
    const mergedOptions: PublisherOptions = {
      ...(publisherOptions ?? {}),
      ...(platform === 'instagram'
        ? {
            _instagramExtras: {
              onContainerCreated: async (containerId: string) => {
                try {
                  await supabase
                    .from('videos')
                    .update({ instagram_reel_id: containerId })
                    .eq('id', videoId)
                } catch (e) {
                  // 永続化失敗は publish 自体を止めない。status のみログ。
                  console.error(
                    '[videos/publish] container_id persist failed',
                    videoId,
                    e instanceof Error ? e.name : 'unknown',
                  )
                }
              },
            },
          }
        : {}),
    }

    const result = await publishVideo({
      video: effectiveVideo,
      account: account as Account,
      options: mergedOptions,
    })

    const publishedTo = Array.isArray(v.published_to) ? [...v.published_to] : []
    const platformKey = platform as Platform
    if (!publishedTo.includes(platformKey)) publishedTo.push(platformKey)

    const updates: Record<string, unknown> = {
      publish_status: 'published',
      published_to: publishedTo,
      published_at: new Date().toISOString(),
      error_message: null,
    }
    if (platform === 'tiktok' && result.platformPublishId) {
      updates.tiktok_publish_id = result.platformPublishId
    }
    if (platform === 'youtube' && result.platformPublishId) {
      updates.youtube_video_id = result.platformPublishId
    }
    if (platform === 'instagram' && result.platformPublishId) {
      // onContainerCreated で書いた containerId を最終 mediaId で上書き
      updates.instagram_reel_id = result.platformPublishId
    }

    await supabase.from('videos').update(updates).eq('id', videoId)

    return NextResponse.json({
      success: true,
      platform,
      platformPublishId: result.platformPublishId,
      url: result.publishedUrl ?? null,
    })
  } catch (e) {
    const internalMessage = e instanceof Error ? e.message : 'unknown'
    console.error('[videos/publish]', platform, videoId, internalMessage)

    await supabase
      .from('videos')
      .update({
        publish_status: 'publish_failed',
        error_message: internalMessage.slice(0, 500),
      })
      .eq('id', videoId)

    // クライアントには固定文言だけ返す（内部エラーメッセージは DB 構造や
    // OAuth トークンなどが漏れうるため client に渡さない）。詳細は videos.error_message
    // を所有者のみが RLS 越しに読める。
    return NextResponse.json(
      { error: '公開に失敗しました。詳細はダッシュボードで確認してください。' },
      { status: 400 },
    )
  }
}
