'use client'

import { useEffect, useState } from 'react'
import { X, Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalA11y } from '@/lib/hooks/use-modal-a11y'
import type { VideoAccount } from './VideoDetail'

type Privacy = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'

const PRIVACY_LABEL: Record<Privacy, string> = {
  PUBLIC_TO_EVERYONE: '全員に公開',
  MUTUAL_FOLLOW_FRIENDS: '相互フォローのみ',
  FOLLOWER_OF_CREATOR: 'フォロワーのみ',
  SELF_ONLY: '自分のみ（非公開）',
}

interface PublishTikTokModalProps {
  open: boolean
  onClose: () => void
  videoId: string
  accounts: VideoAccount[]
  defaultCaption: string
  /** 公開成功時に呼ばれる */
  onPublished: () => void
}

export function PublishTikTokModal({
  open,
  onClose,
  videoId,
  accounts,
  defaultCaption,
  onPublished,
}: PublishTikTokModalProps) {
  const toast = useToast()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [caption, setCaption] = useState(defaultCaption)
  const [privacy, setPrivacy] = useState<Privacy>('SELF_ONLY')
  const [disableComment, setDisableComment] = useState(false)
  const [disableDuet, setDisableDuet] = useState(false)
  const [disableStitch, setDisableStitch] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const modalRef = useModalA11y<HTMLDivElement>(open, () => { if (!submitting) onClose() })

  useEffect(() => {
    if (open) {
      setCaption(defaultCaption)
      setAccountId(accounts[0]?.id ?? '')
      setPrivacy('SELF_ONLY')
      setDisableComment(false)
      setDisableDuet(false)
      setDisableStitch(false)
    }
  }, [open, defaultCaption, accounts])

  if (!open) return null

  const captionLen = caption.length
  const captionTooLong = captionLen > 2200
  const canSubmit = !!accountId && !!caption.trim() && !captionTooLong && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/videos/${videoId}/publish/tiktok`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          caption: caption.trim(),
          privacyLevel: privacy,
          disableComment,
          disableDuet,
          disableStitch,
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; success?: boolean }
      if (!res.ok || !data.success) {
        toast.error(data.error ?? 'TikTok への公開に失敗しました')
        return
      }
      toast.success('TikTok に公開しました')
      onPublished()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-tiktok-title"
        className="w-full max-w-lg rounded-xl bg-white shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h2 id="publish-tiktok-title" className="text-sm font-semibold text-gray-900">TikTok に公開</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="閉じる"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-2 focus-visible:outline-[#00A3BF]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">投稿先アカウント</label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              disabled={accounts.length === 0 || submitting}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
            >
              {accounts.length === 0 ? (
                <option value="">TikTok アカウントが未連携</option>
              ) : (
                accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)
              )}
            </select>
          </div>

          <div>
            <label className="mb-1 flex items-center justify-between text-xs font-semibold text-gray-700">
              <span>キャプション</span>
              <span className={captionTooLong ? 'font-normal text-red-600' : 'font-normal text-gray-400'}>
                {captionLen} / 2200
              </span>
            </label>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={4}
              maxLength={2300}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
              placeholder="本文 + #ハッシュタグ + @メンションを入れられます"
            />
            <p className="mt-1 text-[10px] text-gray-500">例: #副業 #20代 #転職</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-700">公開範囲</label>
            <select
              value={privacy}
              onChange={e => setPrivacy(e.target.value as Privacy)}
              disabled={submitting}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
            >
              {(Object.keys(PRIVACY_LABEL) as Privacy[]).map(p => (
                <option key={p} value={p}>{PRIVACY_LABEL[p]}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-gray-500">
              TikTok アプリ未審査の場合「自分のみ」しか選べないことがあります。失敗時はこのオプションを変更して再試行してください。
            </p>
          </div>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-semibold text-gray-700">インタラクション</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={disableComment} onChange={e => setDisableComment(e.target.checked)} disabled={submitting} />
              コメントを無効化
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={disableDuet} onChange={e => setDisableDuet(e.target.checked)} disabled={submitting} />
              デュエットを無効化
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={disableStitch} onChange={e => setDisableStitch(e.target.checked)} disabled={submitting} />
              スティッチを無効化
            </label>
          </fieldset>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>キャンセル</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} isLoading={submitting} loadingText="公開中..." className="gap-1.5">
            <Send className="h-4 w-4" />
            TikTokに公開
          </Button>
        </div>
      </div>
    </div>
  )
}
