'use client'

import { useEffect, useState } from 'react'
import {
  Sparkles, ImageIcon, Send, Save, RefreshCw, ChevronLeft,
  CheckCircle, Lightbulb, Wand2, BookOpen, ChevronDown, ChevronUp,
  X, Upload, MessageCircle,
} from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useThemeSuggestions } from '@/lib/hooks/use-theme-suggestions'
import type { Account, Post, ReferenceAccount } from '@/types/database'

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

export default function ThreadsGeneratePage() {
  const toast = useToast()
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
  const [imageEditPrompt, setImageEditPrompt] = useState('')
  const [imageEditing, setImageEditing] = useState(false)
  const [savedPost, setSavedPost] = useState<Post | null>(null)

  const [referenceAccounts, setReferenceAccounts] = useState<ReferenceAccount[]>([])
  const [showReference, setShowReference] = useState(false)
  const [selectedRefAccount, setSelectedRefAccount] = useState('')
  const [referencePost, setReferencePost] = useState('')
  const [referenceImage, setReferenceImage] = useState<{ base64: string; mimeType: string } | null>(null)

  const { themeSuggestions, setThemeSuggestions, suggestLoading, suggestThemes } = useThemeSuggestions(selectedAccount)

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => r.json()) as Promise<Account[]>,
      fetch('/api/reference-accounts').then(r => r.json()) as Promise<ReferenceAccount[]>,
    ])
      .then(([accs, refs]) => {
        const threadsAccounts = (Array.isArray(accs) ? accs : []).filter(a => a.platform === 'threads' || !a.platform)
        setAccounts(threadsAccounts)
        if (threadsAccounts.length > 0) setSelectedAccount(threadsAccounts[0].id)
        setReferenceAccounts(Array.isArray(refs) ? refs : [])
      })
      .catch(e => {
        console.error('[generate/threads] initial load failed', e)
        toast.error('アカウント情報の取得に失敗しました。再読み込みしてください。')
      })
  }, [])

  const isDemoMode = !selectedAccount
  const selectedRefName = referenceAccounts.find(r => r.id === selectedRefAccount)?.name

  async function handleGenerate(overrideTheme?: string) {
    const targetTheme = overrideTheme ?? theme
    if (!targetTheme.trim()) return
    if (overrideTheme) setTheme(overrideTheme)
    setLoading(true)
    try {
      const res = await fetch('/api/generate/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount || undefined,
          theme: targetTheme,
          postType: postType || undefined,
          referencePost: referencePost.trim() || undefined,
          referenceAccountName: selectedRefName || undefined,
        }),
      })
      const data = await res.json() as { content: string; summary: string; error?: string }
      if (data.error) throw new Error(data.error)
      setGeneratedText(data.content)
      setGeneratedSummary(data.summary ?? '')
      setStep('preview')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成に失敗しました')
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
        body: JSON.stringify({
          accountId: selectedAccount || undefined,
          postContent: generatedText,
          style: 'diagram',
          referenceImageBase64: referenceImage?.base64,
          referenceImageMimeType: referenceImage?.mimeType,
        }),
      })
      const data = await res.json() as { imageUrl: string; error?: string }
      if (data.error) throw new Error(data.error)
      setImageUrl(data.imageUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '画像生成に失敗しました')
    } finally {
      setImageLoading(false)
    }
  }

  async function handleEditImage() {
    if (!imageUrl || !imageEditPrompt.trim()) return
    setImageEditing(true)
    try {
      const res = await fetch('/api/generate/image/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, editPrompt: imageEditPrompt }),
      })
      const data = await res.json() as { imageUrl: string; error?: string }
      if (data.error) throw new Error(data.error)
      setImageUrl(data.imageUrl)
      setImageEditPrompt('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '画像編集に失敗しました')
    } finally {
      setImageEditing(false)
    }
  }

  function handleReferenceImageUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) { toast.error('画像サイズは5MB以下にしてください'); return }
    if (!file.type.startsWith('image/')) { toast.error('画像ファイルを選択してください'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setReferenceImage({
        base64: result.replace(/^data:image\/[^;]+;base64,/, ''),
        mimeType: file.type,
      })
    }
    reader.readAsDataURL(file)
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
          summary: generatedSummary || undefined,
        }),
      })
      const post = await res.json() as Post & { error?: string }
      if (post.error) throw new Error(post.error)
      if (publish && selectedAccount) {
        const pubRes = await fetch(`/api/posts/${post.id}/publish`, { method: 'POST' })
        if (!pubRes.ok) {
          const pd = await pubRes.json().catch(() => ({})) as { error?: string }
          setSavedPost(post)
          throw new Error(pd.error ?? '投稿に失敗しました（下書きは保存済み）')
        }
        setSavedPost({ ...post, status: 'posted' })
      } else {
        setSavedPost(post)
      }
      setStep('done')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
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
    setImageEditPrompt('')
    setSavedPost(null)
    setThemeSuggestions([])
    setReferencePost('')
    setSelectedRefAccount('')
    setShowReference(false)
    setReferenceImage(null)
  }

  if (step === 'done') {
    return (
      <div className="p-6 lg:p-8 max-w-2xl">
        <Card className="py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            {savedPost?.status === 'posted' ? '投稿しました！' : '保存しました！'}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {savedPost?.status === 'posted'
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
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/dashboard/generate"
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              戻る
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
              <MessageCircle className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
              Threads 投稿生成
            </h1>
          </div>
          <p className="mt-0.5 text-sm text-gray-500 ml-9">テキスト + 図解画像を生成してThreadsに投稿</p>
        </div>
        {step === 'preview' && (
          <button
            onClick={() => setStep('input')}
            className="mt-6 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            入力に戻る
          </button>
        )}
      </div>

      {/* Step 1: 入力 */}
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
                  aria-label="投稿先アカウント"
                  className="w-full appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
                >
                  <option value="">デモモード（デフォルト設定）</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>

            {/* テーマ入力 */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <SectionLabel>投稿テーマ</SectionLabel>
                <button
                  onClick={suggestThemes}
                  disabled={suggestLoading}
                  className="flex items-center gap-1 text-xs font-medium text-[#006F83] hover:text-[#005A6B] disabled:opacity-50 transition-colors"
                >
                  <Lightbulb className={cx('h-3 w-3', suggestLoading && 'animate-pulse')} />
                  {suggestLoading ? '考え中...' : 'テーマを提案'}
                </button>
              </div>
              {themeSuggestions.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {themeSuggestions.map(t => (
                    <button
                      key={t}
                      onClick={() => { setTheme(t); setThemeSuggestions([]) }}
                      className={cx(
                        'rounded-full border px-3 py-1 text-xs transition-all text-left',
                        theme === t
                          ? 'border-[#00A3BF] bg-[#E9F7F9] text-[#006F83]'
                          : 'border-[#e5edf5] bg-white text-gray-600 hover:border-[#00A3BF] hover:text-[#006F83]',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={theme}
                onChange={e => setTheme(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleGenerate()}
                placeholder="例：高卒でも転職できる3つの理由"
                aria-label="投稿テーマ"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
              />
            </div>
          </Card>

          {/* 投稿の型 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>投稿の型</SectionLabel>
              <span className="text-xs text-gray-400">任意</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
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
                  <span className={cx('text-xs font-medium leading-tight', postType === t.value ? 'text-[#006F83]' : 'text-gray-700')}>
                    {t.label}
                  </span>
                  <span className="text-[10px] text-gray-400 leading-tight">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 参考投稿 */}
          <div className="rounded-lg border border-[#e5edf5] bg-white">
            <button
              type="button"
              onClick={() => setShowReference(v => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#00A3BF]" />
                <span className="text-sm font-medium text-gray-700">参考投稿を使う</span>
                {(referencePost.trim() || referenceImage) && (
                  <span className="rounded-full bg-[#E9F7F9] px-2 py-0.5 text-[10px] font-medium text-[#006F83]">設定済み</span>
                )}
              </div>
              {showReference ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>

            {showReference && (
              <div className="border-t border-[#e5edf5] px-4 pb-4 pt-3 space-y-3">
                <p className="text-xs text-gray-400 leading-relaxed">
                  参考にしたい投稿をペーストしてください。AIがテーマ・構成を読み取り、自分のスタイルで書き直します。
                </p>

                {referenceAccounts.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-gray-500">参考アカウント（任意）</p>
                    <select
                      value={selectedRefAccount}
                      onChange={e => setSelectedRefAccount(e.target.value)}
                      className="w-full appearance-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
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
                      <button onClick={() => setReferencePost('')} className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-red-500 transition-colors">
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
                    <p className="mt-1 text-[11px] text-[#006F83]">✓ この投稿を参考にして生成します（元の文章はそのまま使いません）</p>
                  )}
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">参考画像（任意）</p>
                    {referenceImage && (
                      <button onClick={() => setReferenceImage(null)} className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-red-500 transition-colors">
                        <X className="h-3 w-3" />クリア
                      </button>
                    )}
                  </div>
                  {referenceImage ? (
                    <div className="rounded-md border border-[#e5edf5] bg-white p-2">
                      <img src={`data:${referenceImage.mimeType};base64,${referenceImage.base64}`} alt="参考画像" className="max-h-40 w-auto rounded object-contain" />
                      <p className="mt-1 text-[11px] text-[#006F83]">✓ レイアウト・配色・スタイルを参考にして画像を生成します</p>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border-2 border-dashed border-[#e5edf5] bg-white px-3 py-3 text-sm text-gray-500 transition hover:border-[#00A3BF] hover:bg-[#F8FAFC]">
                      <Upload className="h-4 w-4" />
                      <span>画像をアップロード（最大5MB）</span>
                      <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) handleReferenceImageUpload(f); e.target.value = '' }} className="hidden" />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          <Button onClick={() => handleGenerate()} disabled={!theme.trim()} isLoading={loading} loadingText="生成中..." className="w-full gap-2 py-2.5">
            <Sparkles className="h-4 w-4" />
            AI生成する
          </Button>
        </div>
      )}

      {/* Step 2: プレビュー */}
      {step === 'preview' && (
        <div className="space-y-4">
          {isDemoMode && (
            <div className="flex items-center justify-between rounded-md border border-[#e5edf5] bg-[#F8FAFC] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#E9F7F9] px-2 py-0.5 text-xs font-medium text-[#006F83]">デモモード</span>
                <span className="text-xs text-gray-500">下書き保存のみ可能です</span>
              </div>
              <span className="text-xs text-gray-400">アカウントを追加すると投稿できます</span>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">テーマ</span>
            <span className="text-gray-700">{theme}</span>
            {(referencePost.trim() || referenceImage) && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                参考{referencePost.trim() && referenceImage ? '投稿+画像' : referenceImage ? '画像' : '投稿'}あり
              </span>
            )}
            <button onClick={() => setStep('input')} className="ml-auto text-xs text-[#006F83] hover:underline">変更</button>
          </div>

          {/* 投稿文 */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>投稿文</SectionLabel>
              <button onClick={() => handleGenerate()} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-[#006F83] hover:text-[#005A6B] disabled:opacity-50">
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

          {/* 図解画像 */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SectionLabel>図解画像</SectionLabel>
                {referenceImage && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">参考画像でテイスト適用</span>
                )}
              </div>
              <button onClick={handleGenerateImage} disabled={imageLoading} className="flex items-center gap-1 text-xs font-medium text-[#006F83] hover:text-[#005A6B] disabled:opacity-50">
                <ImageIcon className="h-3 w-3" />
                {imageLoading ? '生成中...' : imageUrl ? '再生成' : '図解を生成'}
              </button>
            </div>
            {imageUrl ? (
              <>
                <img src={imageUrl} alt="生成された図解" className="w-full rounded-md" />
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={imageEditPrompt}
                    onChange={e => setImageEditPrompt(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleEditImage()}
                    placeholder="修正指示（例：背景を青に、テキストを日本語に）"
                    disabled={imageEditing}
                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden placeholder-gray-400 transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20 disabled:opacity-50"
                  />
                  <button
                    onClick={handleEditImage}
                    disabled={!imageEditPrompt.trim() || imageEditing}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#00A3BF] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#008CA8] disabled:opacity-40 sm:w-auto sm:shrink-0"
                  >
                    <Wand2 className={cx('h-3.5 w-3.5', imageEditing && 'animate-pulse')} />
                    {imageEditing ? '修正中...' : '修正'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[#e5edf5]">
                <ImageIcon className="h-5 w-5 text-gray-300" />
                <span className="text-xs text-gray-400">「図解を生成」ボタンで追加（任意）</span>
              </div>
            )}
          </Card>

          {/* アクション */}
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => handleSave(false)} disabled={loading} className="flex-1 gap-2">
              <Save className="h-4 w-4" />
              下書き保存
            </Button>
            {!isDemoMode && (
              <Button onClick={() => handleSave(true)} disabled={loading} isLoading={loading} loadingText="投稿中..." className="flex-1 gap-2">
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
