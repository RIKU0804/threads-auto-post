'use client'

import { useCallback, useEffect, useState } from 'react'
import { Save, Sparkles, ImageIcon, Lightbulb, CheckCircle, AlertCircle, FileText, Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { SelectNative } from '@/components/ui/Select'
import { PROMPT_PRESETS, type PromptKind } from '@/lib/ai/prompt-presets'
import type { Account } from '@/types/database'

interface PromptSettings {
  account_id: string
  text_extra: string | null
  image_extra: string | null
  themes_extra: string | null
}

const MAX_LEN = 4_000

const KIND_META: Record<PromptKind, { icon: React.ComponentType<{ className?: string }>; placeholder: string }> = {
  text: {
    icon: Sparkles,
    placeholder: '例: 一人称は「僕」で統一・体験談ベース・絵文字は最小限 など',
  },
  image: {
    icon: ImageIcon,
    placeholder: '例: ブランドカラー #00A3BF・角丸・人物シルエットなし など',
  },
  themes: {
    icon: Lightbulb,
    placeholder: '例: 20代向け・検索で当たる具体タイトル など',
  },
}

function SectionCard({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: PromptKind
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const meta = PROMPT_PRESETS[kind]
  const Icon = KIND_META[kind].icon
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E9F7F9]">
          <Icon className="h-3.5 w-3.5 text-[#00A3BF]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: '#061b31' }}>{meta.label}</p>
          <p className="text-[11px] text-gray-500">{meta.description}</p>
        </div>
      </div>

      <details className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <summary className="cursor-pointer flex items-center gap-1 text-gray-500 hover:text-gray-700">
          <FileText className="h-3 w-3" />
          現在のデフォルトプロンプトを見る
        </summary>
        <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-gray-600">{meta.template}</pre>
        <p className="mt-2 text-[10px] text-gray-400">
          ※ 上記はテンプレート。実行時にペルソナ・テーマ・本文が差し込まれます。<br />
          下のテキストエリアで「追加指示」を書くと、このデフォルトの末尾に安全に連結されて使われます。
        </p>
      </details>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">追加指示</p>
        <Textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={6}
          maxLength={MAX_LEN}
          placeholder={KIND_META[kind].placeholder}
          disabled={disabled}
          className="font-mono text-xs leading-relaxed"
        />
        <p className="mt-1 text-[11px] text-gray-400">{value.length} / {MAX_LEN}（空欄ならデフォルトのみ使用）</p>
      </div>
    </Card>
  )
}

export default function PromptsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [settings, setSettings] = useState<PromptSettings | null>(null)
  const [textExtra, setTextExtra] = useState('')
  const [imageExtra, setImageExtra] = useState('')
  const [themesExtra, setThemesExtra] = useState('')
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((d: Account[]) => {
        const list = Array.isArray(d) ? d : []
        setAccounts(list)
        if (list.length > 0) setSelectedAccount(list[0].id)
      })
      .catch(() => setMsg({ kind: 'error', text: 'アカウント読み込みに失敗しました' }))
      .finally(() => setAccountsLoading(false))
  }, [])

  const loadSettings = useCallback(async (accountId: string) => {
    setSettingsLoading(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/prompts?accountId=${encodeURIComponent(accountId)}`)
      const data = await res.json() as PromptSettings & { error?: string }
      if (!res.ok || data.error) {
        setMsg({ kind: 'error', text: data.error ?? '読み込みに失敗しました' })
        return
      }
      setSettings(data)
      setTextExtra(data.text_extra ?? '')
      setImageExtra(data.image_extra ?? '')
      setThemesExtra(data.themes_extra ?? '')
    } catch {
      setMsg({ kind: 'error', text: '読み込みに失敗しました' })
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedAccount) loadSettings(selectedAccount)
  }, [selectedAccount, loadSettings])

  const dirty = settings !== null && (
    (textExtra || '') !== (settings.text_extra ?? '') ||
    (imageExtra || '') !== (settings.image_extra ?? '') ||
    (themesExtra || '') !== (settings.themes_extra ?? '')
  )

  async function handleSave() {
    if (!selectedAccount) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount,
          textExtra,
          imageExtra,
          themesExtra,
        }),
      })
      const data = await res.json() as PromptSettings & { error?: string }
      if (!res.ok || data.error) {
        setMsg({ kind: 'error', text: data.error ?? '保存に失敗しました' })
        return
      }
      setSettings(data)
      setMsg({ kind: 'success', text: 'プロンプトを保存しました' })
      setTimeout(() => setMsg(null), 3000)
    } catch {
      setMsg({ kind: 'error', text: '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (!settings) return
    if (!confirm('変更を取り消してもよろしいですか？')) return
    setTextExtra(settings.text_extra ?? '')
    setImageExtra(settings.image_extra ?? '')
    setThemesExtra(settings.themes_extra ?? '')
  }

  function handleClear() {
    if (!confirm('このアカウントの追加指示を全てクリアしますか？（保存ボタンで確定）')) return
    setTextExtra('')
    setImageExtra('')
    setThemesExtra('')
  }

  const currentAccount = accounts.find(a => a.id === selectedAccount)

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
          プロンプト設定
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          アカウントごとに「追加指示」を設定できます。デフォルトのプロンプトに安全に連結されます。
        </p>
      </div>

      {msg && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ring-1 ${
          msg.kind === 'success'
            ? 'bg-green-50 text-green-700 ring-green-200'
            : 'bg-red-50 text-red-600 ring-red-200'
        }`}>
          {msg.kind === 'success'
            ? <CheckCircle className="h-4 w-4 shrink-0" />
            : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {accountsLoading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#00A3BF] border-t-transparent" />
        </div>
      ) : accounts.length === 0 ? (
        <Card className="py-14 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100">
            <Users className="h-5 w-5 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">アカウントがありません</p>
          <p className="mt-0.5 text-xs text-gray-400">「アカウント」ページで追加してください</p>
        </Card>
      ) : (
        <>
          {/* アカウント選択 */}
          <Card className="mb-4 flex items-center gap-3 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#E9F7F9]">
              <Users className="h-4 w-4 text-[#00A3BF]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">対象アカウント</p>
              <SelectNative
                value={selectedAccount}
                onChange={e => setSelectedAccount(e.target.value)}
                disabled={settingsLoading || saving}
                className="mt-1"
              >
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    [{a.platform}] {a.name}
                  </option>
                ))}
              </SelectNative>
            </div>
            {currentAccount && (
              <div className="hidden sm:block text-right text-xs text-gray-400">
                <div>ペルソナ: {currentAccount.persona ?? '—'}</div>
                <div>トーン: {currentAccount.tone}</div>
              </div>
            )}
          </Card>

          {settingsLoading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#00A3BF] border-t-transparent" />
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <SectionCard kind="text" value={textExtra} onChange={setTextExtra} disabled={saving} />
                <SectionCard kind="image" value={imageExtra} onChange={setImageExtra} disabled={saving} />
                <SectionCard kind="themes" value={themesExtra} onChange={setThemesExtra} disabled={saving} />
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
                <Button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  isLoading={saving}
                  loadingText="保存中..."
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  このアカウントに保存
                </Button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!dirty || saving}
                  className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40"
                >
                  変更を取り消す
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={saving}
                  className="ml-auto text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                >
                  このアカウントの指示を全てクリア
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
