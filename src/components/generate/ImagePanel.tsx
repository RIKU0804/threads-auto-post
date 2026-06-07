'use client'

// 図解／投稿画像の生成・編集カード（全SNS共通）。
// 生成 → プレビュー → 修正指示 → プロンプト確認 までを1コンポーネントに統一。
import { ImageIcon, Wand2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { SectionLabel } from '@/components/generate/GenerateParts'
import { cx } from '@/lib/utils'

interface ImagePanelProps {
  /** カード見出し（例: 図解画像 / 投稿画像（必須）） */
  label: string
  /** 未生成時のボタン文言（例: 図解を生成 / 画像を生成） */
  generateLabel: string
  imageUrl: string
  imageLoading: boolean
  imageEditPrompt: string
  setImageEditPrompt: (v: string) => void
  imageEditing: boolean
  onGenerate: () => void
  onEdit: () => void
  imagePrompt: string
  /** 見出し横の補助バッジ（例: 参考画像でテイスト適用） */
  badge?: React.ReactNode
  /** 画像下の注記（例: スレッドの場合は1件目に添付されます） */
  footnote?: React.ReactNode
  /** 空状態の説明文 */
  emptyText: string
  /** 空状態を高め（h-40）にする（Instagram のように画像必須のページ用） */
  emptyTall?: boolean
  /** 生成画像の alt */
  imageAlt?: string
}

export function ImagePanel({
  label, generateLabel,
  imageUrl, imageLoading,
  imageEditPrompt, setImageEditPrompt, imageEditing,
  onGenerate, onEdit, imagePrompt,
  badge, footnote, emptyText, emptyTall = false, imageAlt = '生成された画像',
}: ImagePanelProps) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionLabel>{label}</SectionLabel>
          {badge}
        </div>
        <button
          onClick={onGenerate}
          disabled={imageLoading}
          className="flex items-center gap-1 text-xs font-medium text-[#006F83] transition-colors hover:text-[#005A6B] disabled:opacity-50"
        >
          <ImageIcon className="h-3 w-3" />
          {imageLoading ? '生成中...' : imageUrl ? '再生成' : generateLabel}
        </button>
      </div>

      {imageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={imageAlt} className="w-full rounded-md" />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={imageEditPrompt}
              onChange={e => setImageEditPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && onEdit()}
              placeholder="修正指示（例：背景を青に、テキストを日本語に）"
              disabled={imageEditing}
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20 disabled:opacity-50"
            />
            <button
              onClick={onEdit}
              disabled={!imageEditPrompt.trim() || imageEditing}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#00A3BF] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#008CA8] disabled:opacity-40 sm:w-auto sm:shrink-0"
            >
              <Wand2 className={cx('h-3.5 w-3.5', imageEditing && 'animate-pulse')} />
              {imageEditing ? '修正中...' : '修正'}
            </button>
          </div>
          {footnote && <p className="text-[11px] text-gray-400">{footnote}</p>}
          {imagePrompt && (
            <details className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-medium text-gray-600 hover:text-gray-900">
                🔍 画像生成プロンプトを表示
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto break-words whitespace-pre-wrap text-[11px] leading-relaxed text-gray-700">
                {imagePrompt}
              </pre>
            </details>
          )}
        </>
      ) : (
        <div className={cx(
          'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[#e5edf5]',
          emptyTall ? 'h-40' : 'h-32',
        )}>
          <ImageIcon className={cx('text-gray-300', emptyTall ? 'h-6 w-6' : 'h-5 w-5')} />
          <span className="text-xs text-gray-400">{emptyText}</span>
        </div>
      )}
    </Card>
  )
}
