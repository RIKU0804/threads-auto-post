'use client'

import { useEffect, useState } from 'react'
import { Plus, User, X, AlertCircle, Eye, EyeOff, BookOpen, ExternalLink, HelpCircle, Trash2, Copy, Check } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SelectNative } from '@/components/ui/Select'
import { PLATFORM_BRAND, InstagramIcon, XBrandIcon, type BrandPlatform } from '@/components/ui/BrandIcons'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { Account, ReferenceAccount } from '@/types/database'

type SupportedPlatform = 'threads' | 'instagram' | 'x'

// プラットフォームタブ。アイコンは各SNSの本物ブランドロゴ（@remixicon/react）。
const PLATFORM_TABS: { value: SupportedPlatform; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'threads',   label: 'Threads',     icon: PLATFORM_BRAND.threads.Icon },
  { value: 'instagram', label: 'Instagram',   icon: PLATFORM_BRAND.instagram.Icon },
  { value: 'x',         label: 'X (Twitter)', icon: PLATFORM_BRAND.x.Icon },
]

// アカウント追加の手順ガイド（実画面の動画は用意できないため、各ステップで「何を押し何を貼るか」を明示）
interface GuideLink { label: string; href: string }
interface SetupGuide { intro: string; links: GuideLink[]; steps: string[] }

const SETUP_GUIDES: Record<SupportedPlatform, SetupGuide> = {
  threads: {
    intro: 'Meta アプリは「最初の1回」だけ作れば、何アカウント増えても作り直し不要です。Meta アプリ＝1個（あなたの Facebook で作る）／アクセストークン＝アカウントごとに発行、という関係です（Threads API 公式仕様）。',
    links: [
      { label: 'Meta for Developers を開く', href: 'https://developers.facebook.com/apps' },
      { label: 'Threads API 公式手順', href: 'https://developers.facebook.com/docs/threads/get-started' },
    ],
    steps: [
      '【初回のみ】developers.facebook.com に自分の Facebook アカウントでログイン → 開発者登録（電話番号認証など）を済ませる',
      '【初回のみ・アプリは1個】「マイアプリ」→「アプリを作成」→ ユースケースで「Threads」を選択 → アプリ名（例: sns-autopost）を入れて作成。このアプリ1個を全アカウントで使い回します',
      '左メニュー「ユースケース」→「Threads API にアクセス」の「カスタマイズ」をクリック → 設定画面を開く',
      '「コールバックURL（リダイレクト）」に  https://threads-auto-post-umber.vercel.app/dashboard/accounts  を入力して「保存する」（空だと保存できないため。アンインストール/削除URLは将来の一般公開時のみ必要・今は空でOK）',
      '⚠️必須: 左メニュー「アプリの役割」→「役割」→ 右上「メンバーを追加」→「Threads Tester」を選び、投稿したい Threads アカウントのユーザー名を入力して送信',
      '⚠️必須: その Threads アカウントのアプリ/サイトで 設定 → アカウント → 「ウェブサイトのアクセス許可（招待）」から sns-autopost の招待を「承認」（これを忘れるとトークンが出ません）',
      '「ユースケース」→「Threads API にアクセス」→「カスタマイズ」内の Threads testers / 「アクセストークンを生成」をクリック → 承認済みアカウントを選び、権限 threads_basic（必須）＋ threads_content_publish を許可',
      '表示された access token を丸ごとコピー',
      '↓ の「Access Token」に貼り付けて保存。「Threads User ID」は空欄でOK（自動取得します）',
      '2個目以降のアカウントは手順5〜9を繰り返すだけ（手順1〜4のアプリ作成・設定は不要）',
    ],
  },
  instagram: {
    intro: '下の「Instagramと連携」ボタンを押して、Instagramでログイン・許可するだけで連携完了します。Facebookページもトークン貼り付けも不要です。（下の手順は、初回にMetaアプリをつなぐためのＭ管理者向け準備です。一度設定すれば以降は連携ボタンだけでOK）',
    links: [
      { label: 'Meta for Developers を開く', href: 'https://developers.facebook.com/apps' },
      { label: 'InstagramログインAPI 公式手順', href: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login' },
    ],
    steps: [
      '投稿先のInstagramを「プロアカウント（ビジネス or クリエイター）」かつ「公開」にする（IGアプリ → 設定 → アカウントの種類とツール／プライバシー設定で非公開をオフ）。個人アカウントや非公開のままだと連携できません',
      '【初回のみ・管理者】Metaでアプリを作成 → ユースケースで「Instagramでメッセージとコンテンツを管理」を選択して作成（Facebookページは不要）',
      '【初回のみ・管理者】左メニュー「Instagram」→「API setup with Instagram login（Instagramログインでのセットアップ）」を開く。以降の値はすべてこの画面にあります',
      '⚠️最重要: その画面の「Instagram アプリ ID」と「アプリシークレット」を ↓の連携パネルの入力欄に貼り付けて保存（アプリ内に暗号化保存）。これは Instagram 専用の値です。「アプリの設定 → ベーシック」にある Facebook(Meta) のアプリIDを入れると「Invalid platform app／このページはご利用いただけません」エラーになります',
      '【初回のみ・管理者】同じ画面の「ビジネスログインの設定」→「設定する」を開き、リダイレクトURIに ↓の連携パネルに表示される値（「MetaのリダイレクトURIに登録してください」の欄）を完全一致でコピー登録（⚠️「Webhooks」の欄ではありません。「ビジネスログインの設定」の中です）',
      '⚠️必須: 同じ「API setup with Instagram login」画面の「アクセストークンを生成する」→「アカウントを追加」を押し、連携したいInstagramでログイン →「許可」。これでアカウントがアプリに接続されます（このステップを飛ばすと連携時に「開発者の役割が不十分です」になります。※旧方式の「アプリの役割 → Instagramテスター」は新方式では使いません）',
      '↓の「Instagramと連携する」ボタンを押す → Instagramのログイン画面で対象アカウントを選び「許可」→ 自動で連携完了（トークン取得・保存まで自動）',
      '2個目以降のIGアカウントも、そのアカウントで手順1（プロ＋公開）と手順6（アカウントを追加）を済ませてから、ボタンを押してログイン・許可するだけ（アプリの再作成は不要）',
      '💡トラブル時: 「Invalid platform app／ページがご利用いただけません」→ アプリIDがFacebook側（手順4をInstagram専用IDに入れ直す）／「開発者の役割が不十分です」→ 手順6のアカウント追加が未実施／「プロフィールが存在しません」→ 投稿先が非公開orプロアカウントでない、または許可時に別アカウントでログインしている（手順1と、ログインするアカウントを確認）／「アプリ ID未設定」→ 手順4を連携パネルで保存したか確認',
    ],
  },
  x: {
    intro: 'X は Developer Portal のボタンで取れる4キーを貼るだけ（ブラウザ認可フロー不要）。X は Meta とは無関係なので developer.x.com で設定します。',
    links: [
      { label: 'X Developer Portal を開く', href: 'https://developer.x.com/en/portal/dashboard' },
    ],
    steps: [
      '【初回のみ】Developer Portal で Project と App を作成（App は必ず Project の中に作る。v2投稿はProject必須）',
      '⚠️必須: App の「User authentication settings（認証設定）」を開く（ここの設定を保存しないと投稿できません）',
      '⚠️必須: 「アプリの権限」を「Read and write（読み取りと書き込み）」に変更',
      '⚠️必須: 「アプリの種類（App type）」で「ウェブアプリ、自動化アプリまたはボット（機密クライアント / Web App）」を選択（これを選ばないと保存できません）',
      '「コールバックURI / リダイレクトURL」と「ウェブサイトURL」を入力（本アプリはブラウザ認可を使わないので値は何でもOK。両方に https://threads-auto-post-git-master-riku0804s-projects.vercel.app でOK）→ 画面下の「Save（保存）」を必ず押す',
      '⚠️順番が最重要: 上の保存が完了して【から】「Keys and tokens（キーとトークン）」へ。権限変更前に作ったトークンは Read 専用のまま残るため、必ず保存後に作り直します',
      '「Keys and tokens」で使うのは「OAuth 1.0 キー」の枠だけ（「ベアラートークン」「OAuth 2.0 キー」は使いません）',
      '①「コンシューマーキー（＝API Key。Xが名前を2つ持つだけで同じもの）」右の「再生成」→ API Key を1つ目、API Key Secret を2つ目の欄にコピー（1回しか表示されない）',
      '②「アクセストークンとシークレット」右の「再生成/生成」→ Access Token を3つ目、Access Token Secret を4つ目の欄にコピー（1回限り表示）',
      '⚠️確認: ②で生成したアクセストークンに「Read and Write」表示が付いているか必ず確認。「Read only」なら手順5の保存が未完了 → 手順2〜5をやり直してから再生成',
      '合計4個（API Key / API Key Secret / Access Token / Access Token Secret）を ↓ の各欄に順番に貼って保存。「X User ID」は空欄でOK（自動取得）。2個目以降も4キーを貼るだけ（App作成は不要）',
      '💡トラブル時: 投稿で「HTTP 403 / You are not permitted to perform this action」→ トークンがRead専用。手順5の保存 → 手順6以降の再生成 の順をやり直す（順番を逆にすると何度やってもRead専用のまま）',
    ],
  },
}

function SetupGuide({ platform, defaultOpen }: { platform: SupportedPlatform; defaultOpen: boolean }) {
  const g = SETUP_GUIDES[platform]
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      open={open}
      onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-md border border-[#cfe6ec] bg-[#F2FBFC] px-3 py-2.5 [&_summary]:list-none"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#006F83]">
        <HelpCircle className="h-3.5 w-3.5" />
        トークンの取得手順{open ? 'を隠す' : 'を見る'}（クリックで開閉）
      </summary>
      <div className="mt-2.5 space-y-2.5">
        {g.intro && <p className="text-[11px] leading-relaxed text-gray-600">{g.intro}</p>}
        <div className="flex flex-wrap gap-1.5">
          {g.links.map(l => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-[#006F83] ring-1 ring-[#cfe6ec] transition hover:bg-[#E9F7F9]"
            >
              {l.label}
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
        <ol className="space-y-1.5">
          {g.steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-gray-700">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#00A3BF] text-[9px] font-bold text-white">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
}

// Instagram は OAuth でつなぐため、トークン貼り付けではなく「連携ボタン」方式。
// 初回のみ Instagram アプリ ID / シークレットを入力（環境変数ではなくユーザーごとに暗号化保存）。
function InstagramConnectPanel({ onCancel }: { onCancel: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(false)
  const [editing, setEditing] = useState(false)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [savedAppId, setSavedAppId] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  // Meta に登録すべきリダイレクト URI の実値（実フローが送るのと同一）。ガイドのハードコード排除。
  const [redirectUri, setRedirectUri] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/api-keys')
      .then(r => r.json())
      .then((d: { has_instagram_app?: boolean; instagram_app_id?: string | null }) => {
        setConfigured(!!d.has_instagram_app)
        setSavedAppId(d.instagram_app_id ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // 実際に送られる redirect_uri を取得して画面に表示（環境ごとに正しい値を出す）
    fetch('/api/auth/instagram/config')
      .then(r => r.json())
      .then((d: { redirectUri?: string }) => setRedirectUri(d.redirectUri ?? null))
      .catch(() => {})
  }, [])

  async function copyRedirectUri() {
    if (!redirectUri) return
    try {
      await navigator.clipboard.writeText(redirectUri)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('コピーに失敗しました。手動で選択してコピーしてください')
    }
  }

  function goConnect() {
    window.location.href = '/api/auth/instagram'
  }

  async function saveAndConnect() {
    if (!appId.trim() || !appSecret.trim()) {
      toast.error('アプリ ID とアプリシークレットを両方入力してください')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instagramAppId: appId.trim(), instagramAppSecret: appSecret.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? '保存に失敗しました')
      }
      goConnect()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存に失敗しました')
      setSaving(false)
    }
  }

  const showForm = !loading && (!configured || editing)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-pink-100 bg-pink-50/60 p-4">
        <p className="text-sm font-semibold text-gray-800">Instagramと連携</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">
          ボタンを押すとInstagramのログイン画面が開きます。投稿したいアカウントでログインして「許可」するだけで連携完了です。
          <br />Facebookページもアクセストークンの貼り付けも不要です。
        </p>
      </div>

      {showForm && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Instagram アプリ設定（初回のみ）</p>
          <p className="text-[11px] leading-relaxed text-gray-500">
            ⚠️ Facebookアプリの「基本設定」にあるアプリIDではありません。Metaアプリ →「Instagram」→「APIセットアップ（Instagramログイン用）」の画面にある<strong>Instagram専用のアプリID / アプリシークレット</strong>を入力してください（FacebookのアプリIDを入れると「Invalid platform app」エラーになります）。暗号化して保存され、本人のみアクセスできます。
          </p>

          {/* Meta に登録すべきリダイレクト URI を実値で表示（ガイドのハードコード排除・環境ごとに正しい値） */}
          {redirectUri && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-[11px] font-medium text-amber-800">
                Metaの「ビジネスログインの設定」→ リダイレクトURI に、以下を<strong>完全一致</strong>で登録してください：
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-[11px] text-gray-800 ring-1 ring-amber-200">
                  {redirectUri}
                </code>
                <button
                  type="button"
                  onClick={copyRedirectUri}
                  aria-label="リダイレクトURIをコピー"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          <div>
            <FieldLabel>Instagram アプリ ID（Instagram専用・FacebookアプリIDではない）</FieldLabel>
            <Input value={appId} onChange={e => setAppId(e.target.value)} placeholder="例：1234567890123456" />
          </div>
          <div>
            <FieldLabel>Instagram アプリシークレット</FieldLabel>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={appSecret}
                onChange={e => setAppSecret(e.target.value)}
                placeholder="アプリシークレット"
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
          <Button
            type="button"
            onClick={saveAndConnect}
            disabled={saving}
            isLoading={saving}
            loadingText="保存中..."
            className="flex w-full items-center justify-center gap-2 bg-gradient-to-r from-pink-500 via-fuchsia-500 to-orange-400 hover:from-pink-600 hover:via-fuchsia-600 hover:to-orange-500"
          >
            <InstagramIcon className="h-4 w-4" />
            保存してInstagramと連携する
          </Button>
        </div>
      )}

      {!loading && configured && !editing && (
        <>
          <button
            type="button"
            onClick={goConnect}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-pink-500 via-fuchsia-500 to-orange-400 px-4 py-2.5 text-sm font-medium text-white shadow-xs transition hover:from-pink-600 hover:via-fuchsia-600 hover:to-orange-500"
          >
            <InstagramIcon className="h-4 w-4" />
            Instagramと連携する
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full text-center text-[11px] text-gray-400 hover:text-gray-600"
          >
            アプリ設定を変更{savedAppId ? `（現在: ${savedAppId}）` : ''}
          </button>
        </>
      )}

      <SetupGuide key="instagram-oauth" platform="instagram" defaultOpen={false} />

      <Button type="button" variant="secondary" onClick={onCancel} className="w-full">
        キャンセル
      </Button>
    </div>
  )
}

// X は OAuth 2.0 (PKCE) でつなぐ。ボタンを押すと X の認可画面へ飛び、許可するだけで連携完了。
// 4キーの手動貼り付けは「手動で4キー」リンクからのフォールバックとして残す。
function XConnectPanel({ onManual, onCancel }: { onManual: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-semibold text-gray-800">Xと連携</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">
          ボタンを押すとXの認可画面が開きます。投稿したいアカウントでログインして「アプリを許可」するだけで連携完了です（API Key などの貼り付けは不要）。
        </p>
      </div>

      <button
        type="button"
        onClick={() => { window.location.href = '/api/auth/x' }}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-gray-800"
      >
        <XBrandIcon className="h-4 w-4 text-white" />
        Xと連携する
      </button>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
        <p className="text-[11px] leading-relaxed text-amber-800">
          ⚠️ 初回のみ管理者設定が必要です。X Developer Portal でアプリの「User authentication settings」を
          OAuth 2.0（Web App / Confidential client）で有効化し、Callback URI に
          <code className="mx-1 break-all rounded bg-white px-1 py-0.5 font-mono text-[10px] ring-1 ring-amber-200">
            https://threads-auto-post-umber.vercel.app/api/auth/x/callback
          </code>
          を登録、Client ID / Secret を環境変数（X_OAUTH_CLIENT_ID / X_OAUTH_CLIENT_SECRET / X_OAUTH_REDIRECT_URI）に設定してください。
        </p>
      </div>

      <button
        type="button"
        onClick={onManual}
        className="w-full text-center text-[11px] text-gray-400 hover:text-gray-600"
      >
        うまくいかない場合：手動で4キーを貼って追加（旧方式）
      </button>

      <Button type="button" variant="secondary" onClick={onCancel} className="w-full">
        キャンセル
      </Button>
    </div>
  )
}

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
  const toast = useToast()
  const confirm = useConfirm()
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
    const ok = await confirm({
      title: '参考アカウントを削除',
      message: 'この参考アカウントを削除しますか？',
      confirmLabel: '削除する',
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/reference-accounts/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('削除に失敗しました')
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
  const toast = useToast()
  const confirm = useConfirm()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [platform, setPlatform] = useState<SupportedPlatform>('threads')
  // X タブ: false=OAuth連携パネル / true=手動4キー入力（フォールバック）
  const [xManual, setXManual] = useState(false)
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
    xApiKey: '',
    xApiSecret: '',
    xAccessSecret: '',
    clientId: '',
    clientSecret: '',
  })
  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(setAccounts).catch(() => {})
  }, [])

  // OAuth 連携（Instagram 等）から戻ってきた時の結果表示 + URL クリーンアップ
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const success = params.get('success')
    const error = params.get('error')
    const plat = params.get('platform')
    if (!success && !error) return
    if (success) {
      const labelMap: Record<string, string> = { instagram: 'Instagram', x: 'X', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube' }
      toast.success(`${(plat && labelMap[plat]) || plat || ''}と連携しました`)
    } else if (error) {
      const map: Record<string, string> = {
        app_not_configured: 'Instagram アプリ ID / シークレットが未設定です。連携パネルで入力してください',
        server_misconfigured: '連携の設定が不足しています（X_OAUTH_* / ENCRYPTION_KEY などの環境変数を確認してください）',
        token_exchange_failed: '連携に失敗しました。もう一度お試しください',
        userinfo_failed: 'ユーザー情報の取得に失敗しました。もう一度お試しください',
        missing_params: '連携に必要な情報が不足しています。もう一度お試しください',
        state_mismatch: 'セッションが切れました。もう一度お試しください',
        state_missing: 'セッションが切れました。もう一度お試しください',
        provider_error: '連携が許可されませんでした',
        db_error: '保存に失敗しました。もう一度お試しください',
        unauthorized: 'ログインが必要です',
      }
      toast.error(map[error] ?? `連携に失敗しました（${error}）`)
    }
    // クエリを消して再読込時の二重表示を防ぐ
    window.history.replaceState({}, '', window.location.pathname)
  }, [toast])

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
      xApiKey: '',
      xApiSecret: '',
      xAccessSecret: '',
      clientId: '',
      clientSecret: '',
    })
    setPlatform('threads')
    setXManual(false)
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
          xApiKey: form.xApiKey,
          xApiSecret: form.xApiSecret,
          xAccessSecret: form.xAccessSecret,
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

  async function handleDeleteAccount(account: Account) {
    const ok = await confirm({
      title: 'アカウントを削除',
      message: `「${account.name}」を削除しますか？このアカウントの投稿履歴・テーマ案も一緒に削除されます（生成済みの動画は残ります）。この操作は取り消せません。`,
      confirmLabel: '削除する',
      destructive: true,
    })
    if (!ok) return
    setDeletingId(account.id)
    try {
      const res = await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        toast.error(data.error ?? '削除に失敗しました')
        return
      }
      setAccounts(prev => prev.filter(a => a.id !== account.id))
      toast.success(`アカウント「${account.name}」を削除しました`)
    } catch {
      toast.error('削除に失敗しました')
    } finally {
      setDeletingId(null)
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
          <p className="mt-0.5 text-sm text-gray-500">Threads / Instagram / X のアカウントとペルソナを管理します</p>
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
          accounts.map(account => {
            // 各SNSの本物ブランドロゴ + ブランド色タイル。未対応プラットフォームは中立表示。
            const brand = PLATFORM_BRAND[account.platform as BrandPlatform]
            const BrandIcon = brand?.Icon ?? User
            return (
            <Card key={account.id} className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    brand?.tile ?? 'bg-gray-100',
                  )}>
                    <BrandIcon className={cx('h-4 w-4', brand ? 'text-white' : 'text-gray-400')} aria-hidden />
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
                <div className="flex items-center gap-2">
                  <span className={cx(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium',
                    account.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500',
                  )}>
                    {account.is_active ? 'アクティブ' : '停止中'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteAccount(account)}
                    disabled={deletingId === account.id}
                    aria-label={`アカウント「${account.name}」を削除`}
                    title="アカウントを削除"
                    className="flex h-9 w-9 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingId === account.id
                      ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                      : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
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
            )
          })
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
                {platform === 'instagram' && (
                  <InstagramConnectPanel onCancel={closeForm} />
                )}

                {platform === 'x' && !xManual && (
                  <XConnectPanel onManual={() => setXManual(true)} onCancel={closeForm} />
                )}

                {(platform === 'threads' || (platform === 'x' && xManual)) && (<>
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

                {/* API credentials */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {platform === 'threads' ? 'Threads API 設定' : 'X API 設定'}
                  </p>

                  <SetupGuide key={platform} platform={platform} defaultOpen={!form.accessToken.trim()} />

                  <div>
                    <FieldLabel>Access Token</FieldLabel>
                    <div className="relative">
                      <Input
                        type={showToken ? 'text' : 'password'}
                        value={form.accessToken}
                        onChange={e => setForm(f => ({ ...f, accessToken: e.target.value }))}
                        placeholder={
                          platform === 'threads' ? 'THXX...'
                          : 'Access Token（Keys and tokens の3つ目）'
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
                        : 'X Developer Portal「Keys and tokens」の Access Token（App permissions は Read and write 必須）'}
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
                  {platform === 'x' && (
                    <>
                      <div>
                        <FieldLabel>API Key</FieldLabel>
                        <Input
                          value={form.xApiKey}
                          onChange={e => setForm(f => ({ ...f, xApiKey: e.target.value }))}
                          placeholder="Keys and tokens の API Key（1つ目）"
                          aria-label="X API Key"
                        />
                      </div>
                      <div>
                        <FieldLabel>API Key Secret</FieldLabel>
                        <Input
                          type={showSecret ? 'text' : 'password'}
                          value={form.xApiSecret}
                          onChange={e => setForm(f => ({ ...f, xApiSecret: e.target.value }))}
                          placeholder="API Key Secret（2つ目）"
                          aria-label="X API Key Secret"
                        />
                      </div>
                      <div>
                        <FieldLabel>Access Token Secret</FieldLabel>
                        <Input
                          type={showSecret ? 'text' : 'password'}
                          value={form.xAccessSecret}
                          onChange={e => setForm(f => ({ ...f, xAccessSecret: e.target.value }))}
                          placeholder="Access Token Secret（4つ目）"
                          aria-label="X Access Token Secret"
                        />
                      </div>
                      <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        <input
                          type="checkbox"
                          checked={showSecret}
                          onChange={e => setShowSecret(e.target.checked)}
                        />
                        Secret を表示
                      </label>
                      <div>
                        <FieldLabel optional>X User ID</FieldLabel>
                        <Input
                          value={form.xUserId}
                          onChange={e => setForm(f => ({ ...f, xUserId: e.target.value }))}
                          placeholder="空欄なら /users/me から自動取得"
                          aria-label="X User ID"
                        />
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
                </>)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
