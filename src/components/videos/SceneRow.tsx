'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Play, Pause, RefreshCw } from 'lucide-react'
import { cx } from '@/lib/utils'
import type { Scene } from '@/types/database'

interface SceneRowProps {
  scene: Scene
  onRegenerate: (sceneId: string, target: 'image' | 'audio') => void
  regenerating: { sceneId: string; target: 'image' | 'audio' } | null
}

export function SceneRow({ scene, onRegenerate, regenerating }: SceneRowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)

  // unmount or audio_url 変更時に音声を停止・解放（メモリ/再生リーク防止）
  useEffect(() => {
    return () => {
      const el = audioRef.current
      if (el) {
        el.pause()
        el.src = ''
        audioRef.current = null
      }
    }
  }, [scene.audio_url])

  const imageBusy = regenerating?.sceneId === scene.id && regenerating.target === 'image'
  const audioBusy = regenerating?.sceneId === scene.id && regenerating.target === 'audio'

  function togglePlay() {
    if (!scene.audio_url) return
    const existing = audioRef.current
    if (existing && !existing.paused) {
      existing.pause()
      setPlaying(false)
      return
    }
    const el = existing ?? new Audio(scene.audio_url)
    if (!existing) {
      el.addEventListener('ended', () => setPlaying(false))
      audioRef.current = el
    }
    setAudioError(null)
    el.play()
      .then(() => setPlaying(true))
      .catch(err => {
        // モバイル Chrome の autoplay policy 等で NotAllowedError が出る
        setAudioError(err instanceof Error ? err.message : '再生に失敗しました')
        setPlaying(false)
      })
  }

  const caption = scene.caption_text ?? scene.narration_text ?? ''
  const captionPreview = caption.length > 80 ? caption.slice(0, 80) + '…' : caption

  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#e5edf5] bg-white p-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
        {scene.order_index + 1}
      </div>

      {/* シーン画像 */}
      <div className="shrink-0">
        {scene.image_url ? (
          <img
            src={scene.image_url}
            alt={`シーン ${scene.order_index + 1}`}
            className="h-20 w-20 rounded-md object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-[#e5edf5] bg-gray-50">
            <ImageIcon className="h-5 w-5 text-gray-300" />
          </div>
        )}
      </div>

      {/* キャプション + アクション */}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-gray-700">{captionPreview || '（キャプション未生成）'}</p>
        {scene.duration !== null && (
          <p className="mt-1 text-[10px] text-gray-400">{scene.duration.toFixed(1)} 秒</p>
        )}
        {audioError && (
          <p className="mt-1 text-[10px] text-red-500" role="alert">{audioError}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!scene.audio_url}
            className={cx(
              'flex items-center gap-1 rounded-md border border-[#e5edf5] px-2 py-1 text-[11px]',
              scene.audio_url
                ? 'text-gray-700 hover:bg-[#F8FAFC]'
                : 'cursor-not-allowed text-gray-300',
            )}
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            音声
          </button>
          <button
            type="button"
            onClick={() => onRegenerate(scene.id, 'image')}
            disabled={imageBusy}
            className="flex items-center gap-1 rounded-md border border-[#e5edf5] px-2 py-1 text-[11px] text-gray-600 hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            <RefreshCw className={cx('h-3 w-3', imageBusy && 'animate-spin')} />
            画像再生成
          </button>
          <button
            type="button"
            onClick={() => onRegenerate(scene.id, 'audio')}
            disabled={audioBusy}
            className="flex items-center gap-1 rounded-md border border-[#e5edf5] px-2 py-1 text-[11px] text-gray-600 hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            <RefreshCw className={cx('h-3 w-3', audioBusy && 'animate-spin')} />
            音声再生成
          </button>
        </div>
      </div>
    </div>
  )
}
