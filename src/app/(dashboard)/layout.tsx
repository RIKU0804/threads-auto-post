'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  AppShell,
  NavLink,
  Stack,
  Text,
  Group,
  ThemeIcon,
  UnstyledButton,
  Box,
} from '@mantine/core'
import {
  PenLine,
  CalendarClock,
  Users,
  ScrollText,
  LayoutDashboard,
  LogOut,
  Zap,
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

const navItems = [
  { href: '/dashboard', label: 'ホーム', icon: LayoutDashboard },
  { href: '/dashboard/generate', label: '投稿生成', icon: PenLine },
  { href: '/dashboard/schedule', label: 'スケジュール', icon: CalendarClock },
  { href: '/dashboard/accounts', label: 'アカウント', icon: Users },
  { href: '/dashboard/logs', label: 'ログ', icon: ScrollText },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <AppShell
      navbar={{ width: 220, breakpoint: 'sm' }}
      style={{ '--app-shell-border-color': 'transparent' } as React.CSSProperties}
    >
      <AppShell.Navbar
        style={{
          background: '#0D0D16',
          borderRight: 'none',
          display: 'flex',
          flexDirection: 'column',
        }}
        p="md"
      >
        {/* ロゴ */}
        <Group gap={10} mb="xl" px={4}>
          <ThemeIcon
            size={36}
            radius="md"
            variant="gradient"
            gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
          >
            <Zap size={16} strokeWidth={2.5} />
          </ThemeIcon>
          <Box>
            <Text fw={700} size="sm" c="white" lh={1.2}>AutoPost</Text>
            <Text size="xs" c="dark.3" lh={1}>Threads</Text>
          </Box>
        </Group>

        {/* ナビゲーション */}
        <Stack gap={4} flex={1}>
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <NavLink
                key={href}
                component={Link}
                href={href}
                label={label}
                leftSection={
                  <Icon
                    size={16}
                    color={isActive ? 'var(--mantine-color-violet-4)' : 'rgba(255,255,255,0.35)'}
                  />
                }
                active={isActive}
                styles={{
                  root: {
                    borderRadius: 8,
                    color: isActive ? 'white' : 'rgba(255,255,255,0.4)',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 14,
                    '&[dataActive]': {
                      backgroundColor: 'rgba(255,255,255,0.08)',
                      color: 'white',
                    },
                    '&:hover': {
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      color: 'rgba(255,255,255,0.7)',
                    },
                  },
                }}
              />
            )
          })}
        </Stack>

        {/* フッター */}
        <Stack gap={4} mt="md">
          <UnstyledButton
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              borderRadius: 8,
              color: 'rgba(255,255,255,0.25)',
              fontSize: 14,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
          >
            <LogOut size={15} />
            ログアウト
          </UnstyledButton>
          <Text size="xs" c="dark.6" px={12}>v1.0.0</Text>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main style={{ background: '#F5F5FA', minHeight: '100vh' }}>
        {children}
      </AppShell.Main>
    </AppShell>
  )
}
