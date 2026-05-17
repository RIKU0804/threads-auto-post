'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText, Send, Trash2, User, ImageIcon, RefreshCw,
  CheckCircle, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cx } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { Post } from '@/types/database'

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

function DraftCard({
  post,
  onPublish,
  onDelete,
  publishing,
  deleting,
}: {
  post: Post
  onPublish: (id: string) => void
  onDelete: (id: string) => void
  publishing: boolean
  deleting: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [imgOpen, setImgOpen] = useState(false)

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
              <button onClick={() => setImgOpen(true)} className="block">
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
                  <img
                    src={post.image_url}
                    alt="投稿画像"
                    className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
                    onClick={e => e.stopPropagation()}
                  />
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
              <span className="truncate text-[11px] text-gray-400">#{post.theme}</span>
            )}
            <span className="ml-auto text-[11px] text-gray-400">
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
            <div className="ml-auto flex gap-2">
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

          {post.account_id && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-300">
              <User className="h-3 w-3" />
              アカウントあり
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
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'draft' | 'posted' | 'failed'>('all')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/posts')
    const data = await res.json() as Post[]
    setPosts(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handlePublish(postId: string) {
    setPublishing(postId)
    try {
      const res = await fetch(`/api/posts/${postId}/publish`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        toast.error(data.error ?? '投稿に失敗しました')
        return
      }
      toast.success('投稿しました')
      await load()
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

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)

  const counts = {
    all:    posts.length,
    draft:  posts.filter(p => p.status === 'draft').length,
    posted: posts.filter(p => p.status === 'posted').length,
    failed: posts.filter(p => p.status === 'failed').length,
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
            下書き一覧
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">生成した投稿の管理・確認・投稿</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
          更新
        </button>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1">
        {(['all', 'draft', 'posted', 'failed'] as const).map(f => (
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
            {f === 'all' ? 'すべて' : STATUS_CONFIG[f].label}
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
      ) : filtered.length === 0 ? (
        <Card className="py-14 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100">
            <FileText className="h-5 w-5 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">
            {filter === 'all' ? '投稿がありません' : `${STATUS_CONFIG[filter].label}の投稿がありません`}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">「投稿生成」から作成してください</p>
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
