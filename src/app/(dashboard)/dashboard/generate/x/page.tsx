'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Save, Send, Scissors, Plus, X } from 'lucide-react'
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
type PostMode = 'single' | 'thread'

const X_POST_TYPES: readonly PostTypeOption[] = [
  { value: 'insight',  label: '気づき型',   desc: '学び・発見',    emoji: '💡' },
  { value: 'hook',     label: 'フック型',   desc: '最初1行で掴む', emoji: '🪝' },
  { value: 'list',     label: 'リスト型',   desc: 'N個の〇〇',    emoji: '📋' },
  { value: 'story',    label: 'ストーリー型', desc: '体験談',       emoji: '📖' },
  { value: 'question', label: '問いかけ型', desc: 'RT/返信誘導',   emoji: '💬' },
]

const X_LIMIT = 280

export default function XGeneratePage() {
  const toast = useToast()
  const [showPrompt, setShowPrompt] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [theme, setTheme] = useState('')
  const [postType, setPostType] = useState<string>('')
  const [postMode, setPostMode] = useState<PostMode>('single')
  const [step, setStep] = useState<Step>('input')
  const [loading, setLoading] = useState(false)

  // single mode
  const [generatedText, setGeneratedText] = useState('')
  // thread mode: array of tweet texts
  const [threadParts, setThreadParts] = useState<string[]>([''])

  const [generatedSummary, setGeneratedSummary] = useState('')
  const [savedPost, setSavedPost] = useState<Post | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)

  const [imageUrl, setImageUrl] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [imageLoading, setImageLoading] = useState(false)
  const [imageEditPrompt, setImageEditPrompt] = useState('')
  const [imageEditing, setImageEditing] = useState(false)

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
        const xAccounts = accs.filter(a => a.platform === 'x')
        setAccounts(xAccounts)
        if (xAccounts.length > 0) setSelectedAccount(xAccounts[0].id)
        setReferenceAccounts(refs)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        console.error('[generate/x] initial load failed', e instanceof Error ? e.message : 'unknown')
        toast.error('アカウント情報の取得に失敗しました。再読み込みしてください。')
      }
    }
    void loadInitial()
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDemoMode = !selectedAccount
  const selectedRefName = referenceAccounts.find(r => r.id === selectedRefAccount)?.name
  const hasReference = !!(referencePost.trim() || referenceImage)

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
          platform: 'x',
          mode: postMode,
          referencePost: referencePost.trim() || undefined,
          referenceAccountName: selectedRefName || undefined,
          draftId: draftId ?? undefined,
        }),
      })
      const data = await res.json() as { content: string; summary: string; draftId?: string | null; error?: string }
      if (data.error) throw new Error(data.error)

      if (postMode === 'thread') {
        // "---" 区切りでスレッドに分割
        // 区切り記号は AI が生成するので揺れがある:
        // `\n---\n` / `\n\n---\n\n` / `\n-----\n` / 全角ハイフン / 周辺空白 すべて吸収
        const parts = data.content.split(/\n[ \t]*[-―ー─]{3,}[ \t]*\n/).map(s => s.trim()).filter(Boolean)
        setThreadParts(parts.length > 0 ? parts : [data.content])
      } else {
        setGeneratedText(data.content)
      }
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

  function splitIntoThread() {
    // 現在の単一ツイートを280字ごとに自動分割してスレッド化
    const words = generatedText.split('')
    const parts: string[] = []
    let current = ''
    for (const char of words) {
      if ([...current].length >= X_LIMIT - 5) {
        parts.push(current.trim())
        current = char
      } else {
        current += char
      }
    }
    if (current.trim()) parts.push(current.trim())
    setThreadParts(parts)
    setPostMode('thread')
  }

  async function handleGenerateImage() {
    // 図解は先頭ツイート（スレッドの主題）を基準に生成。
    // buildImagePrompt がタイトル＝先頭行・箇条書きを抽出する設計のため、
    // スレッド全文を改行連結すると題材がぼやけて精度が落ちる。
    const base = postMode === 'thread' ? (threadParts[0] ?? '') : generatedText
    if (!base.trim()) return
    setImageLoading(true)
    try {
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount || undefined,
          postContent: base,
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
      const textContent = postMode === 'thread'
        ? threadParts.join('\n---\n')
        : generatedText

      // 生成時に下書きは自動保存済み。draftId があれば最新を反映するだけ（二重作成しない）
      let post: Post & { error?: string }
      if (draftId) {
        const res = await fetch(`/api/posts/${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            textContent,
            imageUrl: imageUrl || null,
            summary: generatedSummary || null,
          }),
        })
        post = await res.json() as Post & { error?: string }
      } else {
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: selectedAccount || undefined,
            textContent,
            imageUrl: imageUrl || undefined,
            theme,
            summary: generatedSummary || undefined,
          }),
        })
        post = await res.json() as Post & { error?: string }
      }
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
    setThreadParts([''])
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
        platformLabel="X"
        onReset={handleReset}
      />
    )
  }

  return (
    <GenerateLayout showPrompt={showPrompt} onTogglePrompt={() => setShowPrompt(v => !v)} accountId={selectedAccount}>
      <GenerateHeader
        platform="x"
        title="X 投稿生成"
        subtitle="テキスト + 図解画像を生成してXに投稿"
        showBackToInput={step === 'preview'}
        onBackToInput={() => setStep('input')}
      />

      {/* Step 1: 入力 */}
      {step === 'input' && (
        <div className="space-y-5">
          <Card className="space-y-4">
            {/* アカウント */}
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
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (@{a.x_user_id})</option>)}
                </select>
              )}
            </div>

            {/* 投稿モード */}
            <div>
              <SectionLabel>投稿モード</SectionLabel>
              <div className="flex gap-2">
                {(['single', 'thread'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPostMode(mode)}
                    className={cx(
                      'flex-1 rounded-lg border py-2.5 text-sm font-medium transition-all',
                      postMode === mode
                        ? 'border-[#00A3BF] bg-[#E9F7F9] text-[#006F83]'
                        : 'border-[#e5edf5] bg-white text-gray-600 hover:border-[#c8d8e8]',
                    )}
                  >
                    {mode === 'single' ? '単発ツイート' : 'スレッド'}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">
                {postMode === 'thread'
                  ? 'AIが複数ツイートに分割して生成します（"---" 区切り）'
                  : '280文字以内の単発ツイートを生成します'}
              </p>
            </div>

            {/* テーマ */}
            <ThemeField
              theme={theme}
              setTheme={setTheme}
              onGenerate={() => handleGenerate()}
              suggestThemes={suggestThemes}
              suggestLoading={suggestLoading}
              suggestions={themeSuggestions}
              onPickSuggestion={t => { setTheme(t); setThemeSuggestions([]) }}
              placeholder="例：毎日継続するための3つのコツ、AIで仕事が楽になった話"
            />
          </Card>

          <PostTypeGrid options={X_POST_TYPES} value={postType} onChange={setPostType} />

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
            badges={
              <>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                  {postMode === 'thread' ? `スレッド ${threadParts.length}件` : '単発'}
                </span>
                {hasReference && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                    参考{referencePost.trim() && referenceImage ? '投稿+画像' : referenceImage ? '画像' : '投稿'}あり
                  </span>
                )}
              </>
            }
          />

          {/* 単発ツイート */}
          {postMode === 'single' && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionLabel>ツイート</SectionLabel>
                <div className="flex items-center gap-3">
                  <button
                    onClick={splitIntoThread}
                    className="flex items-center gap-1 text-xs font-medium text-[#006F83] transition-colors hover:text-[#005A6B]"
                    title="スレッドに変換"
                  >
                    <Scissors className="h-3 w-3" />
                    スレッド化
                  </button>
                  <button onClick={() => handleGenerate()} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-[#006F83] transition-colors hover:text-[#005A6B] disabled:opacity-50">
                    <RefreshCw className={cx('h-3 w-3', loading && 'animate-spin')} />
                    再生成
                  </button>
                </div>
              </div>
              <Textarea
                value={generatedText}
                onChange={e => setGeneratedText(e.target.value)}
                rows={6}
                className="resize-none border-none bg-transparent p-0 shadow-none focus:ring-0"
              />
              <div className="flex items-center justify-end border-t border-gray-100 pt-2">
                <CharCounter text={generatedText} limit={X_LIMIT} />
              </div>
            </Card>
          )}

          {/* スレッド */}
          {postMode === 'thread' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SectionLabel>スレッド</SectionLabel>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                    {threadParts.length} 件のツイート
                  </span>
                </div>
                <button onClick={() => handleGenerate()} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-[#006F83] transition-colors hover:text-[#005A6B] disabled:opacity-50">
                  <RefreshCw className={cx('h-3 w-3', loading && 'animate-spin')} />
                  再生成
                </button>
              </div>

              {threadParts.map((part, i) => (
                <Card key={i} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-400">{i + 1}/{threadParts.length}</span>
                    {threadParts.length > 1 && (
                      <button
                        onClick={() => setThreadParts(prev => prev.filter((_, j) => j !== i))}
                        className="text-gray-400 transition-colors hover:text-red-500"
                        aria-label={`${i + 1}件目のツイートを削除`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <Textarea
                    value={part}
                    onChange={e => setThreadParts(prev => prev.map((p, j) => j === i ? e.target.value : p))}
                    rows={4}
                    className="resize-none border-none bg-transparent p-0 text-sm shadow-none focus:ring-0"
                  />
                  <div className="flex justify-end border-t border-gray-100 pt-1.5">
                    <CharCounter text={part} limit={X_LIMIT} />
                  </div>
                </Card>
              ))}

              <button
                onClick={() => setThreadParts(prev => [...prev, ''])}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#e5edf5] py-2.5 text-sm text-gray-400 transition-colors hover:border-[#00A3BF] hover:text-[#006F83]"
              >
                <Plus className="h-4 w-4" />
                ツイートを追加
              </button>
            </div>
          )}

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
            footnote="スレッドの場合は1件目のツイートに添付されます"
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
              <Button
                onClick={() => handleSave(true)}
                disabled={loading}
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
    </GenerateLayout>
  )
}
