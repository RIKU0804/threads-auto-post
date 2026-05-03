'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Box,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  ThemeIcon,
  Badge,
  Anchor,
} from '@mantine/core'
import { PenLine, CheckCircle, Clock, AlertCircle, ArrowRight, FileText } from 'lucide-react'
import type { Post } from '@/types/database'

interface Stats {
  draft: number
  scheduled: number
  posted: number
  failed: number
}

const statCards = [
  { key: 'draft' as const, label: '下書き', icon: PenLine, color: 'gray' as const, iconColor: '#9ca3af' },
  { key: 'scheduled' as const, label: '予約済み', icon: Clock, color: 'blue' as const, iconColor: '#3b82f6' },
  { key: 'posted' as const, label: '投稿済み', icon: CheckCircle, color: 'teal' as const, iconColor: '#10b981' },
  { key: 'failed' as const, label: 'エラー', icon: AlertCircle, color: 'red' as const, iconColor: '#ef4444' },
]

const statusBadge: Record<string, { label: string; color: string }> = {
  draft: { label: '下書き', color: 'gray' },
  scheduled: { label: '予約済み', color: 'blue' },
  posted: { label: '投稿済み', color: 'teal' },
  failed: { label: 'エラー', color: 'red' },
}

export default function DashboardPage() {
  const [recentPosts, setRecentPosts] = useState<Post[]>([])
  const [stats, setStats] = useState<Stats>({ draft: 0, scheduled: 0, posted: 0, failed: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/posts')
      .then(r => r.json())
      .then((posts: Post[]) => {
        setRecentPosts(posts.slice(0, 5))
        setStats({
          draft: posts.filter(p => p.status === 'draft').length,
          scheduled: posts.filter(p => p.status === 'scheduled').length,
          posted: posts.filter(p => p.status === 'posted').length,
          failed: posts.filter(p => p.status === 'failed').length,
        })
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <Box p="xl" maw={900}>
      {/* ヘッダー */}
      <Stack gap={4} mb="xl">
        <Title order={2} fw={700} size="h2">ダッシュボード</Title>
        <Text size="sm" c="dimmed">Threads自動投稿の管理センター</Text>
      </Stack>

      {/* 統計カード */}
      <Grid mb="xl" gap="md">
        {statCards.map(({ key, label, icon: Icon, color, iconColor }) => (
          <Grid.Col key={key} span={{ base: 6, sm: 3 }}>
            <Card withBorder radius="lg" p="lg" shadow="sm">
              <ThemeIcon
                size={40}
                radius="md"
                color={color}
                variant="light"
                mb="md"
              >
                <Icon size={18} color={iconColor} />
              </ThemeIcon>
              <Text size="xl" fw={800} lh={1} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {stats[key]}
              </Text>
              <Text size="xs" c="dimmed" mt={4} fw={500}>{label}</Text>
            </Card>
          </Grid.Col>
        ))}
      </Grid>

      {/* クイックアクション */}
      <Button
        component={Link}
        href="/dashboard/generate"
        variant="gradient"
        gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
        size="md"
        radius="md"
        leftSection={<PenLine size={16} />}
        rightSection={<ArrowRight size={14} />}
        mb="xl"
        style={{ boxShadow: '0 4px 16px rgba(124,58,237,0.2)' }}
      >
        新しい投稿を生成する
      </Button>

      {/* 直近の投稿 */}
      <Card withBorder radius="lg" shadow="sm" p={0} style={{ overflow: 'hidden' }}>
        <Group justify="space-between" px="lg" py="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Text fw={600} size="sm">直近の投稿</Text>
          <Anchor
            component={Link}
            href="/dashboard/schedule"
            size="xs"
            c="violet"
            fw={500}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            すべて見る <ArrowRight size={12} />
          </Anchor>
        </Group>

        {loading ? (
          <Box p="xl" style={{ display: 'flex', justifyContent: 'center' }}>
            <Loader size="sm" color="violet" />
          </Box>
        ) : recentPosts.length === 0 ? (
          <Stack align="center" gap={8} p={48}>
            <ThemeIcon size={48} radius="md" color="gray" variant="light">
              <FileText size={20} />
            </ThemeIcon>
            <Text size="sm" fw={500} c="dimmed">まだ投稿がありません</Text>
            <Text size="xs" c="dimmed">「投稿生成」から始めましょう</Text>
          </Stack>
        ) : (
          <Stack gap={0}>
            {recentPosts.map((post, i) => {
              const badge = statusBadge[post.status] ?? { label: post.status, color: 'gray' }
              return (
                <Group
                  key={post.id}
                  justify="space-between"
                  px="lg"
                  py="md"
                  gap="md"
                  style={{
                    borderBottom: i < recentPosts.length - 1 ? '1px solid var(--mantine-color-gray-1)' : 'none',
                  }}
                >
                  <Text size="sm" c="dark" lineClamp={1} style={{ flex: 1 }}>
                    {post.text_content ?? '(テキストなし)'}
                  </Text>
                  <Badge color={badge.color} variant="light" size="sm" radius="xl">
                    {badge.label}
                  </Badge>
                </Group>
              )
            })}
          </Stack>
        )}
      </Card>
    </Box>
  )
}
