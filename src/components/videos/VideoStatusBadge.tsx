import { cx } from '@/lib/utils'
import type { VideoStatus } from '@/types/database'

const STATUS_CONFIG: Record<VideoStatus, { label: string; cls: string }> = {
  draft:              { label: '下書き',     cls: 'bg-gray-100 text-gray-600' },
  generating_script:  { label: '台本生成中', cls: 'bg-blue-50 text-blue-600' },
  generating_images:  { label: '画像生成中', cls: 'bg-blue-50 text-blue-600' },
  generating_voice:   { label: '音声生成中', cls: 'bg-blue-50 text-blue-600' },
  rendering:          { label: '動画書き出し中', cls: 'bg-blue-50 text-blue-600' },
  ready:              { label: '完成', cls: 'bg-green-50 text-green-700' },
  failed:             { label: 'エラー', cls: 'bg-red-50 text-red-600' },
}

export const NON_TERMINAL_STATUSES = new Set<VideoStatus>([
  'draft',
  'generating_script',
  'generating_images',
  'generating_voice',
  'rendering',
])

interface VideoStatusBadgeProps {
  status: VideoStatus
  className?: string
}

export function VideoStatusBadge({ status, className }: VideoStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        cfg.cls,
        className,
      )}
    >
      {cfg.label}
    </span>
  )
}
