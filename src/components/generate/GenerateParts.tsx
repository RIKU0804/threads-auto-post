'use client'

// 3つの投稿生成ページ（Threads / Instagram / X）で共通利用する UI 部品。
// アクセント色はアプリ基調のティール #00A3BF に統一し、各SNSの差は「本物のロゴ」だけで表現する。
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Sparkles, ChevronLeft, CheckCircle, Lightbulb, Save, Send, CalendarClock, PenLine,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AccountPromptPanel } from '@/components/generate/AccountPromptPanel'
import { PLATFORM_BRAND, type BrandPlatform } from '@/components/ui/BrandIcons'
import { cx } from '@/lib/utils'

// ── 共通トークン（ティール基調） ─────────────────────────────
const SELECT_CLASS =
  'w-full appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20'
const INPUT_CLASS =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20'

export { SELECT_CLASS, INPUT_CLASS }

// ── セクション見出し ─────────────────────────────────────────
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </p>
  )
}

// ── 文字数カウンタ（書記素単位・全SNS共通） ───────────────────
// 上限に対する使用量を「使用/上限 文字」+ ステータスドットで表示。85%超で黄、超過で赤。
export function CharCounter({ text, limit }: { text: string; limit: number }) {
  const len = [...text].length
  const over = len > limit
  const near = !over && len > limit * 0.85
  return (
    <div className="flex items-center gap-2">
      <span className={cx(
        'text-xs tabular-nums',
        over ? 'font-semibold text-red-500' : near ? 'text-amber-500' : 'text-gray-400',
      )}>
        {len} / {limit} 文字
      </span>
      <span className={cx(
        'h-1.5 w-1.5 rounded-full',
        over ? 'bg-red-400' : near ? 'bg-yellow-400' : 'bg-green-500',
      )} />
    </div>
  )
}

// ── ページヘッダー（戻る + 本物ロゴ + タイトル + 入力に戻る） ──
export function GenerateHeader({
  platform, title, subtitle, showBackToInput = false, onBackToInput,
}: {
  platform: BrandPlatform
  title: string
  subtitle: string
  showBackToInput?: boolean
  onBackToInput?: () => void
}) {
  const brand = PLATFORM_BRAND[platform]
  const Icon = brand.Icon
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <Link
            href="/dashboard/generate"
            className="flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-gray-600"
          >
            <ChevronLeft className="h-4 w-4" />
            戻る
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <div className={cx('flex h-7 w-7 items-center justify-center rounded-lg', brand.tile)}>
            <Icon className="h-4 w-4 text-white" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
            {title}
          </h1>
        </div>
        <p className="mt-0.5 ml-9 text-sm text-gray-500">{subtitle}</p>
      </div>
      {showBackToInput && (
        <button
          onClick={onBackToInput}
          className="mt-6 flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-gray-600"
        >
          <ChevronLeft className="h-4 w-4" />
          入力に戻る
        </button>
      )}
    </div>
  )
}

// 予約日時を日本語ロケールで表示用に整形（例: 6月9日(火) 22:30）
function formatScheduled(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ja-JP', {
    month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// ── 完了画面（保存／投稿／予約後・全SNS共通） ─────────────────
export function DoneScreen({
  posted, scheduledAt, platformLabel, onReset,
}: {
  posted: boolean
  /** 予約完了時の予約日時(ISO)。指定があれば「予約しました」表示にする */
  scheduledAt?: string | null
  platformLabel: string
  onReset: () => void
}) {
  const scheduled = !!scheduledAt
  const title = scheduled ? '予約しました！' : posted ? '投稿しました！' : '保存しました！'
  const subtitle = scheduled
    ? `${formatScheduled(scheduledAt!)} に ${platformLabel} へ自動投稿されます`
    : posted ? `${platformLabel}に投稿されました` : '下書きとして保存されました'
  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <Card className="py-12 text-center">
        <div className={cx(
          'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full',
          scheduled ? 'bg-[#E9F7F9]' : 'bg-green-50',
        )}>
          {scheduled
            ? <CalendarClock className="h-6 w-6 text-[#006F83]" />
            : <CheckCircle className="h-6 w-6 text-green-600" />}
        </div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={onReset} className="gap-2">
            <Sparkles className="h-4 w-4" />
            新しい投稿を生成する
          </Button>
          {scheduled && (
            <Link
              href="/dashboard/drafts"
              className="text-sm font-medium text-[#006F83] hover:underline"
            >
              予約一覧で確認・変更する →
            </Link>
          )}
        </div>
      </Card>
    </div>
  )
}

// datetime-local 入力用に Date → "YYYY-MM-DDTHH:mm"（ローカル時刻）へ
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── アクション行（下書き保存 / 予約投稿 / 今すぐ投稿・全SNS共通） ──
// 予約投稿ボタンを押すと日時ピッカーが開き、確定すると onSchedule(ISO文字列) を呼ぶ。
// publish と予約は同じ前提（アカウント選択・文字数・画像など）を満たす必要があるため、
// actionDisabled で両方をまとめて無効化する。
export function GenerateActions({
  loading, isDemoMode, onSaveDraft, onPublishNow, onSchedule,
  saveDisabled = false, actionDisabled = false, actionDisabledReason, publishLabel = '今すぐ投稿',
}: {
  loading: boolean
  isDemoMode: boolean
  onSaveDraft: () => void
  onPublishNow: () => void
  onSchedule: (iso: string) => void
  saveDisabled?: boolean
  actionDisabled?: boolean
  actionDisabledReason?: string
  publishLabel?: string
}) {
  const [scheduling, setScheduling] = useState(false)
  const [when, setWhen] = useState('')
  const [err, setErr] = useState('')
  // 過去日時を選びにくくする目安（1分後）。厳密な検証は confirm 時にも行う。
  const minLocal = useMemo(() => toLocalInputValue(new Date(Date.now() + 60_000)), [])

  function confirmSchedule() {
    setErr('')
    const d = new Date(when)
    if (!when || Number.isNaN(d.getTime())) { setErr('予約日時を入力してください'); return }
    if (d.getTime() < Date.now()) { setErr('未来の日時を指定してください'); return }
    onSchedule(d.toISOString())
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onSaveDraft} disabled={loading || saveDisabled} className="flex-1 gap-2">
          <Save className="h-4 w-4" />
          下書き保存
        </Button>
        {!isDemoMode && (
          <Button
            variant="secondary"
            onClick={() => { setErr(''); setScheduling(v => !v) }}
            disabled={loading || actionDisabled}
            aria-expanded={scheduling}
            className="flex-1 gap-2"
          >
            <CalendarClock className="h-4 w-4" />
            予約投稿
          </Button>
        )}
        {!isDemoMode && (
          <Button
            onClick={onPublishNow}
            disabled={loading || actionDisabled}
            isLoading={loading && !scheduling}
            loadingText="投稿中..."
            className="flex-1 gap-2"
          >
            <Send className="h-4 w-4" />
            {publishLabel}
          </Button>
        )}
      </div>

      {/* 投稿/予約が無効な理由（色だけの警告は見落とされやすいので明示） */}
      {!isDemoMode && actionDisabled && actionDisabledReason && (
        <p className="text-right text-xs text-red-500">{actionDisabledReason}</p>
      )}

      {/* 予約日時ピッカー */}
      {!isDemoMode && scheduling && (
        <div className="space-y-2 rounded-lg border border-[#e5edf5] bg-[#F8FAFC] p-4">
          <SectionLabel>予約日時</SectionLabel>
          <input
            type="datetime-local"
            value={when}
            min={minLocal}
            onChange={e => { setWhen(e.target.value); setErr('') }}
            aria-label="予約日時"
            className={INPUT_CLASS}
          />
          {err && <p className="text-xs text-red-500">{err}</p>}
          <p className="text-[11px] text-gray-500">指定した日時に自動で投稿されます（サーバーが毎分チェック）。</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setScheduling(false)} disabled={loading}>
              キャンセル
            </Button>
            <Button onClick={confirmSchedule} disabled={loading || !when} isLoading={loading} loadingText="予約中..." className="gap-1">
              <CalendarClock className="h-4 w-4" />
              この日時で予約
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── デモモード通知（プレビュー手順・全SNS共通） ───────────────
export function DemoModeNotice({ note }: { note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#e5edf5] bg-[#F8FAFC] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#E9F7F9] px-2 py-0.5 text-xs font-medium text-[#006F83]">
          デモモード
        </span>
        <span className="text-xs text-gray-500">
          {note ?? '下書き保存のみ可能です。実際に投稿するにはアカウント連携が必要です'}
        </span>
      </div>
      {/* どの生成ページからも同じ導線でアカウント連携へ飛べるように統一（#12/#29） */}
      <Link
        href="/dashboard/accounts"
        className="shrink-0 text-xs font-medium text-[#006F83] hover:underline"
      >
        アカウントを連携する →
      </Link>
    </div>
  )
}

// ── テーマ入力 + 提案チップ（全SNS共通） ─────────────────────
export function ThemeField({
  theme, setTheme, onGenerate, suggestThemes, suggestLoading, suggestions, onPickSuggestion, placeholder,
}: {
  theme: string
  setTheme: (v: string) => void
  onGenerate: () => void
  suggestThemes: () => void
  suggestLoading: boolean
  suggestions: string[]
  onPickSuggestion: (t: string) => void
  placeholder: string
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <SectionLabel>投稿テーマ</SectionLabel>
        <button
          onClick={suggestThemes}
          disabled={suggestLoading}
          className="flex items-center gap-1 text-xs font-medium text-[#006F83] transition-colors hover:text-[#005A6B] disabled:opacity-50"
        >
          <Lightbulb className={cx('h-3 w-3', suggestLoading && 'animate-pulse')} />
          {suggestLoading ? '考え中...' : 'テーマを提案'}
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.map(t => (
            <button
              key={t}
              onClick={() => onPickSuggestion(t)}
              className={cx(
                'rounded-full border px-3 py-1 text-left text-xs transition-all',
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
        onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && onGenerate()}
        placeholder={placeholder}
        aria-label="投稿テーマ"
        className={INPUT_CLASS}
      />
    </div>
  )
}

// ── 投稿の型グリッド（全SNS共通・選択肢は各ページが渡す） ─────
export interface PostTypeOption {
  value: string
  label: string
  desc: string
  emoji: string
}

export function PostTypeGrid({
  options, value, onChange,
}: {
  options: readonly PostTypeOption[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>投稿の型</SectionLabel>
        <span className="text-xs text-gray-400">任意</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {options.map(t => {
          const selected = value === t.value
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange(selected ? '' : t.value)}
              className={cx(
                'flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center transition-all',
                selected
                  ? 'border-[#00A3BF] bg-[#E9F7F9]'
                  : 'border-[#e5edf5] bg-white hover:border-[#c8d8e8] hover:bg-[#F8FAFC]',
              )}
            >
              <span className="text-xl leading-none">{t.emoji}</span>
              <span className={cx('text-xs font-medium leading-tight', selected ? 'text-[#006F83]' : 'text-gray-700')}>
                {t.label}
              </span>
              <span className="text-[10px] leading-tight text-gray-400">{t.desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── プレビュー上部のテーマ行（全SNS共通） ─────────────────────
export function ThemePreviewRow({
  theme, onEdit, badges,
}: {
  theme: string
  onEdit: () => void
  badges?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">テーマ</span>
      <span className="text-gray-700">{theme}</span>
      {badges}
      <button onClick={onEdit} className="ml-auto text-xs text-[#006F83] hover:underline">
        変更
      </button>
    </div>
  )
}

// ── AI生成ボタン（入力ステップ末尾・全SNS共通） ───────────────
export function GenerateButton({
  onGenerate, disabled, loading,
}: {
  onGenerate: () => void
  disabled: boolean
  loading: boolean
}) {
  return (
    <div>
      <Button
        onClick={onGenerate}
        disabled={disabled}
        isLoading={loading}
        loadingText="生成中..."
        className="w-full gap-2 py-2.5"
      >
        <Sparkles className="h-4 w-4" />
        AI生成する
      </Button>
      {disabled && !loading && (
        <p className="mt-1.5 text-center text-xs text-gray-400">
          💡 投稿テーマを入力すると生成できます
        </p>
      )}
    </div>
  )
}

// ── 「自分で書く」入口（AI生成をスキップして空のプレビューへ・全SNS共通） ──
// クライアントが自分で用意した文章を貼り付けて投稿できるようにするための導線。
export function ManualComposeEntry({ onClick }: { onClick: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[#e5edf5]" />
        <span className="text-xs text-gray-400">または</span>
        <div className="h-px flex-1 bg-[#e5edf5]" />
      </div>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#e5edf5] bg-white py-2.5 text-sm font-medium text-gray-700 transition hover:border-[#00A3BF] hover:text-[#006F83]"
      >
        <PenLine className="h-4 w-4" />
        自分で書いて投稿（テキストを貼り付け）
      </button>
      <p className="text-center text-xs text-gray-400">AIを使わず、用意した文章をそのまま投稿・予約できます</p>
    </div>
  )
}

// ── 「自分で書くモード」バッジ（プレビュー上部・全SNS共通） ──
export function ManualModeBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E9F7F9] px-2.5 py-1 text-xs font-medium text-[#006F83]">
      <PenLine className="h-3 w-3" />
      自分で書くモード
    </span>
  )
}

// ── ページ全体のシェル（プロンプト編集トグル + 折りたたみ + サイド） ──
// 3ページで完全に同一だった外枠・プロンプトパネルをひとまとめに統一。
export function GenerateLayout({
  showPrompt, onTogglePrompt, accountId, children,
}: {
  showPrompt: boolean
  onTogglePrompt: () => void
  accountId: string
  children: React.ReactNode
}) {
  return (
    <div className={cx('p-6 lg:p-8', showPrompt ? 'max-w-5xl lg:flex lg:items-start lg:gap-6' : 'mx-auto max-w-3xl')}>
      <div className="min-w-0 lg:flex-1">
        <div className="mb-4 hidden justify-end lg:flex">
          <button
            type="button"
            onClick={onTogglePrompt}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#e5edf5] bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-[#00A3BF] hover:text-[#006F83]"
          >
            {showPrompt ? '✕ プロンプトを閉じる' : '⚙ プロンプトを編集'}
          </button>
        </div>

        {children}

        {/* モバイル/中画面: フォーム下に折りたたみ */}
        <details className="mt-6 rounded-lg border border-[#e5edf5] bg-white p-4 lg:hidden">
          <summary className="cursor-pointer select-none text-sm font-semibold text-[#006F83]">
            このアカウントで使われるプロンプトを表示
          </summary>
          <div className="mt-3">
            <AccountPromptPanel accountId={accountId} />
          </div>
        </details>
      </div>

      {/* lg以上: トグルで表示するプロンプト編集パネル */}
      {showPrompt && (
        <aside className="mt-6 hidden w-full lg:sticky lg:top-6 lg:mt-0 lg:block lg:w-80 lg:shrink-0">
          <div
            className="relative w-full rounded-lg bg-white p-5 text-left"
            style={{
              border: '1px solid #e5edf5',
              boxShadow: 'rgba(50,50,93,0.08) 0px 8px 20px -8px, rgba(0,0,0,0.05) 0px 5px 10px -5px',
            }}
          >
            <AccountPromptPanel accountId={accountId} />
          </div>
        </aside>
      )}
    </div>
  )
}
