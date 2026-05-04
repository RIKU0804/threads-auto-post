'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, User, X, CheckCircle, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SelectNative } from '@/components/ui/Select'
import { cx } from '@/lib/utils'
import type { Account } from '@/types/database'

const PERSONAS = [
  { value: '転職ノウハウ発信者', label: '転職ノウハウ系' },
  { value: 'キャリアのプロ',     label: 'プロ目線系' },
  { value: '高卒から転職成功した人', label: '体験談系' },
]

const TONES = [
  { value: 'friendly',     label: 'フランク・親しみやすい' },
  { value: 'professional', label: '専門的・プロ目線' },
  { value: 'personal',     label: '体験談・等身大' },
]

const ERROR_MESSAGES: Record<string, string> = {
  cancelled:       '連携がキャンセルされました',
  session_expired: 'セッションが期限切れです。もう一度お試しください',
  invalid_state:   '不正なリクエストです。もう一度お試しください',
  token_failed:    'トークンの取得に失敗しました',
  db_failed:       'アカウントの保存に失敗しました',
  unknown:         '予期しないエラーが発生しました',
}

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{children}</p>
      {optional && <span className="text-xs text-gray-400">任意</span>}
    </div>
  )
}

function OAuthToast() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const success = searchParams.get('success') === '1'
  const errorKey = searchParams.get('error') ?? ''

  useEffect(() => {
    if (success || errorKey) {
      const timer = setTimeout(() => router.replace('/dashboard/accounts'), 3000)
      return () => clearTimeout(timer)
    }
  }, [success, errorKey, router])

  if (success) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 ring-1 ring-green-200">
        <CheckCircle className="h-4 w-4 shrink-0" />
        Threadsアカウントを連携しました！
      </div>
    )
  }
  if (errorKey) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 ring-1 ring-red-200">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {ERROR_MESSAGES[errorKey] ?? 'エラーが発生しました'}
      </div>
    )
  }
  return null
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '',
    persona: PERSONAS[0].value,
    tone: 'friendly',
    targetAudience: 'キャリアに不安のある高卒20代',
    postTopics: '転職ノウハウ、キャリア相談、仕事の悩み',
  })

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(setAccounts)
  }, [])

  function handleConnect() {
    if (!form.name.trim()) {
      alert('アカウント名を入力してください')
      return
    }
    const params = new URLSearchParams({
      name: form.name,
      persona: form.persona,
      tone: form.tone,
      targetAudience: form.targetAudience,
      postTopics: form.postTopics,
    })
    window.location.href = `/api/auth/threads/connect?${params}`
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
            アカウント
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">Threadsアカウントとペルソナを管理します</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          アカウント追加
        </Button>
      </div>

      {/* Toast */}
      <Suspense>
        <OAuthToast />
      </Suspense>

      {/* Account list */}
      <div className="space-y-3">
        {accounts.length === 0 && !showForm ? (
          <Card className="py-14 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100">
              <User className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-500">アカウントがありません</p>
            <p className="mt-0.5 text-xs text-gray-400">「アカウント追加」から登録してください</p>
          </Card>
        ) : (
          accounts.map(account => (
            <Card key={account.id} className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E9F7F9]">
                    <User className="h-4 w-4 text-[#00A3BF]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{account.name}</p>
                    <p className="text-xs text-gray-500">{account.persona}</p>
                  </div>
                </div>
                <span className={cx(
                  'rounded-full px-2.5 py-0.5 text-xs font-medium',
                  account.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500',
                )}>
                  {account.is_active ? 'アクティブ' : '停止中'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 border-t border-gray-100 pt-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">対象</p>
                  <p className="mt-0.5 text-xs text-gray-600">{account.target_audience}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">文体</p>
                  <p className="mt-0.5 text-xs text-gray-600">{TONES.find(t => t.value === account.tone)?.label}</p>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div
            className="relative w-full max-w-lg rounded-xl bg-white"
            style={{
              border: '1px solid #e5edf5',
              boxShadow: 'rgba(50,50,93,0.12) 0px 20px 60px -20px, rgba(0,0,0,0.1) 0px 10px 20px -10px',
            }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-base font-semibold" style={{ color: '#061b31' }}>
                新しいアカウントを追加
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="max-h-[calc(90vh-120px)] overflow-y-auto p-6">
              <div className="space-y-4">
                <div>
                  <FieldLabel>アカウント名</FieldLabel>
                  <Input
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="例：転職ナビ公式"
                  />
                </div>
                <div>
                  <FieldLabel>ペルソナタイプ</FieldLabel>
                  <SelectNative
                    value={form.persona}
                    onChange={e => setForm(f => ({ ...f, persona: e.target.value }))}
                  >
                    {PERSONAS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </SelectNative>
                </div>
                <div>
                  <FieldLabel>文体トーン</FieldLabel>
                  <SelectNative
                    value={form.tone}
                    onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
                  >
                    {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </SelectNative>
                </div>
                <div>
                  <FieldLabel optional>発信テーマ（読点区切り）</FieldLabel>
                  <Input
                    value={form.postTopics}
                    onChange={e => setForm(f => ({ ...f, postTopics: e.target.value }))}
                    placeholder="例：転職ノウハウ、キャリア相談"
                  />
                </div>

                {/* Divider */}
                <div className="border-t border-gray-100 pt-2">
                  <p className="mb-3 text-xs text-gray-400">
                    「Threadsで連携」を押すとMetaの認可画面に移動します。
                    認可後、自動でアカウントが作成されます。
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowForm(false)}
                    className="flex-1"
                  >
                    キャンセル
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConnect}
                    disabled={!form.name.trim()}
                    className="flex-1 gap-2"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748z"/>
                    </svg>
                    Threadsで連携
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
