'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronDown, ChevronUp, RefreshCw, Send, AlertCircle, Smartphone, Music2, Play, Camera } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { VideoStatusBadge, NON_TERMINAL_STATUSES } from './VideoStatusBadge'
import { SceneRow } from './SceneRow'
import { PublishTikTokModal } from './PublishTikTokModal'
import type { Account, GenerationMode, Platform, Scene, VideoStatus, VideoWithScenes } from '@/types/database'

const POLL_INTERVAL_MS = 3000
const ESTIMATED_TOTAL_MS = 3 * 60 * 1000 // 平均3分の見積もり

interface StatusResponse {
  status: VideoStatus
  step: string
  sceneProgress?: { completed: number; total: number }
  error?: string
}

interface VideoDetailProps {
  initialVideo: VideoWithScenes
  videoAccounts: Account[] // tiktok / youtube / instagram アカウントのみ
}

type Regenerating = { sceneId: string; target: 'image' | 'audio' } | null

/**
 * 進捗バー上に出すラベル。
 * HeyGen モードでは画像生成フェーズが無く、rendering の意味も「アバターを動かす」になるので
 * モードで文言を出し分ける。
 */
function getStepLabel(status: VideoStatus, mode: GenerationMode): string {
  if (mode === 'heygen_avatar') {
    switch (status) {
      case 'draft': return '生成準備中'
      case 'generating_script': return '台本を書いています'
      case 'generating_images': return '準備中'
      case 'generating_voice': return 'ナレーション音声を作成中'
      case 'rendering': return 'HeyGen でアバター動画を生成中'
      case 'ready': return '完成'
      case 'failed': return '失敗'
    }
  }
  switch (status) {
    case 'draft': return '生成準備中'
    case 'generating_script': return '台本を書いています'
    case 'generating_images': return '画像を作っています'
    case 'generating_voice': return '音声を作っています'
    case 'rendering': return '動画を書き出しています'
    case 'ready': return '完成'
    case 'failed': return '失敗'
  }
}

export function VideoDetail({ initialVideo, videoAccounts }: VideoDetailProps) {
  const toast = useToast()
  const [video, setVideo] = useState<VideoWithScenes>(initialVideo)
  const [scriptOpen, setScriptOpen] = useState(false)
  const [statusInfo, setStatusInfo] = useState<StatusResponse | null>(null)
  const [regenerating, setRegenerating] = useState<Regenerating>(null)
  const [publishingTo, setPublishingTo] = useState<Platform | null>(null)
  const [tiktokModalOpen, setTiktokModalOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const [selectedYoutube, setSelectedYoutube] = useState('')
  const [selectedInstagram, setSelectedInstagram] = useState('')

  // 開始時刻を追跡（残り時間推定用）
  const generationStartRef = useRef<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const tiktokAccounts = useMemo(() => videoAccounts.filter(a => a.platform === 'tiktok'), [videoAccounts])
  const youtubeAccounts = useMemo(() => videoAccounts.filter(a => a.platform === 'youtube'), [videoAccounts])
  const instagramAccounts = useMemo(() => videoAccounts.filter(a => a.platform === 'instagram'), [videoAccounts])

  const isPolling = NON_TERMINAL_STATUSES.has(video.status)

  // 完了時のブラウザ通知許可リクエスト（生成中になったらまず聞く）
  useEffect(() => {
    if (!isPolling) return
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined)
    }
  }, [isPolling])

  // 完了検知時にブラウザ通知
  const lastStatusRef = useRef<VideoStatus>(video.status)
  useEffect(() => {
    const prev = lastStatusRef.current
    lastStatusRef.current = video.status
    if (prev !== 'ready' && video.status === 'ready') {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('動画が完成しました', { body: video.title ?? '' })
        } catch {}
      }
    }
    if (prev !== 'failed' && video.status === 'failed') {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('動画の生成に失敗しました', { body: video.title ?? '' })
        } catch {}
      }
    }
  }, [video.status, video.title])

  // 経過時間タイマー（残り時間表示用）
  useEffect(() => {
    if (!isPolling) {
      generationStartRef.current = null
      setElapsedMs(0)
      return
    }
    if (generationStartRef.current == null) generationStartRef.current = Date.now()
    const tick = () => setElapsedMs(Date.now() - (generationStartRef.current ?? Date.now()))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [isPolling])

  const refreshVideo = useCallback(async () => {
    const res = await fetch(`/api/videos/${video.id}`)
    if (!res.ok) return
    const data = await res.json() as VideoWithScenes
    setVideo(data)
  }, [video.id])

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
    } finally {
      setRegenerating(null)
    }
  }

  async function handleRestart() {
    setRestarting(true)
    try {
      const res = await fetch(`/api/videos/${video.id}/restart`, { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { error?: string; ok?: boolean }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? '再開に失敗しました')
        return
      }
      toast.success('生成を再開しました')
      await refreshVideo()
    } finally {
      setRestarting(false)
    }
  }

  async function handlePublishYouTube() {
    if (!selectedYoutube) {
      toast.error('公開先アカウントを選択してください')
      return
    }
    setPublishingTo('youtube')
    try {
      const res = await fetch(`/api/videos/${video.id}/publish/youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedYoutube }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; success?: boolean }
      if (!res.ok || !data.success) {
        toast.error(data.error ?? '公開に失敗しました')
        return
      }
      toast.success('YouTube に公開しました')
      await refreshVideo()
    } finally {
      setPublishingTo(null)
    }
  }

  async function handlePublishInstagram() {
    if (!selectedInstagram) {
      toast.error('公開先アカウントを選択してください')
      return
    }
    setPublishingTo('instagram')
    try {
      const res = await fetch(`/api/videos/${video.id}/publish/instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedInstagram }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; success?: boolean }
      if (!res.ok || !data.success) {
        toast.error(data.error ?? '公開に失敗しました')
        return
      }
      toast.success('Instagram Reels に公開しました')
      await refreshVideo()
    } finally {
      setPublishingTo(null)
    }
  }

  const progress = computeContinuousProgress(
    video.status,
    statusInfo,
    elapsedMs,
    video.generation_mode,
    video.voice_source,
  )
  const remainingMs = Math.max(0, ESTIMATED_TOTAL_MS - elapsedMs)

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
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

        {/* 進捗（生成中） */}
        {isPolling && (
          <div className="mt-4 space-y-2 rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700">{getStepLabel(video.status, video.generation_mode)}</span>
              <span className="text-gray-500">
                {statusInfo?.sceneProgress
                  ? `${statusInfo.sceneProgress.completed} / ${statusInfo.sceneProgress.total} シーン`
                  : `あと約 ${formatRemaining(remainingMs)}`}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full bg-[#00A3BF] transition-all duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-500">
              📌 完成まで平均3分かかります。<strong>このタブを閉じても処理は続きます</strong>。完成時にブラウザ通知でお知らせします（許可が必要）。
            </p>
          </div>
        )}

        {/* 失敗時のリカバリ UI */}
        {video.status === 'failed' && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-700">動画の生成に失敗しました</p>
                {video.error_message && (
                  <p className="mt-1 text-xs text-red-600 break-words">{video.error_message}</p>
                )}
                <p className="mt-2 text-[11px] text-red-500">
                  途中まで作れている分（画像・音声）は残っているので、再開すれば未完了の部分だけ作り直します。
                </p>
                <div className="mt-2">
                  <Button
                    onClick={handleRestart}
                    isLoading={restarting}
                    loadingText="再開中..."
                    variant="ghost"
                    className="gap-1.5 border border-red-300 text-red-700"
                  >
                    <RefreshCw className="h-4 w-4" />
                    最初からやり直す
                  </Button>
                </div>
              </div>
            </div>
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
              videoId={video.id}
              onRegenerate={handleRegenerate}
              onEdited={refreshVideo}
              regenerating={regenerating}
            />
          ))}
        </div>
      )}

      {/* 完成プレビュー: 9:16 縦長で表示 */}
      {video.status === 'ready' && video.final_video_url && (
        <Card className="mb-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700">プレビュー（実機イメージ）</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
              <Smartphone className="h-3 w-3" /> 9:16
            </span>
          </div>
          <div className="flex justify-center">
            <div
              className="overflow-hidden rounded-[20px] border-4 border-gray-900 bg-black shadow-lg"
              style={{ width: 'min(280px, 70vw)', aspectRatio: '9 / 16' }}
            >
              <video
                src={video.final_video_url}
                controls
                playsInline
                className="h-full w-full object-cover"
              />
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-gray-500">
            実際の TikTok / YouTube Shorts での見え方に近い表示です
          </p>
        </Card>
      )}

      {/* 公開 */}
      {video.status === 'ready' && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">公開先</h2>

          {/* TikTok */}
          <div className="space-y-2 border-l-2 border-gray-900/80 pl-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <Music2 className="h-3.5 w-3.5 text-gray-900" />
                TikTok
              </span>
              {video.published_to?.includes('tiktok') && (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">公開済み</span>
              )}
            </div>
            {tiktokAccounts.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-600">TikTok アカウントが未連携です</p>
                <Link
                  href="/dashboard/accounts"
                  className="mt-1.5 inline-block text-xs font-medium text-[#00A3BF] hover:underline"
                >
                  TikTok を連携する →
                </Link>
              </div>
            ) : (
              <Button
                onClick={() => setTiktokModalOpen(true)}
                disabled={publishingTo !== null}
                className="w-full gap-1.5"
              >
                <Send className="h-4 w-4" />
                TikTokへ公開（キャプションや公開範囲を編集）
              </Button>
            )}
          </div>

          {/* YouTube（インライン公開のまま） */}
          <div className="mt-4 space-y-2 border-l-2 border-red-600 pl-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <Play className="h-3.5 w-3.5 fill-red-600 text-red-600" />
                YouTube Shorts
              </span>
              {video.published_to?.includes('youtube') && (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">公開済み</span>
              )}
            </div>
            {youtubeAccounts.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-600">YouTube アカウントが未連携です</p>
                <Link
                  href="/dashboard/accounts"
                  className="mt-1.5 inline-block text-xs font-medium text-[#00A3BF] hover:underline"
                >
                  YouTube を連携する →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedYoutube}
                  onChange={e => setSelectedYoutube(e.target.value)}
                  aria-label="YouTube アカウント"
                  className="min-w-0 flex-1 appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
                >
                  <option value="">アカウントを選択</option>
                  {youtubeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <Button
                  onClick={handlePublishYouTube}
                  disabled={!selectedYoutube || publishingTo !== null}
                  isLoading={publishingTo === 'youtube'}
                  loadingText="公開中..."
                  className="shrink-0 gap-1.5"
                >
                  <Send className="h-4 w-4" />
                  公開
                </Button>
              </div>
            )}
          </div>

          {/* Instagram Reels */}
          <div className="mt-4 space-y-2 border-l-2 border-pink-500 pl-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <Camera className="h-3.5 w-3.5 text-pink-500" />
                Instagram Reels
              </span>
              {video.published_to?.includes('instagram') && (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">公開済み</span>
              )}
            </div>
            {instagramAccounts.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-600">Instagram アカウントが未連携です</p>
                <Link
                  href="/dashboard/accounts"
                  className="mt-1.5 inline-block text-xs font-medium text-[#00A3BF] hover:underline"
                >
                  Instagram を連携する →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedInstagram}
                  onChange={e => setSelectedInstagram(e.target.value)}
                  aria-label="Instagram アカウント"
                  className="min-w-0 flex-1 appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
                >
                  <option value="">アカウントを選択</option>
                  {instagramAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <Button
                  onClick={handlePublishInstagram}
                  disabled={!selectedInstagram || publishingTo !== null}
                  isLoading={publishingTo === 'instagram'}
                  loadingText="公開中..."
                  className="shrink-0 gap-1.5"
                >
                  <Send className="h-4 w-4" />
                  公開
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      <PublishTikTokModal
        open={tiktokModalOpen}
        onClose={() => setTiktokModalOpen(false)}
        videoId={video.id}
        accounts={tiktokAccounts}
        defaultCaption={video.title ?? ''}
        onPublished={refreshVideo}
      />
    </div>
  )
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'もう少し'
  const sec = Math.ceil(ms / 1000)
  if (sec < 60) return `${sec}秒`
  const min = Math.ceil(sec / 60)
  return `${min}分`
}

/**
 * 離散ステップ + 経過時間から、連続的な進捗 (0..1) を出す。
 * ステップが進めばその下限まで一気に飛び、ステップ内では経過時間で滑らかに進む。
 * HeyGen モードはシーン分割した画像生成が無いので breakpoint を変える。
 */
function computeContinuousProgress(
  status: VideoStatus,
  info: StatusResponse | null,
  elapsedMs: number,
  mode: GenerationMode,
  voiceSource: VideoWithScenes['voice_source'],
): number {
  const elapsedFrac = Math.min(1, elapsedMs / ESTIMATED_TOTAL_MS)

  if (mode === 'heygen_avatar') {
    // HeyGen: script 0-25 / voice 25-45 (elevenlabs のみ) / rendering 45-95 / ready 100
    switch (status) {
      case 'draft':
      case 'generating_script':
        return Math.min(0.25, 0.05 + elapsedFrac * 0.2)
      case 'generating_voice':
        // HeyGen 内蔵ボイス時はここを通らないが、念のため
        return Math.min(0.45, 0.25 + elapsedFrac * 0.2)
      case 'generating_images':
        // HeyGen ではここに来ない想定だが、来たら voice と同じ帯で扱う
        return voiceSource === 'elevenlabs' ? 0.45 : 0.25
      case 'rendering':
        return Math.min(0.95, 0.45 + elapsedFrac * 0.5)
      case 'ready':
        return 1
      case 'failed':
        return 0
    }
  }

  switch (status) {
    case 'draft':
    case 'generating_script':
      return Math.min(0.18, 0.05 + elapsedFrac * 0.13)
    case 'generating_images': {
      const base = 0.2
      const span = 0.4
      if (info?.sceneProgress && info.sceneProgress.total > 0) {
        return base + (info.sceneProgress.completed / info.sceneProgress.total) * span
      }
      return Math.min(base + span - 0.05, base + elapsedFrac * span)
    }
    case 'generating_voice': {
      const base = 0.6
      const span = 0.2
      if (info?.sceneProgress && info.sceneProgress.total > 0) {
        return base + (info.sceneProgress.completed / info.sceneProgress.total) * span
      }
      return Math.min(base + span - 0.02, base + elapsedFrac * span)
    }
    case 'rendering':
      return Math.min(0.97, 0.85 + elapsedFrac * 0.12)
    case 'ready':
      return 1
    case 'failed':
      return 0
  }
}
