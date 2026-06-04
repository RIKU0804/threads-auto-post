'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronDown, ChevronUp, RefreshCw, Send, AlertCircle, Smartphone, Music2, Play, Camera, Pencil, Check, X, Plus, Film } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { VideoStatusBadge, NON_TERMINAL_STATUSES } from './VideoStatusBadge'
import { SceneRow } from './SceneRow'
import { PublishTikTokModal } from './PublishTikTokModal'
import { AddSceneModal } from './AddSceneModal'
import { VOICE_PRESETS, DEFAULT_VOICE_ID, findVoicePreset } from '@/lib/video/voice-presets'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import {
  ESTIMATED_TOTAL_MS,
  computeContinuousProgress,
  formatRemaining,
  type StatusResponse,
} from '@/lib/video/progress'
import type { GenerationMode, Account, Platform, Scene, VideoStatus, VideoWithScenes } from '@/types/database'

const POLL_INTERVAL_MS = 3000

// クライアントへ渡す公開可能なアカウント情報のみ（機密カラムは含めない）
export type VideoAccount = Pick<
  Account,
  'id' | 'name' | 'platform' | 'is_active' | 'tiktok_open_id' | 'youtube_channel_id' | 'instagram_user_id'
>

interface VideoDetailProps {
  initialVideo: VideoWithScenes
  videoAccounts: VideoAccount[] // tiktok / youtube / instagram アカウントのみ
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
  const confirm = useConfirm()
  const [video, setVideo] = useState<VideoWithScenes>(initialVideo)
  const [scriptOpen, setScriptOpen] = useState(false)
  const [statusInfo, setStatusInfo] = useState<StatusResponse | null>(null)
  const [regenerating, setRegenerating] = useState<Regenerating>(null)
  const [publishingTo, setPublishingTo] = useState<Platform | null>(null)
  const [tiktokModalOpen, setTiktokModalOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const [selectedYoutube, setSelectedYoutube] = useState('')
  const [selectedInstagram, setSelectedInstagram] = useState('')

  // タイトル編集
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(initialVideo.title ?? '')
  const [savingTitle, setSavingTitle] = useState(false)

  // 再レンダリング
  const [rerendering, setRerendering] = useState(false)

  // シーン操作
  const [sceneBusy, setSceneBusy] = useState(false)
  const [addSceneOpen, setAddSceneOpen] = useState(false)

  // 声変更
  const [voiceDraft, setVoiceDraft] = useState<string>(initialVideo.elevenlabs_voice_id ?? DEFAULT_VOICE_ID)
  const [savingVoice, setSavingVoice] = useState(false)

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
    // ready かつ最終 MP4 が出来ている時だけ「完成」通知を出す。
    // 声変更/編集直後は ready でも final_video_url=null（再レンダー待ち）なので誤通知しない。
    if (prev !== 'ready' && video.status === 'ready' && video.final_video_url) {
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
  // DB の generation_started_at を起点にすることでリロード後も継続して計測できる。
  // DB に値が無いとき (古いデータ) は今をスタートにフォールバック。
  useEffect(() => {
    if (!isPolling) {
      generationStartRef.current = null
      setElapsedMs(0)
      return
    }
    if (generationStartRef.current == null) {
      const dbStart = video.generation_started_at
        ? Date.parse(video.generation_started_at)
        : NaN
      generationStartRef.current = Number.isFinite(dbStart) ? dbStart : Date.now()
    }
    const tick = () => setElapsedMs(Date.now() - (generationStartRef.current ?? Date.now()))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [isPolling, video.generation_started_at])

  // アンマウント後の setState を防ぐためのマウント追跡
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refreshVideo = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${video.id}`)
      if (!res.ok) return
      const data = await res.json() as VideoWithScenes
      if (!mountedRef.current) return
      setVideo(data)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      console.error('[VideoDetail] refreshVideo failed', e instanceof Error ? e.message : 'unknown')
    }
  }, [video.id])

  // 外部更新（再生成後など）にタイトルドラフトを追従させる
  useEffect(() => {
    if (!editingTitle) setTitleDraft(video.title ?? '')
  }, [video.title, editingTitle])

  // voice の現在値を外部更新に追従
  useEffect(() => {
    setVoiceDraft(video.elevenlabs_voice_id ?? DEFAULT_VOICE_ID)
  }, [video.elevenlabs_voice_id])

  // 編集を行うとシーンが古くなる/動画が古くなる。再レンダーすべきかの判定。
  // - generation_mode が remotion
  // - status が ready or failed (生成中ではない)
  // - final_video_url が無い (= 何かしらクリアされた)
  // - scenes が全部 image_url と audio_url を持っている
  const allScenesReady = video.scenes.length > 0 &&
    video.scenes.every(s => Boolean(s.image_url) && Boolean(s.audio_url))
  const canRerender =
    video.generation_mode === 'remotion' &&
    (video.status === 'ready' || video.status === 'failed') &&
    !video.final_video_url &&
    allScenesReady

  async function handleSaveTitle() {
    const next = titleDraft.trim().slice(0, 200)
    if (!next) {
      toast.error('タイトルを入力してください')
      return
    }
    if (next === (video.title ?? '')) {
      setEditingTitle(false)
      return
    }
    setSavingTitle(true)
    // 楽観更新: 先にローカルへ反映してから API。失敗したら元に戻す。
    const prevTitle = video.title
    setVideo(prev => ({ ...prev, title: next }))
    setEditingTitle(false)
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; changed?: boolean }
      if (!res.ok) {
        // ロールバック
        setVideo(prev => ({ ...prev, title: prevTitle }))
        toast.error(data.error ?? 'タイトル更新に失敗しました')
        return
      }
      toast.success(data.changed === false ? '変更はありません' : 'タイトルを更新しました')
      // タイトル変更で final_video_url がサーバー側で null 化されるため最新状態を取り直す
      await refreshVideo()
    } catch (e) {
      setVideo(prev => ({ ...prev, title: prevTitle }))
      toast.error(e instanceof Error ? e.message : 'タイトル更新に失敗しました')
    } finally {
      setSavingTitle(false)
    }
  }

  async function handleRerender() {
    setRerendering(true)
    try {
      const res = await fetch(`/api/videos/${video.id}/render`, { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { error?: string; ok?: boolean }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? '動画の再作成に失敗しました')
        return
      }
      toast.success('最終動画を作り直しています')
      await refreshVideo()
    } finally {
      setRerendering(false)
    }
  }

  async function handleMoveScene(sceneId: string, direction: 'up' | 'down') {
    const idx = video.scenes.findIndex(s => s.id === sceneId)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= video.scenes.length) return

    const next = [...video.scenes]
    ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
    const order = next.map(s => s.id)

    setSceneBusy(true)
    try {
      const res = await fetch(`/api/videos/${video.id}/scenes/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; ok?: boolean }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? '並べ替えに失敗しました')
        return
      }
      await refreshVideo()
    } finally {
      setSceneBusy(false)
    }
  }

  async function handleDeleteScene(sceneId: string) {
    if (video.scenes.length <= 1) {
      toast.error('シーンは 1 つ以上必要です')
      return
    }
    const ok = await confirm({
      title: 'シーンを削除しますか？',
      message: 'このシーンを削除すると、生成済みの画像と音声は元に戻せません。',
      confirmLabel: '削除する',
      destructive: true,
    })
    if (!ok) return
    setSceneBusy(true)
    try {
      const res = await fetch(`/api/videos/${video.id}/scenes/${sceneId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as { error?: string; ok?: boolean }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'シーン削除に失敗しました')
        return
      }
      toast.success('シーンを削除しました')
      await refreshVideo()
    } finally {
      setSceneBusy(false)
    }
  }

  async function handleChangeVoice() {
    const currentVoice = video.elevenlabs_voice_id ?? DEFAULT_VOICE_ID
    if (voiceDraft === currentVoice) {
      toast.error('現在と同じ声です')
      return
    }
    const ok = await confirm({
      title: '声を変更しますか？',
      message: '全シーンの音声を作り直します。ElevenLabs の使用文字数が消費されます (コスト発生)。',
      confirmLabel: '変更する',
    })
    if (!ok) return
    setSavingVoice(true)
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elevenlabsVoiceId: voiceDraft }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; voiceChanged?: boolean }
      if (!res.ok) {
        toast.error(data.error ?? '声の変更に失敗しました')
        return
      }
      toast.success('声を変更しました。全シーンの音声を作り直しています')
      await refreshVideo()
    } finally {
      setSavingVoice(false)
    }
  }

  async function handleAddScene(
    payload: { caption_text: string; narration_text: string; image_prompt: string },
  ): Promise<boolean> {
    setSceneBusy(true)
    try {
      const res = await fetch(`/api/videos/${video.id}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; ok?: boolean }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'シーン追加に失敗しました')
        return false
      }
      toast.success('シーンを追加しました。画像と音声を生成しています')
      await refreshVideo()
      return true
    } catch (e) {
      // 例外時も必ず false を返す (呼び出し側がモーダルを閉じられず詰むのを防ぐ)
      toast.error(e instanceof Error ? e.message : 'シーン追加に失敗しました')
      return false
    } finally {
      setSceneBusy(false)
    }
  }

  const [pollErrorCount, setPollErrorCount] = useState(0)
  const [pollStopped, setPollStopped] = useState(false)
  const POLL_ERROR_THRESHOLD = 5   // この回数で警告 toast
  const POLL_STOP_THRESHOLD = 10   // この回数で自動更新を止める (401 永久ループ防止)
  // status と最新参照は ref に逃がして effect の依存から外す。
  // 依存にあると status が変わるたび setInterval が破棄→再生成されて
  // 短時間で多重 fetch が走る現象が起きていた。
  const videoStatusRef = useRef<VideoStatus>(video.status)
  useEffect(() => { videoStatusRef.current = video.status }, [video.status])
  const refreshVideoRef = useRef(refreshVideo)
  useEffect(() => { refreshVideoRef.current = refreshVideo }, [refreshVideo])
  // toast も ref 経由にして poll effect の依存から外す（毎レンダーで interval が
  // 作り直されて多重 fetch するのを防ぐ）。
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast }, [toast])

  // status が動いたら停止フラグを解除して再びポーリング可能にする
  useEffect(() => {
    setPollStopped(false)
    setPollErrorCount(0)
  }, [video.status])

  function resumePolling() {
    setPollErrorCount(0)
    setPollStopped(false)
  }

  useEffect(() => {
    if (!isPolling || pollStopped) return
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(`/api/videos/${video.id}/status`)
        if (!res.ok) throw new Error(`status HTTP ${res.status}`)
        const data = await res.json() as StatusResponse
        if (cancelled) return
        setStatusInfo(data)
        setPollErrorCount(0)
        if (data.status !== videoStatusRef.current) {
          await refreshVideoRef.current()
        }
      } catch (e) {
        if (cancelled) return
        setPollErrorCount(c => {
          const next = c + 1
          if (next === POLL_ERROR_THRESHOLD) {
            toastRef.current.error('進捗の取得に繰り返し失敗しています。通信状況を確認してください。')
          }
          if (next >= POLL_STOP_THRESHOLD) {
            // これ以上失敗を続けても無駄。自動更新を止めて手動再開に委ねる。
            setPollStopped(true)
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
  }, [isPolling, pollStopped, video.id])

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
      // status が generating_* に遷移しているので、refresh で拾って
      // 既存ポーリングを発火させ、完了（ready）まで自動追跡する。
      await refreshVideo()
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
          className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-600"
        >
          <ChevronLeft className="h-4 w-4" />
          動画一覧に戻る
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  maxLength={200}
                  autoFocus
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xl font-semibold text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20 lg:text-2xl"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditingTitle(false); setTitleDraft(video.title ?? '') }}
                    disabled={savingTitle}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <X className="h-3 w-3" /> キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTitle}
                    disabled={savingTitle}
                    className="inline-flex items-center gap-1 rounded-md bg-[#00A3BF] px-2.5 py-1 text-xs text-white hover:bg-[#008CA8] disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" /> 保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
                  {video.title}
                </h1>
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  title="タイトルを編集"
                  aria-label="タイトルを編集"
                  className="mt-1 rounded-md p-1 text-gray-500 hover:bg-gray-50 hover:text-[#00A3BF]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
          <VideoStatusBadge status={video.status} />
        </div>

        {/* 進捗（生成中） */}
        {isPolling && (
          <div
            className="mt-4 space-y-2 rounded-lg border border-gray-200 bg-white p-3"
            role="status"
            aria-live="polite"
            aria-busy={isPolling}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700">{getStepLabel(video.status, video.generation_mode)}</span>
              <span className="text-gray-500">
                {statusInfo?.sceneProgress
                  ? `${statusInfo.sceneProgress.completed} / ${statusInfo.sceneProgress.total} シーン`
                  : `あと約 ${formatRemaining(remainingMs)}`}
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={getStepLabel(video.status, video.generation_mode)}
            >
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

        {/* ポーリングが連続失敗で停止したときの手動再開 */}
        {isPolling && pollStopped && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <p className="text-[11px] text-amber-700">
                進捗の自動更新を停止しました（通信エラーが続いたため）。処理自体は続いている可能性があります。
              </p>
            </div>
            <Button
              onClick={resumePolling}
              variant="ghost"
              className="shrink-0 gap-1.5 border border-amber-300 text-amber-700"
            >
              <RefreshCw className="h-4 w-4" />
              更新を再開
            </Button>
          </div>
        )}

        {/* 失敗時のリカバリ UI */}
        {video.status === 'failed' && (() => {
          // エラーメッセージから「API キー未登録」を検知して設定リンクへ誘導する
          const isMissingKey = typeof video.error_message === 'string' &&
            /API\s*キー.*設定されていません|MissingApiKey|MissingElevenLabs|MissingHeyGen/i.test(video.error_message)
          return (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-700">動画の生成に失敗しました</p>
                  {video.error_message && (
                    <p className="mt-1 text-xs text-red-600 break-words">{video.error_message}</p>
                  )}
                  {isMissingKey ? (
                    <>
                      <p className="mt-2 text-[11px] text-red-500">
                        必要な API キーがまだ登録されていません。設定ページから登録するとこの動画も再開できます。
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link
                          href="/dashboard/settings"
                          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                          設定ページを開く
                        </Link>
                        <Button
                          onClick={handleRestart}
                          isLoading={restarting}
                          loadingText="再開中..."
                          variant="ghost"
                          className="gap-1.5 border border-red-300 text-red-700"
                        >
                          <RefreshCw className="h-4 w-4" />
                          キー登録後に再開
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })()}
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
            {scriptOpen ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
          </button>
          {scriptOpen && (
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-[#F8FAFC] p-3 text-xs leading-relaxed text-gray-700">
              {video.script}
            </pre>
          )}
        </Card>
      )}

      {/* 公開済みなのに最終MP4が無い (= 編集された) ときの警告 */}
      {video.status === 'ready' && !video.final_video_url && (video.published_to?.length ?? 0) > 0 && (
        <Card className="mb-4 border-orange-300 bg-orange-50">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-orange-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-orange-800">公開済み動画を編集中です</p>
              <p className="mt-0.5 text-[11px] text-orange-700">
                既に <strong>{video.published_to?.join(' / ')}</strong> に公開済みですが、編集内容は <strong>公開先には自動で反映されません</strong>。
                変更を反映したい場合は「動画を作り直す」で MP4 を再生成し、各プラットフォームから手動で再公開してください。
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* 声 (Remotion 経路のみ) */}
      {video.generation_mode === 'remotion' && (
        <Card className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">ナレーションの声</span>
            <span className="text-[10px] text-gray-500">
              {findVoicePreset(video.elevenlabs_voice_id)?.label ?? '既定の声'}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={voiceDraft}
              onChange={(e) => setVoiceDraft(e.target.value)}
              disabled={savingVoice || NON_TERMINAL_STATUSES.has(video.status)}
              aria-label="ナレーションの声"
              className="min-w-0 flex-1 appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {VOICE_PRESETS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}（{v.tag}）
                </option>
              ))}
            </select>
            <Button
              onClick={handleChangeVoice}
              disabled={
                savingVoice ||
                NON_TERMINAL_STATUSES.has(video.status) ||
                voiceDraft === (video.elevenlabs_voice_id ?? DEFAULT_VOICE_ID)
              }
              isLoading={savingVoice}
              loadingText="変更中..."
              variant="ghost"
              className="shrink-0 border border-gray-300 gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              声を変更して再生成
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            {VOICE_PRESETS.find((v) => v.id === voiceDraft)?.description ?? ''}
          </p>
          <p className="mt-1 text-[10px] text-gray-500">
            ⚠️ 声変更は全シーンの音声を作り直すため、ElevenLabs の使用文字数を消費します。
          </p>
        </Card>
      )}

      {/* 再レンダー誘導 (シーン編集後で final_video_url が無くなったとき) */}
      {canRerender && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Film className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">変更が動画にまだ反映されていません</p>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  シーンの編集・追加・削除・並べ替えがあったため、最終動画を作り直す必要があります。
                </p>
              </div>
            </div>
            <Button
              onClick={handleRerender}
              isLoading={rerendering}
              loadingText="準備中..."
              className="shrink-0 gap-1.5 bg-amber-600 hover:bg-amber-700"
            >
              <RefreshCw className="h-4 w-4" />
              動画を作り直す
            </Button>
          </div>
        </Card>
      )}

      {/* シーン */}
      {video.scenes.length > 0 && (
        <div className="mb-6 space-y-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">シーン</h2>
            {video.generation_mode === 'remotion' &&
              (video.status === 'ready' || video.status === 'failed') &&
              video.scenes.length < 10 && (
              <button
                type="button"
                onClick={() => setAddSceneOpen(true)}
                disabled={sceneBusy}
                className="inline-flex items-center gap-1 rounded-md border border-[#e5edf5] px-2 py-1 text-[11px] text-[#00A3BF] hover:bg-[#F8FAFC] disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                シーン追加
              </button>
            )}
          </div>
          {video.scenes.map((scene: Scene, idx: number) => {
            const canEditStructure = video.generation_mode === 'remotion' &&
              (video.status === 'ready' || video.status === 'failed') &&
              !sceneBusy
            return (
              <SceneRow
                key={scene.id}
                scene={scene}
                videoId={video.id}
                onRegenerate={handleRegenerate}
                onEdited={refreshVideo}
                onMoveUp={canEditStructure ? () => handleMoveScene(scene.id, 'up') : undefined}
                onMoveDown={canEditStructure ? () => handleMoveScene(scene.id, 'down') : undefined}
                onDelete={canEditStructure ? () => handleDeleteScene(scene.id) : undefined}
                canMoveUp={idx > 0}
                canMoveDown={idx < video.scenes.length - 1}
                canDelete={video.scenes.length > 1}
                regenerating={regenerating}
              />
            )
          })}
        </div>
      )}

      {/* シーン追加モーダル */}
      <AddSceneModal
        open={addSceneOpen}
        onClose={() => setAddSceneOpen(false)}
        onSubmit={async (payload) => {
          const ok = await handleAddScene(payload)
          if (ok) setAddSceneOpen(false)
        }}
        busy={sceneBusy}
      />


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

      {/* 公開: status=ready + final_video_url が両方揃わないと許可しない */}
      {video.status === 'ready' && !video.final_video_url && (
        <Card className="mb-4 border-gray-300 bg-gray-50">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-gray-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-700">公開するには動画を作り直してください</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                編集内容が最終動画に反映されていないため、まだ公開できません。
                上の「動画を作り直す」ボタンで MP4 を生成してから公開してください。
              </p>
            </div>
          </div>
        </Card>
      )}
      {video.status === 'ready' && video.final_video_url && (
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
