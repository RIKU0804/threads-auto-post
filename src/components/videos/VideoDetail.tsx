'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronDown, ChevronUp, Send } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { cx } from '@/lib/utils'
import { VideoStatusBadge, NON_TERMINAL_STATUSES } from './VideoStatusBadge'
import { SceneRow } from './SceneRow'
import type { Account, Platform, Scene, VideoStatus, VideoWithScenes } from '@/types/database'

const POLL_INTERVAL_MS = 3000

interface StatusResponse {
  status: VideoStatus
  step: string
  sceneProgress?: { completed: number; total: number }
  error?: string
}

interface VideoDetailProps {
  initialVideo: VideoWithScenes
  videoAccounts: Account[] // tiktok / youtube アカウントのみ
}

type Regenerating = { sceneId: string; target: 'image' | 'audio' } | null

export function VideoDetail({ initialVideo, videoAccounts }: VideoDetailProps) {
  const toast = useToast()
  const [video, setVideo] = useState<VideoWithScenes>(initialVideo)
  const [scriptOpen, setScriptOpen] = useState(false)
  const [statusInfo, setStatusInfo] = useState<StatusResponse | null>(null)
  const [regenerating, setRegenerating] = useState<Regenerating>(null)
  const [publishingTo, setPublishingTo] = useState<Platform | null>(null)

  const [selectedTiktok, setSelectedTiktok] = useState('')
  const [selectedYoutube, setSelectedYoutube] = useState('')

  const tiktokAccounts = useMemo(() => videoAccounts.filter(a => a.platform === 'tiktok'), [videoAccounts])
  const youtubeAccounts = useMemo(() => videoAccounts.filter(a => a.platform === 'youtube'), [videoAccounts])

  const isPolling = NON_TERMINAL_STATUSES.has(video.status)

  const refreshVideo = useCallback(async () => {
    const res = await fetch(`/api/videos/${video.id}`)
    if (!res.ok) return
    const data = await res.json() as VideoWithScenes
    setVideo(data)
  }, [video.id])

  // ステータスポーリング: 非終端状態の間だけ 3 秒間隔で叩く
  const [pollErrorCount, setPollErrorCount] = useState(0)
  const POLL_ERROR_THRESHOLD = 5

  useEffect(() => {
    if (!isPolling) return
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/videos/${video.id}/status`)
        if (!res.ok) throw new Error(`status HTTP ${res.status}`)
        const data = await res.json() as StatusResponse
        if (cancelled) return
        setStatusInfo(data)
        setPollErrorCount(0)
        if (data.status !== video.status) {
          await refreshVideo()
        }
      } catch (e) {
        if (cancelled) return
        setPollErrorCount(c => {
          const next = c + 1
          // 連続失敗が閾値を超えたらユーザーに通知
          if (next === POLL_ERROR_THRESHOLD) {
            toast.error('進捗の取得に繰り返し失敗しています。通信状況を確認してください。')
          }
          return next
        })
        console.error('[VideoDetail] status poll failed', e instanceof Error ? e.message : 'unknown')
      }
    }

    void poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isPolling, video.id, video.status, refreshVideo, toast])

  async function handleRegenerate(sceneId: string, target: 'image' | 'audio') {
    setRegenerating({ sceneId, target })
    try {
      const res = await fetch(`/api/videos/${video.id}/regenerate-scene`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId, target }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        toast.error(data.error ?? '再生成に失敗しました')
        return
      }
      toast.success(target === 'image' ? '画像を再生成しています' : '音声を再生成しています')
      // refresh later via polling
    } finally {
      setRegenerating(null)
    }
  }

  async function handlePublish(platform: 'tiktok' | 'youtube') {
    const accountId = platform === 'tiktok' ? selectedTiktok : selectedYoutube
    if (!accountId) {
      toast.error('公開先アカウントを選択してください')
      return
    }
    setPublishingTo(platform)
    try {
      const res = await fetch(`/api/videos/${video.id}/publish/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; success?: boolean; url?: string | null; platformPublishId?: string }
      if (!res.ok || !data.success) {
        toast.error(data.error ?? '公開に失敗しました')
        return
      }
      toast.success(platform === 'tiktok' ? 'TikTok に公開しました' : 'YouTube に公開しました')
      await refreshVideo()
    } finally {
      setPublishingTo(null)
    }
  }

  const progress = computeProgress(video, statusInfo)

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="mb-6">
        <Link
          href="/dashboard/videos"
          className="mb-2 inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"
        >
          <ChevronLeft className="h-4 w-4" />
          動画一覧に戻る
        </Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
            {video.title}
          </h1>
          <VideoStatusBadge status={video.status} />
        </div>

        {/* Progress bar */}
        {isPolling && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full bg-[#00A3BF] transition-all duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            {statusInfo?.sceneProgress && (
              <p className="mt-1 text-xs text-gray-500">
                {statusInfo.sceneProgress.completed} / {statusInfo.sceneProgress.total} シーン完了
              </p>
            )}
          </div>
        )}

        {video.status === 'failed' && video.error_message && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {video.error_message}
          </div>
        )}
      </div>

      {/* スクリプト */}
      {video.script && (
        <Card className="mb-4">
          <button
            type="button"
            onClick={() => setScriptOpen(v => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-sm font-semibold text-gray-700">台本</span>
            {scriptOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>
          {scriptOpen && (
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-[#F8FAFC] p-3 text-xs leading-relaxed text-gray-700">
              {video.script}
            </pre>
          )}
        </Card>
      )}

      {/* シーン */}
      {video.scenes.length > 0 && (
        <div className="mb-6 space-y-2">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">シーン</h2>
          {video.scenes.map((scene: Scene) => (
            <SceneRow
              key={scene.id}
              scene={scene}
              onRegenerate={handleRegenerate}
              regenerating={regenerating}
            />
          ))}
        </div>
      )}

      {/* 完成プレビュー */}
      {video.status === 'ready' && video.final_video_url && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">動画プレビュー</h2>
          <video
            src={video.final_video_url}
            controls
            className="w-full rounded-md"
          />
        </Card>
      )}

      {/* 公開 */}
      {video.status === 'ready' && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">公開先選択</h2>

          <PublishRow
            label="TikTok"
            accounts={tiktokAccounts}
            selected={selectedTiktok}
            onSelect={setSelectedTiktok}
            onPublish={() => handlePublish('tiktok')}
            publishing={publishingTo === 'tiktok'}
            alreadyPublished={video.published_to?.includes('tiktok') ?? false}
          />

          <div className="mt-4">
            <PublishRow
              label="YouTube"
              accounts={youtubeAccounts}
              selected={selectedYoutube}
              onSelect={setSelectedYoutube}
              onPublish={() => handlePublish('youtube')}
              publishing={publishingTo === 'youtube'}
              alreadyPublished={video.published_to?.includes('youtube') ?? false}
            />
          </div>
        </Card>
      )}
    </div>
  )
}

interface PublishRowProps {
  label: string
  accounts: Account[]
  selected: string
  onSelect: (v: string) => void
  onPublish: () => void
  publishing: boolean
  alreadyPublished: boolean
}

function PublishRow({
  label, accounts, selected, onSelect, onPublish, publishing, alreadyPublished,
}: PublishRowProps) {
  const disabled = accounts.length === 0 || !selected || publishing
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</span>
        {alreadyPublished && (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
            公開済み
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <select
          value={selected}
          onChange={e => onSelect(e.target.value)}
          aria-label={`${label} アカウント`}
          disabled={accounts.length === 0}
          className={cx(
            'min-w-0 flex-1 appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20',
            accounts.length === 0 && 'opacity-50',
          )}
        >
          {accounts.length === 0 ? (
            <option value="">{label} アカウントが未登録</option>
          ) : (
            <>
              <option value="">アカウントを選択</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </>
          )}
        </select>
        <Button
          onClick={onPublish}
          disabled={disabled}
          isLoading={publishing}
          loadingText="公開中..."
          className="shrink-0 gap-1.5"
        >
          <Send className="h-4 w-4" />
          公開する
        </Button>
      </div>
    </div>
  )
}

function computeProgress(video: VideoWithScenes, status: StatusResponse | null): number {
  switch (video.status) {
    case 'draft':
    case 'generating_script':
      return 0.1
    case 'generating_images':
      if (status?.sceneProgress && status.sceneProgress.total > 0) {
        return 0.2 + (status.sceneProgress.completed / status.sceneProgress.total) * 0.4
      }
      return 0.3
    case 'generating_voice':
      if (status?.sceneProgress && status.sceneProgress.total > 0) {
        return 0.6 + (status.sceneProgress.completed / status.sceneProgress.total) * 0.2
      }
      return 0.7
    case 'rendering':
      return 0.9
    case 'ready':
      return 1
    case 'failed':
      return 0
  }
}
