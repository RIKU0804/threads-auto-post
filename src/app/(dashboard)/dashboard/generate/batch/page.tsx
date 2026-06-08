'use client'

// まとめて生成: 複数の投稿を一度に作って「投稿一覧」に下書き保存する。
// 3モード:
//   - count   : 1テーマ × N件（切り口の違うバリエーションをまとめて）
//   - suggest : AIが提案したテーマ案から複数選んで各1件
//   - multi   : 複数テーマ（1行1テーマ）→ 各1件
// 各アイテムは既存APIを順番に叩いて実現（サーバ集約せずクライアント orchestration）:
//   1) POST /api/generate/text  → 下書き自動作成(draftId, content)
//   2) (任意) POST /api/generate/image → imageUrl
//   3) PATCH /api/posts/[draftId] { imageUrl } で画像を添付
// 画像生成はレート制限(約5件/分)があるため逐次実行＋進捗表示。

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Sparkles, CheckCircle, AlertCircle, Loader2, ImageIcon, FileText, ArrowRight, Lightbulb } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SelectNative } from '@/components/ui/Select'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useThemeSuggestions } from '@/lib/hooks/use-theme-suggestions'
import type { Account } from '@/types/database'

type Mode = 'count' | 'suggest' | 'multi'
type ItemStatus = 'pending' | 'text' | 'image' | 'done' | 'failed'

interface BatchItem {
  theme: string
  status: ItemStatus
  withImage: boolean
  imageFailed?: boolean
  error?: string
}

const MAX_ITEMS = 5

interface AccountOption { id: string; name: string; platform: string }

export default function BatchGeneratePage() {
  const router = useRouter()
  const toast = useToast()
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [mode, setMode] = useState<Mode>('count')
  const [theme, setTheme] = useState('')
  const [count, setCount] = useState(3)
  const [multiThemes, setMultiThemes] = useState('')
  const [withImage, setWithImage] = useState(true)
  const [running, setRunning] = useState(false)
  const [items, setItems] = useState<BatchItem[]>([])
  // AI提案テーマ（suggestモード）
  const { themeSuggestions, setThemeSuggestions, suggestLoading, suggestThemes } = useThemeSuggestions(selectedAccount)
  const [selectedThemes, setSelectedThemes] = useState<string[]>([])

  // アカウントを切り替えたら提案・選択をリセット
  useEffect(() => {
    setThemeSuggestions([])
    setSelectedThemes([])
  }, [selectedAccount, setThemeSuggestions])

  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/accounts', { signal: ctrl.signal })
      .then(r => r.json())
      .then((raw: Account[] | { accounts?: Account[] }) => {
        const list = Array.isArray(raw) ? raw : (raw.accounts ?? [])
        const opts: AccountOption[] = (list as Account[])
          .filter(a => a.platform === 'threads' || a.platform === 'instagram' || a.platform === 'x')
          .map(a => ({ id: a.id, name: a.name, platform: a.platform }))
        setAccounts(opts)
        if (opts.length > 0) setSelectedAccount(opts[0].id)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  const selectedPlatform = accounts.find(a => a.id === selectedAccount)?.platform
  // Instagram は画像必須なので画像生成を強制 ON
  const imageRequired = selectedPlatform === 'instagram'
  const effectiveWithImage = imageRequired ? true : withImage

  function resolveThemes(): string[] {
    if (mode === 'count') {
      const t = theme.trim()
      return t ? Array.from({ length: count }, () => t) : []
    }
    if (mode === 'suggest') {
      return selectedThemes.slice(0, MAX_ITEMS)
    }
    return multiThemes
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, MAX_ITEMS)
  }

  const previewThemes = resolveThemes()
  const canRun = !running && !!selectedAccount && previewThemes.length > 0

  function patchItem(index: number, patch: Partial<BatchItem>) {
    setItems(prev => prev.map((it, j) => (j === index ? { ...it, ...patch } : it)))
  }

  async function runBatch() {
    if (!selectedAccount) { toast.error('アカウントを選択してください'); return }
    const themes = resolveThemes()
    if (themes.length === 0) { toast.error('テーマを入力してください'); return }

    setRunning(true)
    setItems(themes.map(t => ({ theme: t, status: 'pending', withImage: effectiveWithImage })))

    let done = 0
    for (let i = 0; i < themes.length; i++) {
      patchItem(i, { status: 'text' })
      try {
        // 1) 文章生成（下書きが自動作成され draftId が返る）
        const tRes = await fetch('/api/generate/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: selectedAccount, theme: themes[i] }),
        })
        const tData = await tRes.json().catch(() => ({})) as { content?: string; draftId?: string | null; error?: string }
        if (!tRes.ok || tData.error || !tData.content) {
          throw new Error(tData.error ?? '文章生成に失敗しました')
        }
        const draftId = tData.draftId ?? null

        // 2) 画像生成 + 3) 添付（任意・失敗しても下書き本文は残す）
        if (effectiveWithImage && draftId) {
          patchItem(i, { status: 'image' })
          try {
            const imRes = await fetch('/api/generate/image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accountId: selectedAccount, postContent: tData.content, style: 'diagram' }),
            })
            const imData = await imRes.json().catch(() => ({})) as { imageUrl?: string; error?: string }
            if (imRes.ok && imData.imageUrl) {
              await fetch(`/api/posts/${draftId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: imData.imageUrl }),
              })
            } else {
              patchItem(i, { imageFailed: true })
            }
          } catch {
            patchItem(i, { imageFailed: true })
          }
        }

        patchItem(i, { status: 'done' })
        done += 1
      } catch (e) {
        patchItem(i, { status: 'failed', error: e instanceof Error ? e.message.slice(0, 120) : '失敗しました' })
      }
    }

    setRunning(false)
    if (done > 0) toast.success(`${done}件を下書きに保存しました`)
    else toast.error('生成に失敗しました')
  }

  const allDone = items.length > 0 && !running && items.every(it => it.status === 'done' || it.status === 'failed')
  const doneCount = items.filter(it => it.status === 'done').length

  return (
    <div className="max-w-2xl p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>まとめて生成</h1>
        <p className="mt-0.5 text-sm text-gray-500">複数の投稿を一度に作成して「投稿一覧」に下書き保存します。</p>
      </div>

      <Card className="space-y-5">
        {/* アカウント */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">投稿先アカウント</p>
          {accounts.length === 0 ? (
            <p className="text-xs text-amber-600">
              先にアカウントを連携してください（
              <Link href="/dashboard/accounts" className="font-medium text-[#006F83] underline">アカウント連携</Link>
              ）
            </p>
          ) : (
            <SelectNative value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} disabled={running}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}（{a.platform}）</option>)}
            </SelectNative>
          )}
        </div>

        {/* モード切替 */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">作り方</p>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {([['count', '1テーマ × 件数'], ['suggest', 'AI提案から選ぶ'], ['multi', '複数テーマ']] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={running}
                className={cx(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                  mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 入力 */}
        {mode === 'count' ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">テーマ</p>
              <Input value={theme} onChange={e => setTheme(e.target.value)} disabled={running} placeholder="例：高卒からの転職ノウハウ" />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">件数</p>
              <SelectNative value={String(count)} onChange={e => setCount(Number(e.target.value))} disabled={running}>
                {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n}件</option>)}
              </SelectNative>
              <p className="mt-1 text-[11px] text-gray-400">同じテーマで切り口の違う投稿を {count} 件まとめて作ります。</p>
            </div>
          </div>
        ) : mode === 'suggest' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">AI提案のテーマから選ぶ（最大{MAX_ITEMS}件）</p>
              <button
                type="button"
                onClick={suggestThemes}
                disabled={running || suggestLoading || !selectedAccount}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#006F83] transition-colors hover:bg-[#E9F7F9] disabled:opacity-50"
              >
                {suggestLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Lightbulb className="h-3.5 w-3.5" />}
                {themeSuggestions.length > 0 ? '別の案を出す' : 'テーマを提案'}
              </button>
            </div>

            {themeSuggestions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center">
                <Lightbulb className="mx-auto mb-2 h-5 w-5 text-gray-300" />
                <p className="text-xs text-gray-400">
                  「テーマを提案」を押すと、このアカウント向けのテーマ案が出ます。<br />気に入ったものを選んでまとめて生成できます。
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {themeSuggestions.map(t => {
                  const checked = selectedThemes.includes(t)
                  const atMax = selectedThemes.length >= MAX_ITEMS
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={running || (!checked && atMax)}
                      onClick={() => setSelectedThemes(prev => (checked ? prev.filter(x => x !== t) : [...prev, t]))}
                      className={cx(
                        'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors',
                        checked
                          ? 'border-[#00A3BF] bg-[#E9F7F9] font-medium text-[#006F83]'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-[#00A3BF]',
                        !checked && atMax && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      {checked && <CheckCircle className="h-3 w-3" />}
                      {t}
                    </button>
                  )
                })}
              </div>
            )}

            <p className="text-[11px] text-gray-400">
              選択中: {selectedThemes.length} / 最大{MAX_ITEMS}件
              {selectedThemes.length >= MAX_ITEMS && '（上限に達しました）'}
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">テーマ（1行に1つ・最大{MAX_ITEMS}件）</p>
            <textarea
              value={multiThemes}
              onChange={e => setMultiThemes(e.target.value)}
              disabled={running}
              rows={5}
              placeholder={'転職の面接対策\n職務経歴書の書き方\n退職の切り出し方'}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20 disabled:opacity-60"
            />
            <p className="mt-1 text-[11px] text-gray-400">入力中のテーマ数: {previewThemes.length}（最大{MAX_ITEMS}件まで）</p>
          </div>
        )}

        {/* 画像 */}
        <label className={cx('flex items-center gap-2 text-sm', imageRequired ? 'text-gray-400' : 'text-gray-700')}>
          <input
            type="checkbox"
            checked={effectiveWithImage}
            disabled={running || imageRequired}
            onChange={e => setWithImage(e.target.checked)}
          />
          各投稿に図解画像も生成する
          {imageRequired && <span className="text-[11px] text-gray-400">（Instagramは画像必須）</span>}
        </label>

        <div className="border-t border-gray-100 pt-4">
          <Button onClick={runBatch} disabled={!canRun} isLoading={running} loadingText="生成中..." className="w-full gap-2">
            <Sparkles className="h-4 w-4" />
            {previewThemes.length > 0 ? `${previewThemes.length}件をまとめて生成` : 'まとめて生成'}
          </Button>
          {effectiveWithImage && (
            <p className="mt-2 text-center text-[11px] text-gray-400">
              画像生成はレート制限のため1件ずつ順番に作ります（数分かかる場合があります）。
            </p>
          )}
        </div>
      </Card>

      {/* 進捗 */}
      {items.length > 0 && (
        <div className="mt-4 space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
              <span className="shrink-0">
                {it.status === 'done' ? <CheckCircle className="h-4 w-4 text-green-600" />
                  : it.status === 'failed' ? <AlertCircle className="h-4 w-4 text-red-500" />
                  : it.status === 'pending' ? <FileText className="h-4 w-4 text-gray-300" />
                  : <Loader2 className="h-4 w-4 animate-spin text-[#00A3BF]" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{it.theme}</span>
              <span className="shrink-0 text-[11px] text-gray-500">
                {it.status === 'text' ? '文章を生成中…'
                  : it.status === 'image' ? <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" />画像を生成中…</span>
                  : it.status === 'done' ? (it.imageFailed ? '完了（画像なし）' : '完了')
                  : it.status === 'failed' ? (it.error ?? '失敗') : '待機中'}
              </span>
            </div>
          ))}
        </div>
      )}

      {allDone && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <span className="text-sm font-medium text-green-700">{doneCount}件を下書きに保存しました</span>
          <button
            onClick={() => router.push('/dashboard/drafts')}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#006F83] hover:underline"
          >
            投稿一覧で確認・投稿する <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
