import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, Video as VideoIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { VideoCard } from '@/components/videos/VideoCard'
import { LocalOnlyBanner } from '@/components/video/LocalOnlyBanner'
import { createServerSupabaseClient } from '@/lib/supabase'
import { resolveAssetUrl } from '@/lib/video/signed-urls'
import type { Video } from '@/types/database'

interface RawScene {
  image_url: string | null
  order_index: number
}

interface VideoListItem extends Video {
  scenes?: RawScene[] | null
}

interface VideoCardItem extends Video {
  scenes?: { count: number }[]
  thumbnail_url?: string | null
}

export default async function VideosPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: videos } = await supabase
    .from('videos')
    .select('*, scenes:scenes(image_url, order_index)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const rawList = (videos ?? []) as VideoListItem[]

  // 各動画の「先頭シーンの image_url」を signed URL 化してサムネに使う。
  // 並列処理: 1 動画 = 1 リクエスト。50 動画なら 50 並列 (Supabase 側でレート制限なし)。
  const list: VideoCardItem[] = await Promise.all(
    rawList.map(async (v) => {
      const scenes = v.scenes ?? []
      const sortedScenes = [...scenes].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
      const firstImage = sortedScenes[0]?.image_url ?? null
      const thumbnail = await resolveAssetUrl(firstImage)
      const card: VideoCardItem = {
        ...v,
        scenes: [{ count: scenes.length }],
        thumbnail_url: thumbnail,
      }
      return card
    }),
  )

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
            動画一覧
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">生成した動画の管理・公開</p>
        </div>
        <Link href="/dashboard/videos/new">
          <Button className="gap-1.5">
            <Plus className="h-4 w-4" />
            新規動画作成
          </Button>
        </Link>
      </div>

      <LocalOnlyBanner variant="info" />

      {list.length === 0 ? (
        <Card className="py-14 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100">
            <VideoIcon className="h-5 w-5 text-gray-500" />
          </div>
          <p className="text-sm font-medium text-gray-500">動画がまだありません</p>
          <p className="mt-0.5 text-xs text-gray-500">「新規動画作成」から始めましょう</p>
          <Link href="/dashboard/videos/new" className="mt-4 inline-block">
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" />
              新規動画作成
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(video => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  )
}
