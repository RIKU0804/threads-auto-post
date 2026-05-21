import Link from 'next/link'
import { Video as VideoIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { VideoStatusBadge } from './VideoStatusBadge'
import type { Video } from '@/types/database'

interface VideoCardData extends Video {
  scenes?: { count: number }[] | { count: number } | null
  thumbnail_url?: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getSceneCount(scenes: VideoCardData['scenes']): number {
  if (!scenes) return 0
  if (Array.isArray(scenes)) return scenes[0]?.count ?? 0
  return scenes.count ?? 0
}

interface VideoCardProps {
  video: VideoCardData
}

export function VideoCard({ video }: VideoCardProps) {
  const sceneCount = getSceneCount(video.scenes)

  return (
    <Link href={`/dashboard/videos/${video.id}`} className="block">
      <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
        <div className="flex h-32 w-full items-center justify-center bg-gray-100">
          {video.thumbnail_url ? (
            <img src={video.thumbnail_url} alt={video.title} className="h-full w-full object-cover" />
          ) : (
            <VideoIcon className="h-8 w-8 text-gray-300" />
          )}
        </div>
        <div className="space-y-2 p-4">
          <div className="flex items-center gap-2">
            <VideoStatusBadge status={video.status} />
            <span className="text-[11px] text-gray-400">{sceneCount} シーン</span>
          </div>
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-gray-900">{video.title}</h3>
          <p className="text-[11px] text-gray-400">{formatDate(video.created_at)}</p>
        </div>
      </Card>
    </Link>
  )
}
