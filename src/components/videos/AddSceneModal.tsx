'use client'

import { useEffect, useState } from 'react'
import { X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useModalA11y } from '@/lib/hooks/use-modal-a11y'

interface AddSceneModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: { caption_text: string; narration_text: string; image_prompt: string }) => Promise<void>
  busy: boolean
}

export function AddSceneModal({ open, onClose, onSubmit, busy }: AddSceneModalProps) {
  const [caption, setCaption] = useState('')
  const [narration, setNarration] = useState('')
  const [prompt, setPrompt] = useState('')
  const modalRef = useModalA11y<HTMLDivElement>(open, onClose)

  useEffect(() => {
    if (!open) {
      setCaption('')
      setNarration('')
      setPrompt('')
    }
  }, [open])

  if (!open) return null

  const canSubmit = caption.trim().length > 0 && narration.trim().length > 0 && prompt.trim().length > 0 && !busy

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-scene-title"
        className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 id="add-scene-title" className="text-sm font-semibold text-gray-700">シーンを追加</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-[#00A3BF] focus-visible:outline-offset-1 disabled:opacity-50"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              キャプション
            </label>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="画面に表示されるテキスト"
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              ナレーション
            </label>
            <textarea
              value={narration}
              onChange={e => setNarration(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="音声で読み上げる文章"
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              画像プロンプト
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="どんな画像を生成したいか具体的に"
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
            />
          </div>
          <p className="text-[10px] text-gray-500">
            追加後、画像と音声を自動で生成します。完了後に「動画を作り直す」ボタンを押すと最終動画に反映されます。
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <Button
            onClick={onClose}
            disabled={busy}
            variant="ghost"
            className="border border-gray-300"
          >
            キャンセル
          </Button>
          <Button
            onClick={() => void onSubmit({
              caption_text: caption.trim(),
              narration_text: narration.trim(),
              image_prompt: prompt.trim(),
            })}
            disabled={!canSubmit}
            isLoading={busy}
            loadingText="追加中..."
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            追加する
          </Button>
        </div>
      </div>
    </div>
  )
}
