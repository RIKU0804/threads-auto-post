import { notFound, redirect } from 'next/navigation'
import { VideoDetail } from '@/components/videos/VideoDetail'
import { createServerSupabaseClient } from '@/lib/supabase'
import type { Account, Scene, VideoWithScenes } from '@/types/database'

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

  const video: VideoWithScenes = { ...videoRow, scenes }

  // TikTok / YouTube アカウントのみを取得（公開対象）
  // accounts テーブルは機密カラムを含むので、サーバー側で必要な公開可能カラムのみを返す
  const { data: accountRows } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', user.id)
    .in('platform', ['tiktok', 'youtube'])
    .eq('is_active', true)
    .order('name', { ascending: true })

  const accounts = (accountRows ?? []) as Account[]

  return <VideoDetail initialVideo={video} videoAccounts={accounts} />
}
