'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Save, Send } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import {
  GenerateLayout, GenerateHeader, DoneScreen, DemoModeNotice,
  ThemeField, PostTypeGrid, ThemePreviewRow, GenerateButton,
  SectionLabel, CharCounter, SELECT_CLASS, type PostTypeOption,
} from '@/components/generate/GenerateParts'
import { ReferencePanel, type ReferenceImage } from '@/components/generate/ReferencePanel'
import { ImagePanel } from '@/components/generate/ImagePanel'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useThemeSuggestions } from '@/lib/hooks/use-theme-suggestions'
import type { Account, Post, ReferenceAccount } from '@/types/database'

type Step = 'input' | 'preview' | 'done'
type PostType = 'buzz' | 'empathy' | 'numbers' | 'story' | 'question'

// Threads 本文の上限（公式は500文字）
const THREADS_LIMIT = 500

const POST_TYPES: readonly PostTypeOption[] = [
  { value: 'buzz',     label: 'バズ型',      desc: '逆説・驚き',   emoji: '⚡' },
  { value: 'empathy',  label: '共感型',      desc: '心の声代弁',  emoji: '🤝' },
  { value: 'numbers',  label: '数字型',      desc: '具体数字',    emoji: '📊' },
  { value: 'story',    label: 'ストーリー型', desc: '起承転結',    emoji: '📖' },
  { value: 'question', label: '問いかけ型',  desc: 'コメント誘導', emoji: '💬' },
]

export default function ThreadsGeneratePage() {
  const toast = useToast()
  const [showPrompt, setShowPrompt] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [theme, setTheme] = useState('')
  const [postType, setPostType] = useState<PostType | ''>('')
  const [step, setStep] = useState<Step>('input')
  const [loading, setLoading] = useState(false)
  const [generatedText, setGeneratedText] = useState('')
  const [generatedSummary, setGeneratedSummary] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [imageLoading, setImageLoading] = useState(false)
  const [imageEditPrompt, setImageEditPrompt] = useState('')
  const [imageEditing, setImageEditing] = useState(false)
  const [savedPost, setSavedPost] = useState<Post | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)

  const [referenceAccounts, setReferenceAccounts] = useState<ReferenceAccount[]>([])
  const [showReference, setShowReference] = useState(false)
  const [selectedRefAccount, setSelectedRefAccount] = useState('')
  const [referencePost, setReferencePost] = useState('')
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null)

  const { themeSuggestions, setThemeSuggestions, suggestLoading, suggestThemes } = useThemeSuggestions(selectedAccount)

  useEffect(() => {
    const ctrl = new AbortController()
    async function loadInitial() {
      try {
        const [accsRes, refsRes] = await Promise.all([
          fetch('/api/accounts', { signal: ctrl.signal }),
          fetch('/api/reference-accounts', { signal: ctrl.signal }),
        ])
        const accsRaw: unknown = accsRes.ok ? await accsRes.json() : []
        const refsRaw: unknown = refsRes.ok ? await refsRes.json() : []
        if (ctrl.signal.aborted) return
        const accs = Array.isArray(accsRaw) ? (accsRaw as Account[]) : []
        const refs = Array.isArray(refsRaw) ? (refsRaw as ReferenceAccount[]) : []
        const threadsAccounts = accs.filter(a => a.platform === 'threads' || !a.platform)
        setAccounts(threadsAccounts)
        if (threadsAccounts.length > 0) setSelectedAccount(threadsAccounts[0].id)
        setReferenceAccounts(refs)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        console.error('[generate/threads] initial load failed', e instanceof Error ? e.message : 'unknown')
        toast.error('アカウント情報の取得に失敗しました。再読み込みしてください。')
      }
    }
    void loadInitial()
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          draftId: draftId ?? undefined,
        }),
      })
      const data = await res.json() as { content: string; summary: string; draftId?: string | null; error?: string }
      if (data.error) throw new Error(data.error)
      setGeneratedText(data.content)
      setGeneratedSummary(data.summary ?? '')
      // 本文が変わったら古い図解は内容と不一致になるためクリア
      setImageUrl('')
      setImagePrompt('')
      setImageEditPrompt('')
      if (data.draftId) setDraftId(data.draftId)
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
      const data = await res.json() as { imageUrl: string; prompt?: string; error?: string }
      if (data.error) throw new Error(data.error)
      setImageUrl(data.imageUrl)
      setImagePrompt(data.prompt ?? '')
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
      const data = await res.json() as { imageUrl: string; prompt?: string; error?: string }
      if (data.error) throw new Error(data.error)
      setImageUrl(data.imageUrl)
      if (data.prompt) setImagePrompt(data.prompt)
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
      // 生成時に下書きは自動保存済み。draftId があれば本文/画像の最新を反映するだけ（二重作成しない）
      let post: Post
      if (draftId) {
        const res = await fetch(`/api/posts/${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            textContent: generatedText,
            imageUrl: imageUrl || null,
            summary: generatedSummary || null,
          }),
        })
        post = await res.json() as Post & { error?: string }
        if ((post as { error?: string }).error) throw new Error((post as { error?: string }).error)
      } else {
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
        post = await res.json() as Post & { error?: string }
        if ((post as { error?: string }).error) throw new Error((post as { error?: string }).error)
      }
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
    setImagePrompt('')
    setImageEditPrompt('')
    setSavedPost(null)
    setDraftId(null)
    setThemeSuggestions([])
    setReferencePost('')
    setSelectedRefAccount('')
    setShowReference(false)
    setReferenceImage(null)
  }

  if (step === 'done') {
    return (
      <DoneScreen
        posted={savedPost?.status === 'posted'}
        platformLabel="Threads"
        onReset={handleReset}
      />
    )
  }

  const hasReference = !!(referencePost.trim() || referenceImage)

  return (
    <GenerateLayout showPrompt={showPrompt} onTogglePrompt={() => setShowPrompt(v => !v)} accountId={selectedAccount}>
      <GenerateHeader
        platform="threads"
        title="Threads 投稿生成"
        subtitle="テキスト + 図解画像を生成してThreadsに投稿"
        showBackToInput={step === 'preview'}
        onBackToInput={() => setStep('input')}
      />

      {/* Step 1: 入力 */}
      {step === 'input' && (
        <div className="space-y-5">
          <Card className="space-y-4">
            {/* アカウント選択 */}
            <div>
              <SectionLabel>アカウント</SectionLabel>
              {accounts.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-[#e5edf5] bg-[#F8FAFC] px-3 py-2">
                  <span className="inline-flex items-center rounded-full bg-[#E9F7F9] px-2 py-0.5 text-xs font-medium text-[#006F83]">
                    デモモード
                  </span>
                  <span className="text-sm text-gray-500">デフォルト設定で生成します</span>
                </div>
              ) : (
                <select
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  aria-label="投稿先アカウント"
                  className={SELECT_CLASS}
                >
                  <option value="">デモモード（デフォルト設定）</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>

            {/* テーマ入力 */}
            <ThemeField
              theme={theme}
              setTheme={setTheme}
              onGenerate={() => handleGenerate()}
              suggestThemes={suggestThemes}
              suggestLoading={suggestLoading}
              suggestions={themeSuggestions}
              onPickSuggestion={t => { setTheme(t); setThemeSuggestions([]) }}
              placeholder="例：高卒でも転職できる3つの理由"
            />
          </Card>

          <PostTypeGrid options={POST_TYPES} value={postType} onChange={v => setPostType(v as PostType | '')} />

          <ReferencePanel
            open={showReference}
            onToggle={() => setShowReference(v => !v)}
            referenceAccounts={referenceAccounts}
            selectedRefAccount={selectedRefAccount}
            setSelectedRefAccount={setSelectedRefAccount}
            referencePost={referencePost}
            setReferencePost={setReferencePost}
            referenceImage={referenceImage}
            setReferenceImage={setReferenceImage}
            onUploadImage={handleReferenceImageUpload}
          />

          <GenerateButton onGenerate={() => handleGenerate()} disabled={!theme.trim()} loading={loading} />
        </div>
      )}

      {/* Step 2: プレビュー */}
      {step === 'preview' && (
        <div className="space-y-4">
          {isDemoMode && <DemoModeNotice />}

          <ThemePreviewRow
            theme={theme}
            onEdit={() => setStep('input')}
            badges={hasReference && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                参考{referencePost.trim() && referenceImage ? '投稿+画像' : referenceImage ? '画像' : '投稿'}あり
              </span>
            )}
          />

          {/* 投稿文 */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>投稿文</SectionLabel>
              <button onClick={() => handleGenerate()} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-[#006F83] transition-colors hover:text-[#005A6B] disabled:opacity-50">
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
            <div className="flex items-center justify-end border-t border-gray-100 pt-2">
              <CharCounter text={generatedText} limit={THREADS_LIMIT} />
            </div>
          </Card>

          {/* 図解画像 */}
          <ImagePanel
            label="図解画像"
            generateLabel="図解を生成"
            imageUrl={imageUrl}
            imageLoading={imageLoading}
            imageEditPrompt={imageEditPrompt}
            setImageEditPrompt={setImageEditPrompt}
            imageEditing={imageEditing}
            onGenerate={handleGenerateImage}
            onEdit={handleEditImage}
            imagePrompt={imagePrompt}
            badge={referenceImage && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">参考画像でテイスト適用</span>
            )}
            emptyText="「図解を生成」ボタンで追加（任意）"
            imageAlt="生成された図解"
          />

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
    </GenerateLayout>
  )
}
