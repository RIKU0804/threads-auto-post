'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Textarea } from '@/components/ui/Textarea'
import {
  GenerateLayout, GenerateHeader, DoneScreen, DemoModeNotice,
  ThemeField, PostTypeGrid, ThemePreviewRow, GenerateButton, GenerateActions,
  ManualComposeEntry, ManualModeBadge,
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

// Instagram caption: 最大2200文字 / ハッシュタグ最大30個
const IG_CAPTION_MAX = 2200

const POST_TYPES: readonly PostTypeOption[] = [
  { value: 'buzz',     label: 'バズ型',      desc: '逆説・驚き',   emoji: '⚡' },
  { value: 'empathy',  label: '共感型',      desc: '心の声代弁',  emoji: '🤝' },
  { value: 'numbers',  label: '数字型',      desc: '具体数字',    emoji: '📊' },
  { value: 'story',    label: 'ストーリー型', desc: '起承転結',    emoji: '📖' },
  { value: 'question', label: '問いかけ型',  desc: 'コメント誘導', emoji: '💬' },
]

export default function InstagramGeneratePage() {
  const toast = useToast()
  const [showPrompt, setShowPrompt] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [theme, setTheme] = useState('')
  const [postType, setPostType] = useState<PostType | ''>('')
  const [step, setStep] = useState<Step>('input')
  const [manualMode, setManualMode] = useState(false)
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
  const [scheduledAt, setScheduledAt] = useState<string | null>(null)

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
        const igAccounts = accs.filter(a => a.platform === 'instagram')
        setAccounts(igAccounts)
        if (igAccounts.length > 0) setSelectedAccount(igAccounts[0].id)
        setReferenceAccounts(refs)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        console.error('[generate/instagram] initial load failed', e instanceof Error ? e.message : 'unknown')
        toast.error('アカウント情報の取得に失敗しました。再読み込みしてください。')
      }
    }
    void loadInitial()
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDemoMode = !selectedAccount
  const selectedRefName = referenceAccounts.find(r => r.id === selectedRefAccount)?.name

  const captionLen = [...generatedText].length
  const captionOver = captionLen > IG_CAPTION_MAX

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

  // 生成時に下書きは自動保存済み。draftId があれば最新を反映、無ければ新規作成して Post を返す。
  async function persistDraft(): Promise<Post> {
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
      const post = await res.json() as Post & { error?: string }
      if (post.error) throw new Error(post.error)
      return post
    }
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
    return post
  }

  async function handleSave(publish = false) {
    // Instagram は画像必須
    if (publish && !imageUrl) {
      toast.error('Instagram投稿には画像が必須です')
      return
    }
    if (captionOver) {
      toast.error(`キャプションが${IG_CAPTION_MAX}文字を超えています`)
      return
    }
    setLoading(true)
    try {
      const post = await persistDraft()
      if (publish && selectedAccount) {
        const pubRes = await fetch(`/api/posts/${post.id}/publish`, { method: 'POST' })
        const pubData = await pubRes.json().catch(() => ({})) as { error?: string }
        // Threads/X と判定を統一。非200は本文に error 無くても失敗扱い（偽の「投稿しました！」防止）
        if (!pubRes.ok || pubData.error) {
          setSavedPost(post)
          throw new Error(pubData.error ?? '投稿に失敗しました（下書きは保存済み）')
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

  // 予約投稿: 下書きを保存 → /schedule で予約。Instagram は画像必須なので事前にガードする。
  async function handleSchedule(iso: string) {
    if (!selectedAccount) { toast.error('予約にはアカウントの選択が必要です'); return }
    if (!imageUrl) { toast.error('Instagram投稿には画像が必須です'); return }
    if (captionOver) { toast.error(`キャプションが${IG_CAPTION_MAX}文字を超えています`); return }
    setLoading(true)
    try {
      const post = await persistDraft()
      const res = await fetch(`/api/posts/${post.id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: iso, accountId: selectedAccount }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        setSavedPost(post)
        throw new Error(data.error ?? '予約に失敗しました（下書きは保存済み）')
      }
      setScheduledAt(iso)
      setSavedPost({ ...post, status: 'scheduled' })
      setStep('done')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '予約に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setStep('input')
    setManualMode(false)
    setTheme('')
    setPostType('')
    setGeneratedText('')
    setGeneratedSummary('')
    setImageUrl('')
    setImagePrompt('')
    setImageEditPrompt('')
    setSavedPost(null)
    setDraftId(null)
    setScheduledAt(null)
    setThemeSuggestions([])
    setReferencePost('')
    setSelectedRefAccount('')
    setShowReference(false)
    setReferenceImage(null)
  }

  // AI生成をスキップして「自分で書く」プレビューへ。キャプションを貼り付け、画像はAIで生成する。
  function startManual() {
    setManualMode(true)
    setTheme('')
    setPostType('')
    setGeneratedText('')
    setGeneratedSummary('')
    setImageUrl('')
    setImagePrompt('')
    setImageEditPrompt('')
    setDraftId(null)
    setStep('preview')
  }

  if (step === 'done') {
    return (
      <DoneScreen
        posted={savedPost?.status === 'posted'}
        scheduledAt={scheduledAt}
        platformLabel="Instagram"
        onReset={handleReset}
      />
    )
  }

  const hasReference = !!(referencePost.trim() || referenceImage)

  return (
    <GenerateLayout showPrompt={showPrompt} onTogglePrompt={() => setShowPrompt(v => !v)} accountId={selectedAccount}>
      <GenerateHeader
        platform="instagram"
        title="Instagram 投稿生成"
        subtitle="画像 + キャプションを生成してInstagramに投稿"
        showBackToInput={step === 'preview'}
        onBackToInput={() => setStep('input')}
      />

      {/* Step 1: 入力 */}
      {step === 'input' && (
        <div className="space-y-5">
          <Card className="space-y-4">
            {/* アカウント選択 */}
            <div>
              <SectionLabel>Instagramアカウント</SectionLabel>
              {accounts.length === 0 ? (
                <div className="flex items-start gap-2 rounded-md border border-[#e5edf5] bg-[#F8FAFC] px-3 py-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#00A3BF]" />
                  <div className="text-xs leading-relaxed text-gray-600">
                    Instagramアカウントが未登録です。
                    <Link href="/dashboard/accounts" className="ml-1 font-medium text-[#006F83] underline">アカウント追加</Link>
                    から Instagram タブで連携してください。
                    <p className="mt-1 text-gray-400">※ デモモードで生成のみ可能（投稿は不可）</p>
                  </div>
                </div>
              ) : (
                <select
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  aria-label="投稿先アカウント"
                  className={SELECT_CLASS}
                >
                  <option value="">デモモード（投稿不可）</option>
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

          <ManualComposeEntry onClick={startManual} />
        </div>
      )}

      {/* Step 2: プレビュー */}
      {step === 'preview' && (
        <div className="space-y-4">
          {isDemoMode && <DemoModeNotice />}

          {manualMode ? (
            <div className="flex items-center"><ManualModeBadge /></div>
          ) : (
            <ThemePreviewRow
              theme={theme}
              onEdit={() => setStep('input')}
              badges={hasReference && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                  参考{referencePost.trim() && referenceImage ? '投稿+画像' : referenceImage ? '画像' : '投稿'}あり
                </span>
              )}
            />
          )}

          {/* 画像（Instagram は画像必須） */}
          <ImagePanel
            label="投稿画像（必須）"
            generateLabel="画像を生成"
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
            emptyText="「画像を生成」ボタンで作成（必須）"
            emptyTall
            imageAlt="生成された画像"
          />

          {/* キャプション */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>キャプション</SectionLabel>
              {!manualMode && (
                <button onClick={() => handleGenerate()} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-[#006F83] transition-colors hover:text-[#005A6B] disabled:opacity-50">
                  <RefreshCw className={cx('h-3 w-3', loading && 'animate-spin')} />
                  再生成
                </button>
              )}
            </div>
            <Textarea
              value={generatedText}
              onChange={e => setGeneratedText(e.target.value)}
              rows={9}
              placeholder={manualMode ? 'ここにキャプションを貼り付け、または入力してください' : undefined}
              className="resize-none border-none bg-transparent p-0 shadow-none focus:ring-0"
            />
            <div className="flex items-center justify-end border-t border-gray-100 pt-2">
              <CharCounter text={generatedText} limit={IG_CAPTION_MAX} />
            </div>
          </Card>

          {/* アクション */}
          <GenerateActions
            loading={loading}
            isDemoMode={isDemoMode}
            onSaveDraft={() => handleSave(false)}
            onPublishNow={() => handleSave(true)}
            onSchedule={handleSchedule}
            saveDisabled={captionOver || !generatedText.trim()}
            actionDisabled={!imageUrl || captionOver || !generatedText.trim()}
            actionDisabledReason={captionOver
              ? `キャプションが${IG_CAPTION_MAX}文字を超えています`
              : !generatedText.trim() ? 'キャプションを入力してください'
              : !imageUrl ? '画像を生成すると投稿・予約できます' : undefined}
          />
        </div>
      )}
    </GenerateLayout>
  )
}
