'use client'

import { useEffect, useState } from 'react'
import { Sparkles, ImageIcon, Send, Save, RefreshCw, ChevronLeft, CheckCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { cx } from '@/lib/utils'
import type { Account, Post } from '@/types/database'

type Step = 'input' | 'preview' | 'done'
type PostType = 'buzz' | 'empathy' | 'numbers' | 'story' | 'question'

const POST_TYPES: { value: PostType; label: string; desc: string; emoji: string }[] = [
  { value: 'buzz',     label: 'バズ型',      desc: '逆説・驚き',   emoji: '⚡' },
  { value: 'empathy',  label: '共感型',      desc: '心の声代弁',  emoji: '🤝' },
  { value: 'numbers',  label: '数字型',      desc: '具体数字',    emoji: '📊' },
  { value: 'story',    label: 'ストーリー型', desc: '起承転結',    emoji: '📖' },
  { value: 'question', label: '問いかけ型',  desc: 'コメント誘導', emoji: '💬' },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </p>
  )
}

export default function GeneratePage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [theme, setTheme] = useState('')
  const [postType, setPostType] = useState<PostType | ''>('')
  const [step, setStep] = useState<Step>('input')
  const [loading, setLoading] = useState(false)
  const [generatedText, setGeneratedText] = useState('')
  const [generatedSummary, setGeneratedSummary] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageLoading, setImageLoading] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [savedPost, setSavedPost] = useState<Post | null>(null)

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((data: Account[]) => {
        setAccounts(data)
        if (data.length > 0) setSelectedAccount(data[0].id)
      })
  }, [])

  const isDemoMode = !selectedAccount  // アカウント未選択 = デモモード

  async function handleGenerate() {
    if (!theme.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/generate/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount || undefined,
          theme,
          postType: postType || undefined,
        }),
      })
      const data = await res.json() as { content: string; summary: string; error?: string }
      if (data.error) throw new Error(data.error)
      setGeneratedText(data.content)
      setGeneratedSummary(data.summary ?? '')
      setStep('preview')
    } catch (e) {
      alert(e instanceof Error ? e.message : '生成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerateImage() {
    if (!generatedText) return
    setImageLoading(true)
    try {
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postContent: generatedText, style: 'diagram' }),
      })
      const data = await res.json() as { imageUrl: string; error?: string }
      if (data.error) throw new Error(data.error)
      setImageUrl(data.imageUrl)
    } catch (e) {
      alert(e instanceof Error ? e.message : '画像生成に失敗しました')
    } finally {
      setImageLoading(false)
    }
  }

  async function handleSave(publish = false) {
    setLoading(true)
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount || undefined,
          textContent: generatedText,
          imageUrl: imageUrl || undefined,
          theme,
          scheduledAt: scheduledAt || undefined,
          summary: generatedSummary || undefined,
        }),
      })
      const post = await res.json() as Post & { error?: string }
      if (post.error) throw new Error(post.error)
      setSavedPost(post)
      if (publish && selectedAccount) {
        await fetch(`/api/posts/${post.id}/publish`, { method: 'POST' })
      }
      setStep('done')
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setStep('input')
    setTheme('')
    setPostType('')
    setGeneratedText('')
    setGeneratedSummary('')
    setImageUrl('')
    setScheduledAt('')
    setSavedPost(null)
  }

  if (step === 'done') {
    return (
      <div className="p-6 lg:p-8 max-w-2xl">
        <Card className="text-center py-12">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            {savedPost?.status === 'posted' ? '投稿しました！' : '保存しました！'}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {savedPost?.status === 'scheduled'
              ? `${scheduledAt} に予約投稿します`
              : savedPost?.status === 'posted'
              ? 'Threadsに投稿されました'
              : '下書きとして保存されました'}
          </p>
          <Button onClick={handleReset} className="mt-6 gap-2">
            <Sparkles className="h-4 w-4" />
            新しい投稿を生成する
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
            投稿生成
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">AIがテーマを Threads 投稿に変換します</p>
        </div>
        {step === 'preview' && (
          <button
            onClick={() => setStep('input')}
            className="mt-1 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            戻る
          </button>
        )}
      </div>

      {/* Step 1 */}
      {step === 'input' && (
        <div className="space-y-5">
          <Card className="space-y-4">
            {/* アカウント選択 */}
            <div>
              <SectionLabel>アカウント</SectionLabel>
              {accounts.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-[#e5edf5] bg-[#F8FAFC] px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E9F7F9] px-2 py-0.5 text-xs font-medium text-[#006F83]">
                    デモモード
                  </span>
                  <span className="text-sm text-gray-500">デフォルト設定で生成します</span>
                </div>
              ) : (
                <select
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  className="w-full appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
                >
                  <option value="">デモモード（デフォルト設定）</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>

            {/* デモモード時の説明 */}
            {isDemoMode && (
              <div className="rounded-md border border-[#e5edf5] bg-[#F8FAFC] px-3 py-2.5 text-xs text-gray-500 leading-relaxed">
                <span className="font-medium text-gray-600">デモモードの設定：</span>
                　転職ノウハウ発信者 / 高卒20代向け / フランクな文体
              </div>
            )}

            {/* テーマ入力 */}
            <div>
              <SectionLabel>投稿テーマ</SectionLabel>
              <Input
                value={theme}
                onChange={e => setTheme(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                placeholder="例：高卒でも転職できる3つの理由"
              />
            </div>
          </Card>

          {/* Post type picker */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>投稿の型</SectionLabel>
              <span className="text-xs text-gray-400">任意</span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {POST_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPostType(postType === t.value ? '' : t.value)}
                  className={cx(
                    'flex flex-col items-center gap-1 rounded-lg border py-3 px-2 text-center transition-all',
                    postType === t.value
                      ? 'border-[#00A3BF] bg-[#E9F7F9]'
                      : 'border-[#e5edf5] bg-white hover:border-[#c8d8e8] hover:bg-[#F8FAFC]',
                  )}
                >
                  <span className="text-xl leading-none">{t.emoji}</span>
                  <span className={cx(
                    'text-xs font-medium leading-tight',
                    postType === t.value ? 'text-[#006F83]' : 'text-gray-700',
                  )}>
                    {t.label}
                  </span>
                  <span className="text-[10px] text-gray-400 leading-tight">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!theme.trim()}
            isLoading={loading}
            loadingText="生成中..."
            className="w-full gap-2 py-2.5"
          >
            <Sparkles className="h-4 w-4" />
            AI生成する
          </Button>
        </div>
      )}

      {/* Step 2: プレビュー */}
      {step === 'preview' && (
        <div className="space-y-4">
          {/* デモモードバナー */}
          {isDemoMode && (
            <div className="flex items-center justify-between rounded-md border border-[#e5edf5] bg-[#F8FAFC] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#E9F7F9] px-2 py-0.5 text-xs font-medium text-[#006F83]">
                  デモモード
                </span>
                <span className="text-xs text-gray-500">下書き保存のみ可能です</span>
              </div>
              <span className="text-xs text-gray-400">アカウントを追加すると投稿できます</span>
            </div>
          )}

          {/* Text */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>投稿文</SectionLabel>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="flex items-center gap-1 text-xs font-medium text-[#006F83] hover:text-[#005A6B] disabled:opacity-50"
              >
                <RefreshCw className={cx('h-3 w-3', loading && 'animate-spin')} />
                再生成
              </button>
            </div>
            <Textarea
              value={generatedText}
              onChange={e => setGeneratedText(e.target.value)}
              rows={9}
              className="resize-none border-none bg-transparent p-0 shadow-none focus:ring-0"
            />
            <div className="flex items-center justify-between border-t border-gray-100 pt-2">
              <span className="text-xs text-gray-400">{generatedText.length} 文字</span>
              <div className={cx(
                'h-1.5 w-1.5 rounded-full',
                generatedText.length > 450 ? 'bg-red-400' : generatedText.length > 350 ? 'bg-yellow-400' : 'bg-green-500',
              )} />
            </div>
          </Card>

          {/* Image */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <SectionLabel>図解画像</SectionLabel>
              </div>
              <button
                onClick={handleGenerateImage}
                disabled={imageLoading}
                className="flex items-center gap-1 text-xs font-medium text-[#006F83] hover:text-[#005A6B] disabled:opacity-50"
              >
                <ImageIcon className="h-3 w-3" />
                {imageLoading ? '生成中...' : imageUrl ? '再生成' : '図解を生成'}
              </button>
            </div>
            {imageUrl ? (
              <img src={imageUrl} alt="生成された図解" className="w-full rounded-md" />
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[#e5edf5]">
                <ImageIcon className="h-5 w-5 text-gray-300" />
                <span className="text-xs text-gray-400">「図解を生成」ボタンで追加（任意・有料）</span>
              </div>
            )}
          </Card>

          {/* Schedule — アカウントがある場合のみ */}
          {!isDemoMode && (
            <Card className="space-y-2">
              <SectionLabel>予約投稿</SectionLabel>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
              />
              {!scheduledAt && <p className="text-xs text-gray-400">空白の場合は下書き保存になります</p>}
            </Card>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => handleSave(false)}
              disabled={loading}
              className="flex-1 gap-2"
            >
              <Save className="h-4 w-4" />
              {isDemoMode ? '下書き保存' : scheduledAt ? '予約保存' : '下書き保存'}
            </Button>
            {!isDemoMode && (
              <Button
                onClick={() => handleSave(true)}
                disabled={loading || !!scheduledAt}
                isLoading={loading}
                loadingText="投稿中..."
                className="flex-1 gap-2"
              >
                <Send className="h-4 w-4" />
                今すぐ投稿
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
