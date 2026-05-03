'use client'

import { useEffect, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core'
import { Plus, User } from 'lucide-react'
import type { Account } from '@/types/database'

const PERSONAS = [
  { value: '転職ノウハウ発信者', label: '転職ノウハウ系' },
  { value: 'キャリアのプロ', label: 'プロ目線系' },
  { value: '高卒から転職成功した人', label: '体験談系' },
]

const TONES = [
  { value: 'friendly', label: 'フランク・親しみやすい' },
  { value: 'professional', label: '専門的・プロ目線' },
  { value: 'personal', label: '体験談・等身大' },
]

const labelStyle = {
  fontWeight: 700 as const,
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  color: 'var(--mantine-color-gray-6)',
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    persona: PERSONAS[0].value,
    tone: 'friendly',
    targetAudience: 'キャリアに不安のある高卒20代',
    postTopics: '転職ノウハウ、キャリア相談、仕事の悩み',
    accessToken: '',
    threadsUserId: '',
  })

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(setAccounts)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          postTopics: form.postTopics.split('、').map(s => s.trim()),
        }),
      })
      const newAccount = await res.json() as Account
      setAccounts(prev => [newAccount, ...prev])
      setShowForm(false)
    } catch {
      alert('作成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box p="xl" maw={720}>
      {/* ヘッダー */}
      <Group justify="space-between" align="flex-start" mb="xl">
        <Stack gap={4}>
          <Title order={2} fw={700} size="h2">アカウント</Title>
          <Text size="sm" c="dimmed">Threadsアカウントとペルソナを管理します</Text>
        </Stack>
        <Button
          leftSection={<Plus size={15} />}
          variant="gradient"
          gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
          radius="md"
          onClick={() => setShowForm(true)}
          style={{ boxShadow: '0 4px 16px rgba(124,58,237,0.2)' }}
        >
          アカウント追加
        </Button>
      </Group>

      {/* アカウント一覧 */}
      <Stack gap="md">
        {accounts.length === 0 ? (
          <Card withBorder radius="lg" shadow="sm" p={48} ta="center">
            <ThemeIcon size={48} radius="md" color="gray" variant="light" mx="auto" mb="md">
              <User size={20} />
            </ThemeIcon>
            <Text size="sm" fw={500} c="dimmed">アカウントがありません</Text>
            <Text size="xs" c="dimmed" mt={4}>「アカウント追加」から登録してください</Text>
          </Card>
        ) : (
          accounts.map(account => (
            <Card key={account.id} withBorder radius="lg" shadow="sm" p="lg">
              <Group justify="space-between" mb="md">
                <Group gap="md">
                  <ThemeIcon
                    size={44}
                    radius="md"
                    variant="gradient"
                    gradient={{ from: 'violet.1', to: 'indigo.1', deg: 135 }}
                  >
                    <User size={19} color="var(--mantine-color-violet-7)" />
                  </ThemeIcon>
                  <Box>
                    <Text fw={600} size="sm">{account.name}</Text>
                    <Text size="xs" c="dimmed">{account.persona}</Text>
                  </Box>
                </Group>
                <Badge
                  color={account.is_active ? 'teal' : 'gray'}
                  variant="light"
                  radius="xl"
                  size="sm"
                >
                  {account.is_active ? 'アクティブ' : '停止中'}
                </Badge>
              </Group>

              <Group
                gap="xl"
                pt="md"
                style={{ borderTop: '1px solid var(--mantine-color-gray-1)' }}
              >
                <Box>
                  <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ letterSpacing: '0.04em' }} mb={2}>対象</Text>
                  <Text size="xs">{account.target_audience}</Text>
                </Box>
                <Box>
                  <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ letterSpacing: '0.04em' }} mb={2}>文体</Text>
                  <Text size="xs">{TONES.find(t => t.value === account.tone)?.label}</Text>
                </Box>
              </Group>
            </Card>
          ))
        )}
      </Stack>

      {/* モーダル */}
      <Modal
        opened={showForm}
        onClose={() => setShowForm(false)}
        title={<Text fw={700}>新しいアカウントを追加</Text>}
        radius="lg"
        size="lg"
        overlayProps={{ blur: 4 }}
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <TextInput
              label="アカウント名"
              placeholder="例：転職ナビ公式"
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              styles={{ label: labelStyle }}
            />
            <Select
              label="ペルソナタイプ"
              data={PERSONAS.map(p => ({ value: p.value, label: p.label }))}
              value={form.persona}
              onChange={v => setForm(f => ({ ...f, persona: v ?? f.persona }))}
              styles={{ label: labelStyle }}
            />
            <Select
              label="文体トーン"
              data={TONES.map(t => ({ value: t.value, label: t.label }))}
              value={form.tone}
              onChange={v => setForm(f => ({ ...f, tone: v ?? f.tone }))}
              styles={{ label: labelStyle }}
            />
            <TextInput
              label="発信テーマ（読点区切り）"
              value={form.postTopics}
              onChange={e => setForm(f => ({ ...f, postTopics: e.target.value }))}
              styles={{ label: labelStyle }}
            />
            <PasswordInput
              label="Threads アクセストークン"
              placeholder="Meta Developer Console から取得"
              required
              value={form.accessToken}
              onChange={e => setForm(f => ({ ...f, accessToken: e.target.value }))}
              styles={{ label: labelStyle }}
            />
            <TextInput
              label="Threads ユーザーID"
              placeholder="例：12345678"
              required
              value={form.threadsUserId}
              onChange={e => setForm(f => ({ ...f, threadsUserId: e.target.value }))}
              styles={{ label: labelStyle }}
            />

            <Group grow mt="sm">
              <Button
                variant="default"
                radius="md"
                onClick={() => setShowForm(false)}
              >
                キャンセル
              </Button>
              <Button
                type="submit"
                loading={loading}
                variant="gradient"
                gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
                radius="md"
              >
                保存
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Box>
  )
}
