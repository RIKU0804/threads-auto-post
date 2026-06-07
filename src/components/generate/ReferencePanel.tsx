'use client'

// 参考投稿パネル（投稿テキスト/画像をネタ元として渡す）。
// 元は Threads / Instagram のみに存在。UI統一のため共通化し、X にも同じものを表示する。
import { BookOpen, ChevronDown, ChevronUp, X, Upload } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'
import { SELECT_CLASS } from '@/components/generate/GenerateParts'
import type { ReferenceAccount } from '@/types/database'

export interface ReferenceImage {
  base64: string
  mimeType: string
}

interface ReferencePanelProps {
  open: boolean
  onToggle: () => void
  referenceAccounts: ReferenceAccount[]
  selectedRefAccount: string
  setSelectedRefAccount: (v: string) => void
  referencePost: string
  setReferencePost: (v: string) => void
  referenceImage: ReferenceImage | null
  setReferenceImage: (v: ReferenceImage | null) => void
  /** ファイル選択時のアップロード処理（サイズ/形式チェック + base64 化はページ側で実施） */
  onUploadImage: (file: File) => void
}

export function ReferencePanel({
  open, onToggle,
  referenceAccounts, selectedRefAccount, setSelectedRefAccount,
  referencePost, setReferencePost,
  referenceImage, setReferenceImage,
  onUploadImage,
}: ReferencePanelProps) {
  const hasContent = !!(referencePost.trim() || referenceImage)

  return (
    <div className="rounded-lg border border-[#e5edf5] bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[#00A3BF]" />
          <span className="text-sm font-medium text-gray-700">参考投稿を使う</span>
          {hasContent && (
            <span className="rounded-full bg-[#E9F7F9] px-2 py-0.5 text-[10px] font-medium text-[#006F83]">
              設定済み
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-[#e5edf5] px-4 pt-3 pb-4">
          <p className="text-xs leading-relaxed text-gray-400">
            参考にしたい投稿をペーストしてください。AIがテーマ・構成を読み取り、自分のスタイルで書き直します。
          </p>

          {referenceAccounts.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">参考アカウント（任意）</p>
              <select
                value={selectedRefAccount}
                onChange={e => setSelectedRefAccount(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">選択しない</option>
                {referenceAccounts.map(r => (
                  <option key={r.id} value={r.id}>{r.name}{r.handle ? ` (@${r.handle})` : ''}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">参考投稿テキスト</p>
              {referencePost && (
                <button
                  onClick={() => setReferencePost('')}
                  className="flex items-center gap-0.5 text-xs text-gray-400 transition-colors hover:text-red-500"
                >
                  <X className="h-3 w-3" />クリア
                </button>
              )}
            </div>
            <Textarea
              value={referencePost}
              onChange={e => setReferencePost(e.target.value)}
              rows={5}
              placeholder="参考にしたい投稿をここにペーストしてください..."
              className="resize-none text-sm"
            />
            {referencePost.trim() && (
              <p className="mt-1 text-[11px] text-[#006F83]">
                ✓ この投稿を参考にして生成します（元の文章はそのまま使いません）
              </p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">参考画像（任意）</p>
              {referenceImage && (
                <button
                  onClick={() => setReferenceImage(null)}
                  className="flex items-center gap-0.5 text-xs text-gray-400 transition-colors hover:text-red-500"
                >
                  <X className="h-3 w-3" />クリア
                </button>
              )}
            </div>
            {referenceImage ? (
              <div className="rounded-md border border-[#e5edf5] bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${referenceImage.mimeType};base64,${referenceImage.base64}`}
                  alt="参考画像"
                  className="max-h-40 w-auto rounded object-contain"
                />
                <p className="mt-1 text-[11px] text-[#006F83]">
                  ✓ レイアウト・配色・スタイルを参考にして画像を生成します
                </p>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border-2 border-dashed border-[#e5edf5] bg-white px-3 py-3 text-sm text-gray-500 transition hover:border-[#00A3BF] hover:bg-[#F8FAFC]">
                <Upload className="h-4 w-4" />
                <span>画像をアップロード（最大5MB）</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; if (f) onUploadImage(f); e.target.value = '' }}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
