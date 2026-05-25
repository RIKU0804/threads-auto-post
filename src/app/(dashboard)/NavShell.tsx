'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  PenLine,
  Users,
  ScrollText,
  LayoutDashboard,
  LogOut,
  Zap,
  FileText,
  Settings,
  MoreHorizontal,
  Video as VideoIcon,
} from 'lucide-react'
import { cx } from '@/lib/utils'
import { createClient } from '@/lib/supabase-browser'
import { ToastProvider } from '@/components/ui/Toast'
import { ConfirmProvider } from '@/components/ui/ConfirmDialog'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Vercel 上で表示する小バッジ（例: "ローカル"）。未設定なら表示しない */
  vercelBadge?: string
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'ホーム', icon: LayoutDashboard },
  { href: '/dashboard/generate', label: '文章画像投稿', icon: PenLine },
  { href: '/dashboard/videos', label: '動画投稿', icon: VideoIcon, vercelBadge: 'ローカル' },
  { href: '/dashboard/drafts', label: '下書き', icon: FileText },
  { href: '/dashboard/accounts', label: 'アカウント', icon: Users },
  { href: '/dashboard/logs', label: 'ログ', icon: ScrollText },
  { href: '/dashboard/settings', label: '設定', icon: Settings },
]

// モバイル底部ナビは過密回避のため主要4項目のみ。残りは「メニュー」シートに格納
const MOBILE_PRIMARY = ['/dashboard', '/dashboard/generate', '/dashboard/drafts', '/dashboard/logs']
const mobilePrimaryItems = navItems.filter(i => MOBILE_PRIMARY.includes(i.href))
const mobileMenuItems = navItems.filter(i => !MOBILE_PRIMARY.includes(i.href))

function isVercelClient(): boolean {
  if (process.env.NEXT_PUBLIC_VIDEO_RENDERING_ENABLED === '1') return false
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV
  return env === 'production' || env === 'preview'
}

export default function NavShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const showVercelBadges = isVercelClient()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href))

  const menuActive = mobileMenuItems.some(i => isActive(i.href))

  return (
    <ToastProvider>
    <ConfirmProvider>
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]">
      {/* Sidebar — desktop only */}
      <nav className="hidden md:flex w-60 shrink-0 flex-col bg-slate-800">
        {/* Logo */}
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#00A3BF]">
            <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">SNS AutoPost</p>
            <p className="text-[11px] text-slate-400 leading-tight">マルチSNS自動投稿</p>
          </div>
        </div>

        {/* Nav links */}
        <div className="flex flex-1 flex-col overflow-y-auto px-3 py-3 gap-0.5">
          {navItems.map(({ href, label, icon: Icon, vercelBadge }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                className={cx(
                  'flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'text-white bg-slate-700/60 border-l-2 border-[#00A3BF]'
                    : 'text-slate-300 hover:bg-slate-700/50 hover:text-white',
                )}
              >
                <Icon
                  className={cx('h-4 w-4 shrink-0', active ? 'text-[#00A3BF]' : 'text-slate-400')}
                />
                <span className="flex-1">{label}</span>
                {showVercelBadges && vercelBadge && (
                  <span
                    className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold leading-none text-amber-300"
                    title="この機能はローカル環境（npm run dev）でのみ動作します"
                  >
                    {vercelBadge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 px-3 py-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-sm px-4 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-white"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            ログアウト
          </button>
          <p className="mt-1 px-4 text-[11px] text-slate-600">v1.0.0</p>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        {/* Mobile header */}
        <div className="flex items-center justify-between border-b border-[#e5edf5] bg-white px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#00A3BF]">
              <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
            </div>
            <p className="text-sm font-bold text-slate-800">SNS AutoPost</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            ログアウト
          </button>
        </div>

        {children}
      </main>

      {/* Menu sheet — mobile only */}
      {menuOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-16 left-0 right-0 rounded-t-2xl bg-white p-2 pb-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
            {mobileMenuItems.map(({ href, label, icon: Icon, vercelBadge }) => {
              const active = isActive(href)
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={cx(
                    'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                    active ? 'bg-[#E9F7F9] text-[#006F83]' : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <Icon className={cx('h-4 w-4', active ? 'text-[#00A3BF]' : 'text-slate-400')} />
                  <span className="flex-1">{label}</span>
                  {showVercelBadges && vercelBadge && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold leading-none text-amber-700">
                      {vercelBadge}
                    </span>
                  )}
                </Link>
              )
            })}
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm text-slate-500 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4 text-slate-400" />
              ログアウト
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav — mobile only (主要4 + メニュー) */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-[#e5edf5] bg-white md:hidden">
        {mobilePrimaryItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                active ? 'text-[#00A3BF]' : 'text-slate-400',
              )}
            >
              <Icon className={cx('h-5 w-5', active ? 'text-[#00A3BF]' : 'text-slate-400')} />
              {label}
            </Link>
          )
        })}
        <button
          onClick={() => setMenuOpen(v => !v)}
          aria-label="その他のメニュー"
          className={cx(
            'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
            menuActive || menuOpen ? 'text-[#00A3BF]' : 'text-slate-400',
          )}
        >
          <MoreHorizontal className={cx('h-5 w-5', menuActive || menuOpen ? 'text-[#00A3BF]' : 'text-slate-400')} />
          メニュー
        </button>
      </nav>
    </div>
    </ConfirmProvider>
    </ToastProvider>
  )
}
