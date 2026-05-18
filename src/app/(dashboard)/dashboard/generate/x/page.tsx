'use client'

import { useEffect, useState } from 'react'
import {
  Sparkles, Send, Save, RefreshCw, ChevronLeft,
  CheckCircle, Lightbulb, Scissors, Plus, X as XIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useThemeSuggestions } from '@/lib/hooks/use-theme-suggestions'
import type { Account, Post } from '@/types/database'

type Step = 'input' | 'preview' | 'done'
type PostMode = 'single' | 'thread'

const X_POST_TYPES = [
  { value: 'insight',  label: '気づき型',   desc: '学び・発見',    emoji: '💡' },
  { value: 'hook',     label: 'フック型',   desc: '最初1行で掴む', emoji: '🪝' },
  { value: 'list',     label: 'リスト型',   desc: 'N個の〇〇',    emoji: '📋' },
  { value: 'story',    label: 'ストーリー型', desc: '体験談',       emoji: '📖' },
  { value: 'question', label: '問いかけ型', desc: 'RT/返信誘導',   emoji: '💬' },
] as const

type XPostType = typeof X_POST_TYPES[number]['value']

const X_LIMIT = 280

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </p>
  )
}

function CharCounter({ text, limit = X_LIMIT }: { text: string; limit?: number }) {
  const len = [...text].length
  const remaining = limit - len
  return (
    <span className={cx(
      'text-xs tabular-nums',
      remaining < 0 ? 'text-red-500 font-semibold' : remaining < 20 ? 'text-amber-500' : 'text-gray-400'
    )}>
      {remaining}
    </span>
  )
}

export default function XGeneratePage() {
  const toast = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [theme, setTheme] = useState('')
  const [postType, setPostType] = useState<XPostType | ''>('')
  const [postMode, setPostMode] = useState<PostMode>('single')
  const [step, setStep] = useState<Step>('input')
  const [loading, setLoading] = useState(false)

  // single mode
  const [generatedText, setGeneratedText] = useState('')
  // thread mode: array of tweet texts
  const [threadParts, setThreadParts] = useState<string[]>([''])

  const [generatedSummary, setGeneratedSummary] = useState('')
  const [savedPost, setSavedPost] = useState<Post | null>(null)

  const { themeSuggestions, setThemeSuggestions, suggestLoading, suggestThemes } = useThemeSuggestions(selectedAccount)

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json() as Promise<Account[]>)
      .then(accs => {
        const xAccounts = (Array.isArray(accs) ? accs : []).filter(a => a.platform === 'x')
        setAccounts(xAccounts)
        if (xAccounts.length > 0) setSelectedAccount(xAccounts[0].id)
      })
      .catch(e => {
        console.error('[generate/x] initial load failed', e)
        toast.error('アカウント情報の取得に失敗しました。再読み込みしてください。')
      })
  }, [])

  const isDemoMode = !selectedAccount

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
        }),
      })
      const data = await res.json() as { content: string; summary: string; error?: string }
      if (data.error) throw new Error(data.error)

      if (postMode === 'thread') {
        // "---" 区切りでスレッドに分割
        const parts = data.content.split(/\n---\n/).map(s => s.trim()).filter(Boolean)
        setThreadParts(parts.length > 0 ? parts : [data.content])
      } else {
        setGeneratedText(data.content)
      }
      setGeneratedSummary(data.summary ?? '')
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

  async function handleSave(publish = false) {
    setLoading(true)
    try {
      const textContent = postMode === 'thread'
        ? threadParts.join('\n---\n')
        : generatedText

      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount || undefined,
          textContent,
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
    setThreadParts([''])
    setGeneratedSummary('')
    setSavedPost(null)
    setThemeSuggestions([])
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
              ? 'Xに投稿されました'
              : '下書きとして保存されました'}
          </p>
          <Button onClick={handleReset} className="mt-6 gap-2" style={{ backgroundColor: '#000', borderColor: '#000' }}>
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
            <Link href="/dashboard/generate" className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors">
              <ChevronLeft className="h-4 w-4" />
              戻る
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
              <XIcon className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
              X 投稿生成
            </h1>
          </div>
          <p className="mt-0.5 text-sm text-gray-500 ml-9">単発ツイート or スレッドを生成してXに投稿</p>
        </div>
        {step === 'preview' && (
          <button onClick={() => setStep('input')} className="mt-6 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft className="h-4 w-4" />
            入力に戻る
          </button>
        )}
      </div>

      {/* Step 1: 入力 */}
      {step === 'input' && (
        <div className="space-y-5">
          <Card className="space-y-4">
            {/* アカウント */}
            <div>
              <SectionLabel>アカウント</SectionLabel>
              {accounts.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-[#e5edf5] bg-[#F8FAFC] px-3 py-2">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">デモモード</span>
                  <span className="text-sm text-gray-500">デフォルト設定で生成します</span>
                </div>
              ) : (
                <select
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  aria-label="投稿先アカウント"
                  className="w-full appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-gray-700 focus:ring-2 focus:ring-gray-700/10"
                >
                  <option value="">デモモード</option>
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
                        ? 'border-gray-800 bg-gray-900 text-white'
                        : 'border-[#e5edf5] bg-white text-gray-600 hover:border-gray-300'
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
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <SectionLabel>投稿テーマ</SectionLabel>
                <button
                  onClick={suggestThemes}
                  disabled={suggestLoading}
                  className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50 transition-colors"
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
                          ? 'border-gray-800 bg-gray-900 text-white'
                          : 'border-[#e5edf5] bg-white text-gray-600 hover:border-gray-400'
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
                placeholder="例：毎日継続するための3つのコツ、AIで仕事が楽になった話"
                aria-label="投稿テーマ"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-gray-700 focus:ring-2 focus:ring-gray-700/10"
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
              {X_POST_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPostType(postType === t.value ? '' : t.value)}
                  className={cx(
                    'flex flex-col items-center gap-1 rounded-lg border py-3 px-2 text-center transition-all',
                    postType === t.value
                      ? 'border-gray-800 bg-gray-900 text-white'
                      : 'border-[#e5edf5] bg-white hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <span className="text-xl leading-none">{t.emoji}</span>
                  <span className={cx('text-xs font-medium leading-tight', postType === t.value ? 'text-white' : 'text-gray-700')}>
                    {t.label}
                  </span>
                  <span className={cx('text-[10px] leading-tight', postType === t.value ? 'text-gray-300' : 'text-gray-400')}>
                    {t.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={() => handleGenerate()}
            disabled={!theme.trim()}
            isLoading={loading}
            loadingText="生成中..."
            className="w-full gap-2 py-2.5"
            style={theme.trim() ? { backgroundColor: '#000', borderColor: '#000' } : {}}
          >
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
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">デモモード</span>
                <span className="text-xs text-gray-500">下書き保存のみ可能です</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">テーマ</span>
            <span className="text-gray-700">{theme}</span>
            <span className={cx(
              'rounded-full px-2 py-0.5 text-[10px] font-medium',
              postMode === 'thread' ? 'bg-gray-100 text-gray-600' : 'bg-gray-100 text-gray-600'
            )}>
              {postMode === 'thread' ? `スレッド ${threadParts.length}件` : '単発'}
            </span>
            <button onClick={() => setStep('input')} className="ml-auto text-xs text-gray-500 hover:underline">変更</button>
          </div>

          {/* 単発ツイート */}
          {postMode === 'single' && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionLabel>ツイート</SectionLabel>
                <div className="flex items-center gap-3">
                  <button
                    onClick={splitIntoThread}
                    className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
                    title="スレッドに変換"
                  >
                    <Scissors className="h-3 w-3" />
                    スレッド化
                  </button>
                  <button onClick={() => handleGenerate()} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50">
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
              <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                <CharCounter text={generatedText} />
                <div className={cx(
                  'h-1.5 w-1.5 rounded-full',
                  [...generatedText].length > X_LIMIT ? 'bg-red-400' : [...generatedText].length > 240 ? 'bg-yellow-400' : 'bg-green-500'
                )} />
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
                <button onClick={() => handleGenerate()} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50">
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
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <Textarea
                    value={part}
                    onChange={e => setThreadParts(prev => prev.map((p, j) => j === i ? e.target.value : p))}
                    rows={4}
                    className="resize-none border-none bg-transparent p-0 shadow-none focus:ring-0 text-sm"
                  />
                  <div className="flex justify-end border-t border-gray-100 pt-1.5">
                    <CharCounter text={part} />
                  </div>
                </Card>
              ))}

              <button
                onClick={() => setThreadParts(prev => [...prev, ''])}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 py-2.5 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
              >
                <Plus className="h-4 w-4" />
                ツイートを追加
              </button>
            </div>
          )}

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
                style={{ backgroundColor: '#000', borderColor: '#000' }}
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
