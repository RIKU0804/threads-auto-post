'use client'

// まとめて生成: 複数テーマを一度に作って「投稿一覧」に下書き保存する。
// テーマは手入力でも、AIに提案させて選んでもよい（提案チップをクリックで入力欄に追加/削除）。
// 各テーマは既存APIを順番に叩いて実現（サーバ集約せずクライアント orchestration）:
//   1) POST /api/generate/text  → 下書き自動作成(draftId, content)
//   2) (任意) POST /api/generate/image → imageUrl
//   3) PATCH /api/posts/[draftId] { imageUrl } で画像を添付（成功可否を検証）
// 画像生成はレート制限(約5件/分)があるため逐次実行＋進捗表示。実行中は「中断」可能。

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Sparkles, CheckCircle, AlertCircle, Loader2, ImageIcon, FileText, ArrowRight, Lightbulb, Plus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useThemeSuggestions } from '@/lib/hooks/use-theme-suggestions'
import { SelectNative } from '@/components/ui/Select'
import type { Account } from '@/types/database'

type ItemStatus = 'pending' | 'text' | 'image' | 'done' | 'failed'

interface BatchItem {
  theme: string
  status: ItemStatus
  imageFailed?: boolean
  error?: string
}

const MAX_ITEMS = 5

const isAbortError = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

interface AccountOption { id: string; name: string; platform: string }

export default function BatchGeneratePage() {
  const router = useRouter()
  const toast = useToast()
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [multiThemes, setMultiThemes] = useState('')
  const [withImage, setWithImage] = useState(true)
  const [running, setRunning] = useState(false)
  const [items, setItems] = useState<BatchItem[]>([])
  // AI提案テーマ
  const { themeSuggestions, setThemeSuggestions, suggestLoading, suggestThemes } = useThemeSuggestions(selectedAccount)
  // 実行中バッチの中断用。unmountedRef はアンマウント由来の中断とユーザー中断を区別する。
  const abortRef = useRef<AbortController | null>(null)
  const unmountedRef = useRef(false)
  useEffect(() => () => { unmountedRef.current = true; abortRef.current?.abort() }, [])

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

  // アカウントを切り替えたら提案をリセット（人格設定が変わるため）。手入力テーマは保持。
  useEffect(() => {
    setThemeSuggestions([])
  }, [selectedAccount, setThemeSuggestions])

  const selectedPlatform = accounts.find(a => a.id === selectedAccount)?.platform
  // Instagram は画像必須なので画像生成を強制 ON
  const imageRequired = selectedPlatform === 'instagram'
  const effectiveWithImage = imageRequired ? true : withImage

  // 入力欄を解析: 空行除去・前後空白除去・重複除去（同一テーマの二重生成を防ぐ）
  function parseThemes(text: string): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }

  const rawThemes = parseThemes(multiThemes)            // 重複除去後の全テーマ
  const previewThemes = rawThemes.slice(0, MAX_ITEMS)   // 実際に生成される先頭5件
  const overLimit = rawThemes.length > MAX_ITEMS        // 上限超過（超過分はドロップ）
  const atMax = rawThemes.length >= MAX_ITEMS           // これ以上は追加不可
  const canRun = !running && !!selectedAccount && previewThemes.length > 0

  // 提案チップのクリック: 入力欄に追加 / 既にあれば削除（トグル）。手入力の生の行は極力保持する。
  function toggleTheme(t: string) {
    setMultiThemes(prev => {
      const rawLines = prev.split('\n')
      const idx = rawLines.findIndex(l => l.trim() === t)
      if (idx >= 0) {
        // 該当行のみ削除し、他の行（空行含む）はそのまま保持
        return rawLines.filter((_, i) => i !== idx).join('\n')
      }
      if (parseThemes(prev).length >= MAX_ITEMS) return prev
      // 末尾に1行追加（末尾の余分な改行のみ整理）
      const base = prev.replace(/\n+$/, '')
      return base ? `${base}\n${t}` : t
    })
  }

  function patchItem(index: number, patch: Partial<BatchItem>) {
    setItems(prev => prev.map((it, j) => (j === index ? { ...it, ...patch } : it)))
  }

  // 画像生成→下書きへ添付。成功可否を返す（ベストエフォート。中断は例外として伝播）。
  async function attachImage(draftId: string, content: string, signal: AbortSignal): Promise<boolean> {
    const imRes = await fetch('/api/generate/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: selectedAccount, postContent: content, style: 'diagram' }),
      signal,
    })
    const imData = await imRes.json().catch(() => ({})) as { imageUrl?: string; error?: string }
    if (!imRes.ok || !imData.imageUrl) return false
    const patchRes = await fetch(`/api/posts/${draftId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: imData.imageUrl }),
      signal,
    })
    return patchRes.ok   // 添付PATCHの成否まで検証する
  }

  // 1テーマ分の処理: 文章生成→(任意)画像添付→ステータス更新。'done'|'failed'|'aborted' を返す。
  async function processTheme(i: number, theme: string, signal: AbortSignal): Promise<'done' | 'failed' | 'aborted'> {
    patchItem(i, { status: 'text' })
    try {
      // 1) 文章生成（下書きが自動作成され draftId が返る）
      const tRes = await fetch('/api/generate/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccount, theme }),
        signal,
      })
      const tData = await tRes.json().catch(() => ({})) as { content?: string; draftId?: string | null; error?: string }
      if (!tRes.ok || tData.error || !tData.content) throw new Error(tData.error ?? '文章生成に失敗しました')

      // 2) 画像生成 + 3) 添付（任意・失敗しても下書き本文は残す。失敗は imageFailed で可視化）
      if (effectiveWithImage) {
        patchItem(i, { status: 'image' })
        const draftId = tData.draftId ?? null
        let attached = false
        try {
          attached = draftId ? await attachImage(draftId, tData.content, signal) : false
        } catch (e) {
          if (signal.aborted || isAbortError(e)) throw e   // 中断は外側に伝播
          attached = false                                  // 画像はベストエフォート
        }
        if (!attached) patchItem(i, { imageFailed: true })
      }

      patchItem(i, { status: 'done' })
      return 'done'
    } catch (e) {
      if (signal.aborted || isAbortError(e)) {
        patchItem(i, { status: 'failed', error: '中断しました' })
        return 'aborted'
      }
      patchItem(i, { status: 'failed', error: e instanceof Error ? e.message.slice(0, 120) : '失敗しました' })
      return 'failed'
    }
  }

  async function runBatch() {
    if (!selectedAccount) { toast.error('アカウントを選択してください'); return }
    const themes = previewThemes
    if (themes.length === 0) { toast.error('テーマを入力してください'); return }

    // 直前の実行が残っていれば中断してから開始
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const { signal } = ctrl

    setRunning(true)
    setItems(themes.map(t => ({ theme: t, status: 'pending' })))

    let done = 0
    for (let i = 0; i < themes.length; i++) {
      if (signal.aborted) break
      const result = await processTheme(i, themes[i], signal)
      if (result === 'aborted') break
      if (result === 'done') done += 1
    }

    if (unmountedRef.current) return            // アンマウント時は状態を触らない
    setRunning(false)
    if (signal.aborted) {
      // ユーザーによる中断。完了件数を通知（通常完了は下部バナーに一本化）
      toast.show({ kind: 'info', message: done > 0 ? `${done}件を保存して中断しました` : '生成を中断しました' })
    }
  }

  function cancelBatch() {
    abortRef.current?.abort()
  }

  const allDone = items.length > 0 && !running && items.every(it => it.status === 'done' || it.status === 'failed')
  const doneCount = items.filter(it => it.status === 'done').length

  return (
    <div className="max-w-2xl p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>まとめて生成</h1>
        <p className="mt-0.5 text-sm text-gray-500">複数のテーマをまとめて「投稿一覧」に下書き保存します。テーマはAIに提案してもらうこともできます。</p>
      </div>

      <Card className="space-y-5">
        {/* アカウント */}
        <div>
          <label htmlFor="batch-account" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">投稿先アカウント</label>
          {accounts.length === 0 ? (
            <p className="text-xs text-amber-700">
              先にアカウントを連携してください（
              <Link href="/dashboard/accounts" className="font-medium text-[#006F83] underline">アカウント連携</Link>
              ）。まとめて生成はアカウント連携が必要です（単発の生成はデモモードで試せます）。
            </p>
          ) : (
            <SelectNative id="batch-account" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} disabled={running}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}（{a.platform}）</option>)}
            </SelectNative>
          )}
        </div>

        {/* テーマ入力（AI提案つき） */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="batch-themes" className="text-xs font-semibold uppercase tracking-wider text-gray-500">テーマ（1行に1つ・最大{MAX_ITEMS}件）</label>
            <button
              type="button"
              onClick={suggestThemes}
              disabled={running || suggestLoading || !selectedAccount}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#006F83] transition-colors hover:bg-[#E9F7F9] disabled:opacity-50"
            >
              {suggestLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                : <Lightbulb className="h-3.5 w-3.5" aria-hidden />}
              {themeSuggestions.length > 0 ? '別の案を出す' : 'AIに提案してもらう'}
            </button>
          </div>

          <textarea
            id="batch-themes"
            value={multiThemes}
            onChange={e => setMultiThemes(e.target.value)}
            disabled={running}
            rows={5}
            placeholder={'転職の面接対策\n職務経歴書の書き方\n退職の切り出し方'}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20 disabled:opacity-60"
          />

          {/* AI提案チップ（クリックで追加/削除） */}
          {themeSuggestions.length > 0 && (
            <div className="rounded-lg border border-[#cdeef3] bg-[#F7FCFD] p-3">
              <p className="mb-2 flex items-center gap-1 text-[11px] font-medium text-[#006F83]">
                <Sparkles className="h-3 w-3" aria-hidden /> AIの提案（クリックで追加）
              </p>
              {atMax && (
                <p className="mb-2 text-[11px] text-amber-700">
                  最大{MAX_ITEMS}件に達しました。追加するには選択中のテーマを外してください。
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {themeSuggestions.map(t => {
                  const added = rawThemes.includes(t)
                  const blocked = !added && atMax
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={added}
                      title={blocked ? `最大${MAX_ITEMS}件までです。追加するには選択中のテーマを外してください。` : undefined}
                      disabled={running || blocked}
                      onClick={() => toggleTheme(t)}
                      className={cx(
                        'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors',
                        added
                          ? 'border-[#00A3BF] bg-[#E9F7F9] font-medium text-[#006F83]'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-[#00A3BF]',
                        blocked && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      {added ? <CheckCircle className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
                      {t}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[11px] text-gray-500">生成されるテーマ: {previewThemes.length} / 最大{MAX_ITEMS}件</p>
            {overLimit && (
              <p className="text-[11px] text-amber-700">
                {rawThemes.length}件入力されています。先頭{MAX_ITEMS}件のみ生成され、{MAX_ITEMS + 1}件目以降は対象外です。
              </p>
            )}
          </div>
        </div>

        {/* 画像 */}
        {imageRequired ? (
          // Instagram は画像必須のため、トグルではなく案内を表示（強制ON）
          <div className="flex items-start gap-2 rounded-md bg-[#F7FCFD] px-3 py-2.5 text-sm text-[#006F83]">
            <ImageIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Instagramは画像が必須のため、各投稿に図解画像を自動で生成します。</span>
          </div>
        ) : (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={withImage}
              disabled={running}
              onChange={e => setWithImage(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-[#00A3BF] disabled:cursor-not-allowed"
            />
            各投稿に図解画像も生成する
          </label>
        )}

        <div className="border-t border-gray-100 pt-4">
          <Button onClick={runBatch} disabled={!canRun} isLoading={running} loadingText="生成中..." className="w-full gap-2">
            <Sparkles className="h-4 w-4" aria-hidden />
            {previewThemes.length > 0 ? `${previewThemes.length}件をまとめて生成` : 'まとめて生成'}
          </Button>

          {running && (
            <button
              type="button"
              onClick={cancelBatch}
              className="mt-2 w-full rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              中断する
            </button>
          )}

          {previewThemes.length === 0 && !!selectedAccount && !running ? (
            <p className="mt-2 text-center text-[11px] text-gray-500">テーマを1つ以上入力すると生成できます。</p>
          ) : effectiveWithImage ? (
            <p className="mt-2 text-center text-[11px] text-gray-500">
              画像生成はレート制限のため1件ずつ順番に作ります（数分かかる場合があります）。
            </p>
          ) : null}
        </div>
      </Card>

      {/* 進捗 */}
      {items.length > 0 && (
        <div className="mt-4 space-y-2" role="status" aria-live="polite" aria-atomic="false">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
              <span className="shrink-0" aria-hidden>
                {it.status === 'done' ? <CheckCircle className="h-4 w-4 text-green-600" />
                  : it.status === 'failed' ? <AlertCircle className="h-4 w-4 text-red-500" />
                  : it.status === 'pending' ? <FileText className="h-4 w-4 text-gray-300" />
                  : <Loader2 className="h-4 w-4 animate-spin text-[#00A3BF]" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{it.theme}</span>
              <span className="shrink-0 text-[11px] text-gray-500">
                {it.status === 'text' ? '文章を生成中…'
                  : it.status === 'image' ? <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" aria-hidden />画像を生成中…</span>
                  : it.status === 'done' ? (it.imageFailed ? '完了（画像なし）' : '完了')
                  : it.status === 'failed' ? (it.error ?? '失敗') : '待機中'}
              </span>
            </div>
          ))}
        </div>
      )}

      {allDone && (
        doneCount > 0 ? (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <span className="text-sm font-medium text-green-700" role="status">{doneCount}件を下書きに保存しました</span>
            <button
              onClick={() => router.push('/dashboard/drafts')}
              className="inline-flex items-center gap-1 text-sm font-medium text-[#006F83] hover:underline"
            >
              投稿一覧で確認・投稿する <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3" role="status">
            <p className="text-sm font-medium text-red-700">生成に失敗しました。少し時間をおいて、もう一度お試しください。</p>
          </div>
        )
      )}
    </div>
  )
}
