'use client'

import { useEffect, useState } from 'react'
import { Plus, User, X, AlertCircle, Eye, EyeOff, BookOpen, MessageCircle, Camera, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SelectNative } from '@/components/ui/Select'
import { cx } from '@/lib/utils'
import type { Account, ReferenceAccount } from '@/types/database'

type SupportedPlatform = 'threads' | 'instagram' | 'x'

function XIconBrand({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2H21l-6.52 7.452L22 22h-6.756l-4.706-6.156L4.97 22H2.21l6.97-7.964L2 2h6.91l4.26 5.62L18.244 2zm-2.36 18h1.638L7.207 4h-1.74l10.417 16z" />
    </svg>
  )
}

const PLATFORM_TABS: { value: SupportedPlatform; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'threads',   label: 'Threads',   icon: MessageCircle },
  { value: 'instagram', label: 'Instagram', icon: Camera },
  { value: 'x',         label: 'X (Twitter)', icon: XIconBrand },
]

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

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{children}</p>
      {optional && <span className="text-xs text-gray-400">任意</span>}
    </div>
  )
}

// ────────────────────────────────────────────
// 参考アカウント管理
// ────────────────────────────────────────────
function ReferenceAccountsSection() {
  const [refs, setRefs] = useState<ReferenceAccount[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/reference-accounts').then(r => r.json()).then((d: ReferenceAccount[]) => {
      setRefs(Array.isArray(d) ? d : [])
    })
  }, [])

  async function handleAdd() {
    if (!name.trim()) return
    setSaving(true)
    const res = await fetch('/api/reference-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), handle: handle.trim() || undefined }),
    })
    const data = await res.json() as ReferenceAccount & { error?: string }
    setSaving(false)
    if (!data.error) {
      setRefs(prev => [data, ...prev])
      setName('')
      setHandle('')
      setShowAdd(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/reference-accounts/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert('削除に失敗しました')
      return
    }
    setRefs(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[#00A3BF]" />
          <p className="text-sm font-semibold" style={{ color: '#061b31' }}>参考アカウント</p>
          <span className="text-xs text-gray-400">生成時に投稿をペーストしてネタ元として使えます</span>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1 text-xs font-medium text-[#006F83] hover:text-[#005A6B] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          追加
        </button>
      </div>

      {showAdd && (
        <Card className="mb-3 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">アカウント名 *</p>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="例：転職太郎" />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">ハンドル（任意）</p>
              <Input value={handle} onChange={e => setHandle(e.target.value)} placeholder="例：tenshoku_taro" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowAdd(false)} className="text-xs py-1.5">キャンセル</Button>
            <Button onClick={handleAdd} disabled={!name.trim() || saving} isLoading={saving} loadingText="保存中..." className="text-xs py-1.5">保存</Button>
          </div>
        </Card>
      )}

      {refs.length === 0 && !showAdd ? (
        <p className="text-xs text-gray-400 py-2">まだ登録されていません</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {refs.map(r => (
            <div key={r.id} className="flex items-center gap-1.5 rounded-full border border-[#e5edf5] bg-white px-3 py-1.5 text-xs text-gray-700">
              <BookOpen className="h-3 w-3 text-gray-400" />
              <span>{r.name}</span>
              {r.handle && <span className="text-gray-400">@{r.handle}</span>}
              <button onClick={() => handleDelete(r.id)} className="ml-1 text-gray-300 hover:text-red-400 transition-colors">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [platform, setPlatform] = useState<SupportedPlatform>('threads')
  const [form, setForm] = useState({
    name: '',
    persona: PERSONAS[0].value,
    tone: 'friendly',
    targetAudience: 'キャリアに不安のある高卒20代',
    postTopics: '転職ノウハウ、キャリア相談、仕事の悩み',
    accessToken: '',
    threadsUserId: '',
    instagramUserId: '',
    xUserId: '',
    xRefreshToken: '',
    clientId: '',
    clientSecret: '',
  })
  const [oauthLoading, setOauthLoading] = useState(false)

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(setAccounts).catch(() => {})
  }, [])

  useEffect(() => {
    // URL クエリパラメータから OAuth 結果を読む
    // useSearchParams() は Suspense 境界が要るためここでは window.location を使う
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    const ok = params.get('connected')
    if (ok === 'x') {
      setSuccessMsg('X アカウントを連携しました')
      setTimeout(() => setSuccessMsg(''), 4000)
    } else if (err) {
      setFormError(`X 連携に失敗しました: ${err}`)
      setShowForm(true)
      setPlatform('x')
    }
  }, [])

  async function handleXOAuth() {
    setFormError('')
    if (!form.name.trim()) { setFormError('アカウント名を入力してください'); return }
    setOauthLoading(true)
    try {
      const res = await fetch('/api/auth/x/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          persona: form.persona,
          tone: form.tone,
          targetAudience: form.targetAudience,
          postTopics: form.postTopics,
        }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setFormError(data.error ?? 'OAuth URL の発行に失敗しました')
        return
      }
      window.location.href = data.url
    } catch {
      setFormError('OAuth 開始に失敗しました')
    } finally {
      setOauthLoading(false)
    }
  }

  function resetForm() {
    setForm({
      name: '',
      persona: PERSONAS[0].value,
      tone: 'friendly',
      targetAudience: 'キャリアに不安のある高卒20代',
      postTopics: '転職ノウハウ、キャリア相談、仕事の悩み',
      accessToken: '',
      threadsUserId: '',
      instagramUserId: '',
      xUserId: '',
      xRefreshToken: '',
      clientId: '',
      clientSecret: '',
    })
    setPlatform('threads')
    setFormError('')
    setShowToken(false)
    setShowSecret(false)
  }

  function closeForm() {
    if (submitting) return // 送信中は閉じない
    setShowForm(false)
    resetForm()
  }

  async function handleSubmit() {
    setFormError('')
    if (!form.name.trim()) { setFormError('アカウント名を入力してください'); return }
    if (!form.accessToken.trim()) { setFormError('Access Tokenを入力してください'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          name: form.name,
          persona: form.persona,
          tone: form.tone,
          targetAudience: form.targetAudience,
          postTopics: form.postTopics,
          accessToken: form.accessToken,
          threadsUserId: form.threadsUserId,
          instagramUserId: form.instagramUserId,
          xUserId: form.xUserId,
          xRefreshToken: form.xRefreshToken,
          clientId: form.clientId,
          clientSecret: form.clientSecret,
        }),
      })
      const data = await res.json() as Account & { error?: string }
      if (!res.ok || data.error) {
        setFormError(data.error ?? 'アカウントの作成に失敗しました')
        return
      }
      setAccounts(prev => [data, ...prev])
      setShowForm(false)
      resetForm()
      setSuccessMsg(`アカウント「${data.name}」を追加しました`)
      setTimeout(() => setSuccessMsg(''), 4000)
    } catch {
      setFormError('アカウントの作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
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

      {successMsg && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 ring-1 ring-green-200">
          {successMsg}
        </div>
      )}

      {/* 参考アカウント */}
      <ReferenceAccountsSection />

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
                  <div className={cx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    account.platform === 'instagram' ? 'bg-pink-50'
                      : account.platform === 'x' ? 'bg-black'
                      : 'bg-[#E9F7F9]',
                  )}>
                    {account.platform === 'instagram'
                      ? <Camera className="h-4 w-4 text-pink-500" />
                      : account.platform === 'x'
                        ? <XIconBrand className="h-3.5 w-3.5 text-white" />
                        : <MessageCircle className="h-4 w-4 text-[#00A3BF]" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{account.name}</p>
                      <span className={cx(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                        account.platform === 'instagram' ? 'bg-pink-50 text-pink-600'
                          : account.platform === 'x' ? 'bg-gray-900 text-white'
                          : 'bg-[#E9F7F9] text-[#006F83]',
                      )}>
                        {account.platform}
                      </span>
                    </div>
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
          <div className="absolute inset-0 bg-black/40" onClick={closeForm} />
          <div
            className="relative w-full max-w-lg rounded-xl bg-white"
            style={{
              border: '1px solid #e5edf5',
              boxShadow: 'rgba(50,50,93,0.12) 0px 20px 60px -20px, rgba(0,0,0,0.1) 0px 10px 20px -10px',
            }}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-base font-semibold" style={{ color: '#061b31' }}>
                新しいアカウントを追加
              </h2>
              <button
                onClick={closeForm}
                disabled={submitting}
                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Platform tabs */}
            <div className="flex gap-1 border-b border-gray-100 bg-gray-50 px-6 py-2">
              {PLATFORM_TABS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setPlatform(value); setFormError('') }}
                  disabled={submitting}
                  className={cx(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                    platform === value
                      ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                      : 'text-gray-500 hover:text-gray-700',
                    submitting && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

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

                {/* X: OAuth ボタン */}
                {platform === 'x' && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      かんたん連携（推奨）
                    </p>
                    <p className="mb-3 text-xs text-gray-500">
                      X の OAuth 2.0 (PKCE) で連携します。トークンの取得・自動リフレッシュも含めて全自動です。
                    </p>
                    <Button
                      type="button"
                      onClick={handleXOAuth}
                      disabled={!form.name.trim() || oauthLoading}
                      isLoading={oauthLoading}
                      loadingText="リダイレクト中..."
                      className="w-full gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      X で連携する
                    </Button>
                    <p className="mt-2 text-[10px] text-gray-400">
                      アカウント名を入力した上で押してください。X の認可ページへ遷移します。
                    </p>
                  </div>
                )}

                {/* API credentials */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {platform === 'threads' ? 'Threads API 設定'
                      : platform === 'instagram' ? 'Instagram API 設定'
                      : 'X API 設定（手動）'}
                  </p>

                  <div>
                    <FieldLabel>Access Token</FieldLabel>
                    <div className="relative">
                      <Input
                        type={showToken ? 'text' : 'password'}
                        value={form.accessToken}
                        onChange={e => setForm(f => ({ ...f, accessToken: e.target.value }))}
                        placeholder={
                          platform === 'threads' ? 'THXX...'
                          : platform === 'instagram' ? 'EAA...'
                          : 'OAuth 2.0 access token'
                        }
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-gray-400">
                      {platform === 'threads'
                        ? 'Meta for Developers の Graph API Explorer または長期トークン'
                        : platform === 'instagram'
                          ? 'Facebook Page アクセストークン（Instagram Business Account 接続済み）'
                          : 'X Developer Portal で発行した OAuth 2.0 ユーザートークン (tweet.write 必須)'}
                    </p>
                  </div>

                  {platform === 'threads' && (
                    <div>
                      <FieldLabel optional>Threads User ID</FieldLabel>
                      <Input
                        value={form.threadsUserId}
                        onChange={e => setForm(f => ({ ...f, threadsUserId: e.target.value }))}
                        placeholder="空欄ならトークンから自動取得"
                      />
                    </div>
                  )}
                  {platform === 'instagram' && (
                    <div>
                      <FieldLabel optional>Instagram Business Account ID</FieldLabel>
                      <Input
                        value={form.instagramUserId}
                        onChange={e => setForm(f => ({ ...f, instagramUserId: e.target.value }))}
                        placeholder="空欄なら /me/accounts から自動取得"
                      />
                    </div>
                  )}
                  {platform === 'x' && (
                    <>
                      <div>
                        <FieldLabel optional>X User ID</FieldLabel>
                        <Input
                          value={form.xUserId}
                          onChange={e => setForm(f => ({ ...f, xUserId: e.target.value }))}
                          placeholder="空欄なら /users/me から自動取得"
                        />
                      </div>
                      <div>
                        <FieldLabel optional>Refresh Token</FieldLabel>
                        <Input
                          type={showSecret ? 'text' : 'password'}
                          value={form.xRefreshToken}
                          onChange={e => setForm(f => ({ ...f, xRefreshToken: e.target.value }))}
                          placeholder="設定するとトークン期限切れ時に自動更新"
                        />
                        <p className="mt-1 text-[10px] text-gray-400">
                          offline.access スコープで取得した refresh_token があれば設定推奨
                        </p>
                      </div>
                    </>
                  )}

                  {platform === 'threads' && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                        Client ID / Secret（任意・Meta Webhook 用）
                      </summary>
                      <div className="mt-2 space-y-2">
                        <div>
                          <FieldLabel optional>Client ID</FieldLabel>
                          <Input
                            value={form.clientId}
                            onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                            placeholder="例：1234567890123456"
                          />
                        </div>
                        <div>
                          <FieldLabel optional>Client Secret</FieldLabel>
                          <div className="relative">
                            <Input
                              type={showSecret ? 'text' : 'password'}
                              value={form.clientSecret}
                              onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))}
                              placeholder="例：abcdef1234567890..."
                              className="pr-10"
                            />
                            <button
                              type="button"
                              onClick={() => setShowSecret(v => !v)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </details>
                  )}
                </div>

                {formError && (
                  <p className="flex items-start gap-1.5 text-xs text-red-500">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span className="break-words">{formError}</span>
                  </p>
                )}

                <div className="flex gap-3 border-t border-gray-100 pt-4">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={closeForm}
                    className="flex-1"
                    disabled={submitting}
                  >
                    キャンセル
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!form.name.trim() || !form.accessToken.trim() || submitting}
                    isLoading={submitting}
                    loadingText="保存中..."
                    className="flex-1"
                  >
                    アカウントを追加
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
