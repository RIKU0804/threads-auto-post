'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Play, Pause, RefreshCw, Pencil, Check, X, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { Scene } from '@/types/database'

interface SceneRowProps {
  scene: Scene
  videoId: string
  onRegenerate: (sceneId: string, target: 'image' | 'audio') => void
  onEdited?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDelete?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  canDelete?: boolean
  regenerating: { sceneId: string; target: 'image' | 'audio' } | null
}

export function SceneRow({
  scene,
  videoId,
  onRegenerate,
  onEdited,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp = false,
  canMoveDown = false,
  canDelete = false,
  regenerating,
}: SceneRowProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)

  // 再生成は外部 API コスト（ElevenLabs 文字数 / 画像生成）が発生するので確認を挟む。
  async function handleRegenerate(target: 'image' | 'audio') {
    const label = target === 'image' ? '画像' : '音声'
    const ok = await confirm({
      title: `${label}を再生成しますか？`,
      message: `この${label}を作り直します。${target === 'image' ? '画像生成' : 'ElevenLabs の文字数'}を消費します（コスト発生）。`,
      confirmLabel: '再生成する',
    })
    if (!ok) return
    onRegenerate(scene.id, target)
  }

  const [editingCaption, setEditingCaption] = useState(false)
  const [captionDraft, setCaptionDraft] = useState(scene.caption_text ?? '')
  const [editingNarration, setEditingNarration] = useState(false)
  const [narrationDraft, setNarrationDraft] = useState(scene.narration_text ?? '')
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [promptDraft, setPromptDraft] = useState(scene.image_prompt ?? '')
  const [saving, setSaving] = useState(false)

  // unmount or audio_url 変更時に音声を停止・解放
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

  // 外部更新（再生成後など）に追従
  useEffect(() => {
    if (!editingCaption) setCaptionDraft(scene.caption_text ?? '')
  }, [scene.caption_text, editingCaption])
  useEffect(() => {
    if (!editingNarration) setNarrationDraft(scene.narration_text ?? '')
  }, [scene.narration_text, editingNarration])
  useEffect(() => {
    if (!editingPrompt) setPromptDraft(scene.image_prompt ?? '')
  }, [scene.image_prompt, editingPrompt])

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
        setAudioError(err instanceof Error ? err.message : '再生に失敗しました')
        setPlaying(false)
      })
  }

  async function saveTexts(patch: { caption_text?: string; narration_text?: string; image_prompt?: string }) {
    setSaving(true)
    try {
      const res = await fetch(`/api/videos/${videoId}/scenes/${scene.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; narrationChanged?: boolean; imageChanged?: boolean }
      if (!res.ok) {
        toast.error(data.error ?? '保存に失敗しました')
        return false
      }
      if (data.imageChanged) {
        toast.success('画像プロンプトを更新しました。画像を再生成しています')
      } else if (data.narrationChanged) {
        toast.success('ナレーションを更新しました。音声を再生成しています')
      } else {
        toast.success('更新しました')
      }
      onEdited?.()
      return true
    } finally {
      setSaving(false)
    }
  }

  async function commitCaption() {
    const ok = await saveTexts({ caption_text: captionDraft })
    if (ok) setEditingCaption(false)
  }
  async function commitNarration() {
    const ok = await saveTexts({ narration_text: narrationDraft })
    if (ok) setEditingNarration(false)
  }
  async function commitPrompt() {
    const ok = await saveTexts({ image_prompt: promptDraft })
    if (ok) setEditingPrompt(false)
  }

  const showRowActions = Boolean(onMoveUp || onMoveDown || onDelete)

  return (
    <div className="rounded-lg border border-[#e5edf5] bg-white p-3">
      {showRowActions && (
        <div className="mb-2 flex items-center justify-end gap-1">
          {onMoveUp && (
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              title="上に移動"
              aria-label="上に移動"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-[#e5edf5] text-gray-500 hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-[#00A3BF] disabled:cursor-not-allowed disabled:opacity-30 sm:h-11 sm:w-11"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          )}
          {onMoveDown && (
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              title="下に移動"
              aria-label="下に移動"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-[#e5edf5] text-gray-500 hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-[#00A3BF] disabled:cursor-not-allowed disabled:opacity-30 sm:h-11 sm:w-11"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={!canDelete}
              title="このシーンを削除"
              aria-label="このシーンを削除"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-[#e5edf5] text-gray-500 hover:bg-red-50 hover:text-red-500 focus-visible:outline-2 focus-visible:outline-[#00A3BF] disabled:cursor-not-allowed disabled:opacity-30 sm:h-11 sm:w-11"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex items-center gap-3 sm:items-start">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
            {scene.order_index + 1}
          </div>
          <div className="shrink-0">
            {scene.image_url ? (
              <img
                src={scene.image_url}
                alt={`シーン ${scene.order_index + 1}`}
                width={96}
                height={96}
                className="h-20 w-20 rounded-md object-cover sm:h-24 sm:w-24"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-[#e5edf5] bg-gray-50 sm:h-24 sm:w-24">
                <ImageIcon className="h-5 w-5 text-gray-300" />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {/* キャプション */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">キャプション</span>
              {!editingCaption && (
                <button
                  type="button"
                  onClick={() => setEditingCaption(true)}
                  className="inline-flex items-center gap-1 text-[10px] text-[#00A3BF] hover:underline"
                >
                  <Pencil className="h-3 w-3" /> 編集
                </button>
              )}
            </div>
            {editingCaption ? (
              <div className="mt-1 space-y-1.5">
                <textarea
                  value={captionDraft}
                  onChange={e => setCaptionDraft(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
                  placeholder="画面上に表示されるテキスト"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditingCaption(false); setCaptionDraft(scene.caption_text ?? '') }}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                  >
                    <X className="h-3 w-3" /> キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={commitCaption}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md bg-[#00A3BF] px-2 py-1 text-[11px] text-white hover:bg-[#008CA8] disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" /> 保存
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-0.5 text-sm leading-relaxed text-gray-700">
                {scene.caption_text || <span className="text-gray-500">（未設定）</span>}
              </p>
            )}
          </div>

          {/* ナレーション */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">ナレーション</span>
              {!editingNarration && (
                <button
                  type="button"
                  onClick={() => setEditingNarration(true)}
                  className="inline-flex items-center gap-1 text-[10px] text-[#00A3BF] hover:underline"
                >
                  <Pencil className="h-3 w-3" /> 編集
                </button>
              )}
            </div>
            {editingNarration ? (
              <div className="mt-1 space-y-1.5">
                <textarea
                  value={narrationDraft}
                  onChange={e => setNarrationDraft(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
                  placeholder="音声で読み上げる文章"
                />
                <p className="text-[10px] text-gray-500">保存すると自動で音声を作り直します</p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditingNarration(false); setNarrationDraft(scene.narration_text ?? '') }}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                  >
                    <X className="h-3 w-3" /> キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={commitNarration}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md bg-[#00A3BF] px-2 py-1 text-[11px] text-white hover:bg-[#008CA8] disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" /> 保存して音声更新
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
                {scene.narration_text || <span className="text-gray-500">（未設定）</span>}
              </p>
            )}
          </div>

          {/* 画像プロンプト */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">画像プロンプト</span>
              {!editingPrompt && (
                <button
                  type="button"
                  onClick={() => setEditingPrompt(true)}
                  className="inline-flex items-center gap-1 text-[10px] text-[#00A3BF] hover:underline"
                >
                  <Pencil className="h-3 w-3" /> 編集
                </button>
              )}
            </div>
            {editingPrompt ? (
              <div className="mt-1 space-y-1.5">
                <textarea
                  value={promptDraft}
                  onChange={e => setPromptDraft(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
                  placeholder="どんな画像を作りたいかを英語または日本語で具体的に"
                />
                <p className="text-[10px] text-gray-500">保存すると自動で画像を作り直します</p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditingPrompt(false); setPromptDraft(scene.image_prompt ?? '') }}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                  >
                    <X className="h-3 w-3" /> キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={commitPrompt}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-md bg-[#00A3BF] px-2 py-1 text-[11px] text-white hover:bg-[#008CA8] disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" /> 保存して画像更新
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500 break-words">
                {scene.image_prompt || <span className="text-gray-500">（未設定）</span>}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {scene.duration !== null && (
              <span className="text-[10px] text-gray-500">{scene.duration.toFixed(1)} 秒</span>
            )}
            <button
              type="button"
              onClick={togglePlay}
              disabled={!scene.audio_url}
              className={cx(
                'inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[#e5edf5] px-2.5 py-1 text-[11px]',
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
              onClick={() => void handleRegenerate('image')}
              disabled={imageBusy}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-[#e5edf5] px-2.5 py-1 text-[11px] text-gray-600 hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-[#00A3BF] disabled:opacity-50"
            >
              <RefreshCw className={cx('h-3 w-3', imageBusy && 'animate-spin')} />
              画像再生成
            </button>
            <button
              type="button"
              onClick={() => void handleRegenerate('audio')}
              disabled={audioBusy}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-[#e5edf5] px-2.5 py-1 text-[11px] text-gray-600 hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-[#00A3BF] disabled:opacity-50"
            >
              <RefreshCw className={cx('h-3 w-3', audioBusy && 'animate-spin')} />
              音声再生成
            </button>
          </div>
          {audioError && (
            <p className="mt-1 text-[10px] text-red-500" role="alert">{audioError}</p>
          )}
        </div>
      </div>
    </div>
  )
}
