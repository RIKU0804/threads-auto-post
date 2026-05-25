'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Video as VideoIcon, Copy } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { VideoStatusBadge } from './VideoStatusBadge'
import type { GenerationMode, Video } from '@/types/database'

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

const MODE_CHIP: Record<GenerationMode, { label: string; cls: string }> = {
  heygen_avatar: { label: 'AIアバター', cls: 'bg-purple-50 text-purple-700' },
  remotion: { label: 'シーン合成', cls: 'bg-gray-100 text-gray-600' },
}

interface VideoCardProps {
  video: VideoCardData
}

export function VideoCard({ video }: VideoCardProps) {
  const router = useRouter()
  const sceneCount = getSceneCount(video.scenes)
  const modeChip = MODE_CHIP[video.generation_mode] ?? MODE_CHIP.remotion

  function handleDuplicate(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    // タイトルをテーマとして新規作成画面にプリフィル
    const theme = (video.title ?? '').slice(0, 200)
    router.push(`/dashboard/videos/new?theme=${encodeURIComponent(theme)}`)
  }

  return (
    <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
      <Link href={`/dashboard/videos/${video.id}`} className="block">
        <div className="flex h-32 w-full items-center justify-center bg-gray-100">
          {video.thumbnail_url ? (
            <img src={video.thumbnail_url} alt={video.title} className="h-full w-full object-cover" />
          ) : (
            <VideoIcon className="h-8 w-8 text-gray-300" />
          )}
        </div>
        <div className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={
                'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ' +
                modeChip.cls
              }
            >
              {modeChip.label}
            </span>
            <VideoStatusBadge status={video.status} />
            <span className="text-[11px] text-gray-400">{sceneCount} シーン</span>
          </div>
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-gray-900">{video.title}</h3>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-400">{formatDate(video.created_at)}</p>
            <button
              type="button"
              onClick={handleDuplicate}
              title="このテーマでもう一本作る"
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-[#00A3BF] hover:text-[#006F83]"
            >
              <Copy className="h-3 w-3" /> 複製
            </button>
          </div>
        </div>
      </Link>
    </Card>
  )
}
