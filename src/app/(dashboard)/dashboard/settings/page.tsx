'use client'

import { useEffect, useState } from 'react'
import { Save, KeyRound, CheckCircle, AlertCircle, Eye, EyeOff, ExternalLink, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface KeysState {
  openrouter_masked: string | null
  openai_masked: string | null
  has_openrouter: boolean
  has_openai: boolean
  updated_at: string | null
}

function KeyField({
  label,
  description,
  link,
  hasKey,
  masked,
  value,
  onChange,
  onClear,
  show,
  onToggleShow,
}: {
  label: string
  description: string
  link: { href: string; text: string }
  hasKey: boolean
  masked: string | null
  value: string
  onChange: (v: string) => void
  onClear: () => void
  show: boolean
  onToggleShow: () => void
}) {
  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E9F7F9]">
          <KeyRound className="h-3.5 w-3.5 text-[#00A3BF]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: '#061b31' }}>{label}</p>
          <p className="text-[11px] text-gray-500">{description}</p>
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#006F83] hover:underline"
          >
            {link.text}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {hasKey && (
        <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-xs">
          <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
          <span className="text-gray-600">登録済み:</span>
          <span className="font-mono text-gray-900">{masked}</span>
          <button
            onClick={onClear}
            className="ml-auto flex items-center gap-0.5 text-gray-400 hover:text-red-500 transition-colors"
            title="このキーを削除"
          >
            <Trash2 className="h-3 w-3" />
            削除
          </button>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">
          {hasKey ? '新しいキーで上書きする（空欄なら変更なし）' : 'API キーを入力'}
        </p>
        <div className="relative">
          <Input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={hasKey ? '（変更しない場合は空欄）' : 'sk-... または sk-or-...'}
            className="pr-10 font-mono"
            aria-label={`${label}を入力`}
          />
          <button
            type="button"
            onClick={onToggleShow}
            aria-label={show ? 'キーを隠す' : 'キーを表示'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </Card>
  )
}

export default function SettingsPage() {
  const [keys, setKeys] = useState<KeysState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const [openrouterInput, setOpenrouterInput] = useState('')
  const [openaiInput, setOpenaiInput] = useState('')
  const [showOpenrouter, setShowOpenrouter] = useState(false)
  const [showOpenai, setShowOpenai] = useState(false)

  useEffect(() => {
    fetch('/api/api-keys')
      .then(r => r.json())
      .then((d: KeysState) => setKeys(d))
      .catch(() => setMsg({ kind: 'error', text: '読み込みに失敗しました' }))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setMsg(null)
    try {
      // 空欄なら undefined を送って既存値を保持、入力があれば trim 後のキーを送る
      const payload: { openrouterKey?: string; openaiKey?: string } = {}
      if (openrouterInput.trim()) payload.openrouterKey = openrouterInput.trim()
      if (openaiInput.trim()) payload.openaiKey = openaiInput.trim()

      if (Object.keys(payload).length === 0) {
        setMsg({ kind: 'error', text: '保存するキーを入力してください' })
        setSaving(false)
        return
      }

      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as KeysState & { error?: string }
      if (!res.ok || data.error) {
        setMsg({ kind: 'error', text: data.error ?? '保存に失敗しました' })
        return
      }
      setKeys(data)
      setOpenrouterInput('')
      setOpenaiInput('')
      setMsg({ kind: 'success', text: 'API キーを保存しました' })
      setTimeout(() => setMsg(null), 3000)
    } catch {
      setMsg({ kind: 'error', text: '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  async function handleClear(provider: 'openrouter' | 'openai') {
    if (!confirm(`${provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} のキーを削除しますか？`)) return
    setSaving(true)
    setMsg(null)
    try {
      const payload = provider === 'openrouter' ? { openrouterKey: null } : { openaiKey: null }
      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as KeysState & { error?: string }
      if (!res.ok || data.error) {
        setMsg({ kind: 'error', text: data.error ?? '削除に失敗しました' })
        return
      }
      setKeys(data)
      setMsg({ kind: 'success', text: 'キーを削除しました' })
      setTimeout(() => setMsg(null), 3000)
    } catch {
      setMsg({ kind: 'error', text: '削除に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  const canSave = !!(openrouterInput.trim() || openaiInput.trim())

  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
          設定
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          生成 AI で使用する API キーを登録します。<br />
          各キーは暗号化通信で保存され、本人のみアクセスできます（Supabase RLS）。
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

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#00A3BF] border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <KeyField
              label="OpenRouter API キー"
              description="テキスト生成（Gemini 2.0 Flash）と参考画像分析で使用します"
              link={{ href: 'https://openrouter.ai/keys', text: 'OpenRouter で発行' }}
              hasKey={keys?.has_openrouter ?? false}
              masked={keys?.openrouter_masked ?? null}
              value={openrouterInput}
              onChange={setOpenrouterInput}
              onClear={() => handleClear('openrouter')}
              show={showOpenrouter}
              onToggleShow={() => setShowOpenrouter(v => !v)}
            />
            <KeyField
              label="OpenAI API キー"
              description="画像生成（gpt-image-2）で使用します"
              link={{ href: 'https://platform.openai.com/api-keys', text: 'OpenAI で発行' }}
              hasKey={keys?.has_openai ?? false}
              masked={keys?.openai_masked ?? null}
              value={openaiInput}
              onChange={setOpenaiInput}
              onClear={() => handleClear('openai')}
              show={showOpenai}
              onToggleShow={() => setShowOpenai(v => !v)}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
            <Button
              onClick={handleSave}
              disabled={!canSave || saving}
              isLoading={saving}
              loadingText="保存中..."
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              入力したキーを保存
            </Button>
            {keys?.updated_at && (
              <span className="text-[11px] text-gray-400">
                最終更新: {new Date(keys.updated_at).toLocaleString('ja-JP')}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
