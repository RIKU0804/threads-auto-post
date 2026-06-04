'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PenLine, CheckCircle, AlertCircle, FileText, ArrowRight, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { Account, Post } from '@/types/database'

interface Stats {
  draft: number
  posted: number
  failed: number
}

const statCards = [
  { key: 'draft' as const,     label: '下書き',   color: 'text-slate-700',  icon: PenLine },
  { key: 'posted' as const,    label: '投稿済み',  color: 'text-green-700',  icon: CheckCircle },
  { key: 'failed' as const,    label: 'エラー',    color: 'text-red-600',    icon: AlertCircle },
]

const statusBadge: Record<string, { label: string; cls: string }> = {
  draft:      { label: '下書き',   cls: 'bg-gray-100 text-gray-600' },
  publishing: { label: '投稿中',   cls: 'bg-blue-50 text-blue-600' },
  posted:     { label: '投稿済み', cls: 'bg-green-50 text-green-700' },
  failed:     { label: 'エラー',   cls: 'bg-red-50 text-red-600' },
}

export default function DashboardPage() {
  const [recentPosts, setRecentPosts] = useState<Post[]>([])
  const [stats, setStats] = useState<Stats>({ draft: 0, posted: 0, failed: 0 })
  const [accountCount, setAccountCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/posts/stats').then(r => r.json()) as Promise<Stats>,
      fetch('/api/posts?limit=5').then(r => r.json()) as Promise<Post[]>,
      fetch('/api/accounts').then(r => r.ok ? r.json() : []) as Promise<Account[] | { accounts?: Account[] }>,
    ]).then(([s, posts, accountsRaw]) => {
      setStats(s)
      setRecentPosts(Array.isArray(posts) ? posts : [])
      // /api/accounts は実装によって配列を直接返すか、{ accounts: [] } 形式かが揺れる
      const accounts = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.accounts ?? [])
      setAccountCount(accounts.length)
    }).finally(() => setLoading(false))
  }, [])

  // 初回ユーザー判定: アカウント0件
  // accountCount が null = まだ取得中なのでオンボーディングは表示しない
  const showOnboarding = accountCount === 0

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
          ダッシュボード
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">SNS自動投稿の管理センター（Threads / Instagram / X）</p>
      </div>

      {/* 初回ユーザー向けオンボーディング: アカウントが0件のときに最上段表示 */}
      {showOnboarding && (
        <div className="mb-6 rounded-lg border border-[#00A3BF]/30 bg-[#E9F7F9] p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00A3BF]">
              <UserPlus className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-[#003741]">
                まずは投稿先アカウントを連携しましょう
              </h2>
              <p className="mt-1 text-xs text-[#006F83]">
                Threads / Instagram / X / TikTok / YouTube の各プラットフォームに自動投稿するには、
                <strong>「アカウント」ページから接続情報を登録</strong> する必要があります。連携後すぐに投稿生成・公開を始められます。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/dashboard/accounts" className="flex items-center gap-1.5">
                    <UserPlus className="h-4 w-4" />
                    アカウントを連携する
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="border border-[#00A3BF]/30 text-[#006F83]">
                  <Link href="/dashboard/settings">
                    先に API キーを登録する
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {statCards.map(({ key, label, color, icon: Icon }) => (
          <div
            key={key}
            className="rounded-lg bg-white p-4"
            style={{
              border: '1px solid #e5edf5',
              boxShadow: 'rgba(50,50,93,0.08) 0px 8px 20px -8px, rgba(0,0,0,0.05) 0px 5px 10px -5px',
            }}
          >
            <p className="mb-1 text-xs text-gray-500">{label}</p>
            <p className={`text-3xl font-bold tabular-nums ${color}`}>
              {loading ? '—' : stats[key]}
            </p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <Button asChild className="mb-8">
        <Link href="/dashboard/generate" className="flex items-center gap-2">
          <PenLine className="h-4 w-4" />
          新しい投稿を生成する
          <ArrowRight className="h-3.5 w-3.5 opacity-70" />
        </Link>
      </Button>

      {/* Recent posts */}
      <div
        className="overflow-hidden rounded-lg bg-white"
        style={{
          border: '1px solid #e5edf5',
          boxShadow: 'rgba(50,50,93,0.08) 0px 8px 20px -8px, rgba(0,0,0,0.05) 0px 5px 10px -5px',
        }}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold" style={{ color: '#061b31' }}>直近の投稿</h2>
          <Link
            href="/dashboard/logs"
            className="flex items-center gap-1 text-xs font-medium text-[#006F83] hover:underline"
          >
            すべて見る <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-[#00A3BF]" />
          </div>
        ) : recentPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100">
              <FileText className="h-5 w-5 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-500">まだ投稿がありません</p>
            <p className="mt-0.5 text-xs text-gray-500">「投稿生成」から始めましょう</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {recentPosts.map(post => {
              const b = statusBadge[post.status] ?? { label: post.status, cls: 'bg-gray-100 text-gray-600' }
              return (
                <li key={post.id} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  <p className="flex-1 truncate text-sm text-gray-700">
                    {post.text_content ?? '(テキストなし)'}
                  </p>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${b.cls}`}>
                    {b.label}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
