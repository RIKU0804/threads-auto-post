import { notFound, redirect } from 'next/navigation'
import { VideoDetail, type VideoAccount } from '@/components/videos/VideoDetail'
import { createServerSupabaseClient } from '@/lib/supabase'
import { decorateVideoWithSignedUrls } from '@/lib/video/signed-urls'
import type { Scene, VideoWithScenes } from '@/types/database'

// クライアントへ渡す公開可能カラムのみ（機密カラム = *_token / *_secret / *_key は絶対に含めない）
const PUBLIC_VIDEO_ACCOUNT_COLUMNS =
  'id, name, platform, is_active, tiktok_open_id, youtube_channel_id, instagram_user_id'

interface VideoDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function VideoDetailPage({ params }: VideoDetailPageProps) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: videoRow } = await supabase
    .from('videos')
    .select('*, scenes:scenes(*)')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!videoRow) notFound()

  const scenes = Array.isArray(videoRow.scenes)
    ? [...(videoRow.scenes as Scene[])].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    : []

  // image_url / audio_url / final_video_url を signed URL に解決して
  // ブラウザの <img src> / <audio src> / <video src> で直接使える状態にする。
  const video: VideoWithScenes = await decorateVideoWithSignedUrls({
    ...videoRow,
    scenes,
  } as VideoWithScenes)

  // TikTok / YouTube / Instagram (Reels) アカウントを取得（公開対象）
  // accounts テーブルは機密カラムを含むので、サーバー側で必要な公開可能カラムのみを返す
  const { data: accountRows } = await supabase
    .from('accounts')
    .select(PUBLIC_VIDEO_ACCOUNT_COLUMNS)
    .eq('user_id', user.id)
    .in('platform', ['tiktok', 'youtube', 'instagram'])
    .eq('is_active', true)
    .order('name', { ascending: true })

  const accounts = (accountRows ?? []) as VideoAccount[]

  return <VideoDetail initialVideo={video} videoAccounts={accounts} />
}
