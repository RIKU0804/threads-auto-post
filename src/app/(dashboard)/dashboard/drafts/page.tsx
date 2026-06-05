'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText, Send, Trash2, User, ImageIcon, RefreshCw,
  CheckCircle, ChevronDown, ChevronUp, X, Video as VideoIcon, Plus,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { VideoCard } from '@/components/videos/VideoCard'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useModalA11y } from '@/lib/hooks/use-modal-a11y'
import type { Account, Post, Video } from '@/types/database'

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:      { label: '下書き',   cls: 'bg-gray-100 text-gray-600' },
  publishing: { label: '投稿中',   cls: 'bg-blue-50 text-blue-600' },
  posted:     { label: '投稿済み', cls: 'bg-green-50 text-green-700' },
  failed:     { label: 'エラー',   cls: 'bg-red-50 text-red-600' },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface AccountOption {
  id: string
  name: string
  platform: string
}

// 下書き一覧の「動画」タブ用。/api/videos は scenes を count 形・thumbnail なしで返す
interface VideoListItem extends Video {
  scenes?: { count: number }[] | null
  thumbnail_url?: string | null
}

function DraftCard({
  post,
  accounts,
  onPublish,
  onDelete,
  publishing,
  deleting,
}: {
  post: Post
  accounts: AccountOption[]
  onPublish: (id: string, accountId?: string) => void
  onDelete: (id: string) => void
  publishing: boolean
  deleting: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [imgOpen, setImgOpen] = useState(false)
  const imgModalRef = useModalA11y<HTMLDivElement>(imgOpen, () => setImgOpen(false))
  // account_id 未割当の post に対する選択中アカウント。
  // 初期値を空にすることで「最初の1つに暗黙投稿」事故を防ぐ → 明示的に選ぶまで投稿ボタン disabled。
  const [pickerAccountId, setPickerAccountId] = useState<string>('')

  const { label, cls } = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.draft
  const text = post.text_content ?? ''
  const isLong = text.length > 120
  const displayText = isLong && !expanded ? text.slice(0, 120) + '…' : text

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex gap-0">
        {/* メディアエリア（画像 > なし） */}
        <div className="shrink-0">
          {post.image_url ? (
            <>
              <button
                type="button"
                onClick={() => setImgOpen(true)}
                aria-label="投稿画像を拡大表示"
                className="block rounded-md focus-visible:outline-2 focus-visible:outline-[#00A3BF] focus-visible:outline-offset-2"
              >
                <img
                  src={post.image_url}
                  alt="投稿画像"
                  className="h-36 w-36 object-cover transition hover:opacity-90"
                />
              </button>
              {imgOpen && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                  onClick={() => setImgOpen(false)}
                >
                  <div
                    ref={imgModalRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label="投稿画像のプレビュー"
                    className="relative"
                  >
                    <img
                      src={post.image_url}
                      alt="投稿画像"
                      className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
                      onClick={e => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      onClick={() => setImgOpen(false)}
                      aria-label="閉じる"
                      className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-gray-700 shadow hover:bg-white focus-visible:outline-2 focus-visible:outline-[#00A3BF]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-36 w-36 flex-col items-center justify-center bg-gray-50">
              <ImageIcon className="h-6 w-6 text-gray-200" />
              <span className="mt-1 text-[10px] text-gray-300">なし</span>
            </div>
          )}
        </div>

        {/* テキストエリア */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          {/* メタ情報 */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>
              {label}
            </span>
            {post.theme && (
              <span className="truncate text-[11px] text-gray-500">#{post.theme}</span>
            )}
            <span className="ml-auto text-[11px] text-gray-500">
              {formatDate(post.created_at)}
            </span>
          </div>

          {/* 投稿本文 */}
          <p className="flex-1 whitespace-pre-line text-sm leading-relaxed text-gray-700">
            {displayText}
          </p>

          {/* 展開ボタン & アクション */}
          <div className="mt-2 flex items-center gap-3">
            {isLong && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-0.5 text-xs text-[#006F83] hover:text-[#005A6B] transition-colors"
              >
                {expanded
                  ? <><ChevronUp className="h-3.5 w-3.5" />閉じる</>
                  : <><ChevronDown className="h-3.5 w-3.5" />続きを見る</>
                }
              </button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {(post.status === 'draft' || post.status === 'failed') && post.account_id && (
                <Button
                  onClick={() => onPublish(post.id)}
                  disabled={publishing}
                  isLoading={publishing}
                  loadingText="投稿中..."
                  className="gap-1 py-1 px-2.5 text-xs"
                >
                  <Send className="h-3 w-3" />
                  今すぐ投稿
                </Button>
              )}
              {/* account_id 未割当: アカウント選択して投稿 */}
              {(post.status === 'draft' || post.status === 'failed') && !post.account_id && (
                <>
                  {accounts.length === 0 ? (
                    <span className="text-[11px] text-amber-600">
                      投稿先アカウントを先に追加してください
                    </span>
                  ) : (
                    <>
                      <select
                        value={pickerAccountId}
                        onChange={(e) => setPickerAccountId(e.target.value)}
                        aria-label="投稿先アカウント"
                        className="appearance-none rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-hidden focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
                      >
                        <option value="">アカウントを選択</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}（{a.platform}）
                          </option>
                        ))}
                      </select>
                      <Button
                        onClick={() => onPublish(post.id, pickerAccountId)}
                        disabled={publishing || !pickerAccountId}
                        isLoading={publishing}
                        loadingText="投稿中..."
                        className="gap-1 py-1 px-2.5 text-xs"
                      >
                        <Send className="h-3 w-3" />
                        投稿
                      </Button>
                    </>
                  )}
                </>
              )}
              {post.status !== 'posted' && (
                <button
                  onClick={() => onDelete(post.id)}
                  disabled={deleting}
                  className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  削除
                </button>
              )}
              {post.status === 'posted' && (
                <span className="flex items-center gap-1 text-[11px] text-green-600">
                  <CheckCircle className="h-3.5 w-3.5" />投稿済み
                </span>
              )}
            </div>
          </div>

          {post.account_id ? (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-300">
              <User className="h-3 w-3" />
              アカウントあり
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-500">
              <User className="h-3 w-3" />
              アカウント未割当（投稿時に選択してください）
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

export default function DraftsPage() {
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const [posts, setPosts] = useState<Post[]>([])
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [videos, setVideos] = useState<VideoListItem[]>([])
  const [filter, setFilter] = useState<'all' | 'draft' | 'posted' | 'failed' | 'video'>('all')

  async function load(signal?: AbortSignal) {
    setLoading(true)
    try {
      // posts と accounts を並列取得
      const [postsRes, accountsRes, videosRes] = await Promise.all([
        fetch('/api/posts', { signal }),
        fetch('/api/accounts', { signal }),
        fetch('/api/videos', { signal }),
      ])

      if (!postsRes.ok) throw new Error(`posts HTTP ${postsRes.status}`)
      const postsData = await postsRes.json() as Post[]
      setPosts(Array.isArray(postsData) ? postsData : [])

      if (accountsRes.ok) {
        const raw = await accountsRes.json() as Account[] | { accounts?: Account[] }
        const list = Array.isArray(raw) ? raw : (raw.accounts ?? [])
        // posts 投稿先となるプラットフォーム (threads / instagram / x) のみ抽出
        const filtered: AccountOption[] = (list as Account[])
          .filter((a) => a.platform === 'threads' || a.platform === 'instagram' || a.platform === 'x')
          .map((a) => ({ id: a.id, name: a.name, platform: a.platform }))
        setAccounts(filtered)
      }

      // 動画は補助表示。取得に失敗しても下書き本体は表示するため throw しない
      if (videosRes.ok) {
        const vraw = await videosRes.json() as { videos?: VideoListItem[] }
        setVideos(Array.isArray(vraw.videos) ? vraw.videos : [])
      } else {
        setVideos([])
      }
    } catch (e) {
      // アンマウント等による中断は無視
      if (e instanceof DOMException && e.name === 'AbortError') return
      console.error('[drafts load]', e instanceof Error ? e.message : 'unknown')
      toast.error('読み込みに失敗しました。通信状況を確認して再読み込みしてください。')
    } finally {
      // 成功・失敗いずれでもローディングを必ず解除 (永久スピナー防止)
      // 中断時は setState を避ける (アンマウント後の警告防止)
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
    // load は再生成されるが初回マウントのみで使うので依存は空でよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePublish(postId: string, accountId?: string) {
    setPublishing(postId)
    try {
      const res = await fetch(`/api/posts/${postId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: accountId ? JSON.stringify({ accountId }) : undefined,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        toast.error(data.error ?? '投稿に失敗しました')
        return
      }
      toast.success('投稿しました')
      // 全件 refetch せず該当 post だけローカルで posted に更新
      setPosts(prev => prev.map(p =>
        p.id === postId
          ? { ...p, status: 'posted', account_id: accountId ?? p.account_id }
          : p,
      ))
    } finally {
      setPublishing(null)
    }
  }

  async function handleDelete(postId: string) {
    const ok = await confirm({
      title: '投稿を削除',
      message: 'この投稿を削除しますか？この操作は取り消せません。',
      confirmLabel: '削除する',
      destructive: true,
    })
    if (!ok) return
    setDeleting(postId)
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('削除に失敗しました')
        return
      }
      setPosts(prev => prev.filter(p => p.id !== postId))
    } finally {
      setDeleting(null)
    }
  }

  const filtered = filter === 'all' || filter === 'video'
    ? posts
    : posts.filter(p => p.status === filter)

  const counts = {
    all:    posts.length,
    draft:  posts.filter(p => p.status === 'draft').length,
    posted: posts.filter(p => p.status === 'posted').length,
    failed: posts.filter(p => p.status === 'failed').length,
    video:  videos.length,
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
            下書き一覧
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">生成した投稿・動画の管理</p>
        </div>
        <button
          onClick={() => load()}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-600 transition-colors"
        >
          <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
          更新
        </button>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1">
        {(['all', 'draft', 'posted', 'failed', 'video'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cx(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              filter === f
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {f === 'all' ? 'すべて' : f === 'video' ? '動画' : STATUS_CONFIG[f].label}
            <span className={cx(
              'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]',
              filter === f ? 'bg-gray-100 text-gray-600' : 'bg-gray-200 text-gray-500',
            )}>
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#00A3BF] border-t-transparent" />
        </div>
      ) : filter === 'video' ? (
        videos.length === 0 ? (
          <Card className="py-14 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100">
              <VideoIcon className="h-5 w-5 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-500">動画がまだありません</p>
            <p className="mt-0.5 text-xs text-gray-500">「動画投稿」から作成してください</p>
            <Button onClick={() => router.push('/dashboard/videos/new')} className="mt-4 gap-1.5">
              <Plus className="h-4 w-4" />
              動画を作成する
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {videos.map(v => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <Card className="py-14 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100">
            <FileText className="h-5 w-5 text-gray-500" />
          </div>
          <p className="text-sm font-medium text-gray-500">
            {filter === 'all' ? '投稿がありません' : `${STATUS_CONFIG[filter].label}の投稿がありません`}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">「投稿生成」から作成してください</p>
          <Button onClick={() => router.push('/dashboard/generate')} className="mt-4">
            投稿を生成する
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(post => (
            <DraftCard
              key={post.id}
              post={post}
              accounts={accounts}
              onPublish={handlePublish}
              onDelete={handleDelete}
              publishing={publishing === post.id}
              deleting={deleting === post.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
