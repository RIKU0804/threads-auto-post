'use client'

import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Card,
  Group,
  Image,
  Loader,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  UnstyledButton,
  ThemeIcon,
  Badge,
} from '@mantine/core'
import { Sparkles, ImageIcon, Send, Save, RefreshCw, ChevronLeft, CheckCircle } from 'lucide-react'
import type { Account, Post } from '@/types/database'

type Step = 'input' | 'preview' | 'done'
type PostType = 'buzz' | 'empathy' | 'numbers' | 'story' | 'question'

const POST_TYPES: { value: PostType; label: string; desc: string; emoji: string }[] = [
  { value: 'buzz', label: 'バズ型', desc: '逆説・驚き', emoji: '⚡' },
  { value: 'empathy', label: '共感型', desc: '心の声代弁', emoji: '🤝' },
  { value: 'numbers', label: '数字型', desc: '具体数字', emoji: '📊' },
  { value: 'story', label: 'ストーリー型', desc: '起承転結', emoji: '📖' },
  { value: 'question', label: '問いかけ型', desc: 'コメント誘導', emoji: '💬' },
]

export default function GeneratePage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [theme, setTheme] = useState('')
  const [postType, setPostType] = useState<PostType | null>(null)
  const [step, setStep] = useState<Step>('input')
  const [loading, setLoading] = useState(false)
  const [generatedText, setGeneratedText] = useState('')
  const [generatedSummary, setGeneratedSummary] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageLoading, setImageLoading] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [savedPost, setSavedPost] = useState<Post | null>(null)

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((data: Account[]) => {
        setAccounts(data)
        if (data.length > 0) setSelectedAccount(data[0].id)
      })
  }, [])

  async function handleGenerate() {
    if (!selectedAccount || !theme.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/generate/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccount, theme, postType: postType || undefined }),
      })
      const data = await res.json() as { content: string; summary: string }
      setGeneratedText(data.content)
      setGeneratedSummary(data.summary ?? '')
      setStep('preview')
    } catch {
      alert('生成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerateImage() {
    if (!generatedText) return
    setImageLoading(true)
    try {
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postContent: generatedText, style: 'diagram' }),
      })
      const data = await res.json() as { imageUrl: string }
      setImageUrl(data.imageUrl)
    } catch {
      alert('画像生成に失敗しました')
    } finally {
      setImageLoading(false)
    }
  }

  async function handleSave(publish = false) {
    setLoading(true)
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount,
          textContent: generatedText,
          imageUrl: imageUrl || undefined,
          theme,
          scheduledAt: scheduledAt || undefined,
          summary: generatedSummary || undefined,
        }),
      })
      const post = await res.json() as Post
      setSavedPost(post)
      if (publish) {
        await fetch(`/api/posts/${post.id}/publish`, { method: 'POST' })
      }
      setStep('done')
    } catch {
      alert('保存に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setStep('input')
    setTheme('')
    setPostType(null)
    setGeneratedText('')
    setGeneratedSummary('')
    setImageUrl('')
    setScheduledAt('')
    setSavedPost(null)
  }

  if (step === 'done') {
    return (
      <Box p="xl" maw={640}>
        <Card withBorder radius="lg" shadow="sm" p="xl" ta="center">
          <ThemeIcon size={56} radius="md" color="teal" variant="light" mx="auto" mb="md">
            <CheckCircle size={24} />
          </ThemeIcon>
          <Title order={3} fw={700}>
            {savedPost?.status === 'posted' ? '投稿しました！' : '保存しました！'}
          </Title>
          <Text size="sm" c="dimmed" mt={6}>
            {savedPost?.status === 'scheduled'
              ? `${scheduledAt} に予約投稿します`
              : savedPost?.status === 'posted'
              ? 'Threadsに投稿されました'
              : '下書きとして保存されました'}
          </Text>
          <Button
            mt="xl"
            variant="gradient"
            gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
            leftSection={<Sparkles size={15} />}
            onClick={handleReset}
            radius="md"
          >
            新しい投稿を生成する
          </Button>
        </Card>
      </Box>
    )
  }

  return (
    <Box p="xl" maw={640}>
      {/* ヘッダー */}
      <Group justify="space-between" align="flex-start" mb="xl">
        <Stack gap={4}>
          <Title order={2} fw={700} size="h2">投稿生成</Title>
          <Text size="sm" c="dimmed">AIがあなたのテーマを Threads 投稿に変換します</Text>
        </Stack>
        {step === 'preview' && (
          <UnstyledButton
            onClick={() => setStep('input')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--mantine-color-dimmed)', fontSize: 14 }}
          >
            <ChevronLeft size={16} />
            戻る
          </UnstyledButton>
        )}
      </Group>

      {/* ステップインジケーター */}
      <Group gap="xs" mb="xl">
        {(['input', 'preview'] as const).map((s, i) => (
          <Group key={s} gap="xs">
            <Box
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                background: step === s
                  ? 'linear-gradient(135deg, var(--mantine-color-violet-6), var(--mantine-color-indigo-6))'
                  : i < ['input', 'preview'].indexOf(step)
                  ? 'var(--mantine-color-teal-6)'
                  : 'var(--mantine-color-gray-2)',
                color: step === s || i < ['input', 'preview'].indexOf(step) ? 'white' : 'var(--mantine-color-gray-5)',
              }}
            >
              {i < ['input', 'preview'].indexOf(step) ? '✓' : i + 1}
            </Box>
            <Text size="xs" fw={step === s ? 600 : 400} c={step === s ? 'dark' : 'dimmed'}>
              {s === 'input' ? '入力' : 'プレビュー'}
            </Text>
            {i < 1 && <Box style={{ width: 32, height: 1, background: i < ['input', 'preview'].indexOf(step) ? 'var(--mantine-color-teal-4)' : 'var(--mantine-color-gray-3)' }} />}
          </Group>
        ))}
      </Group>

      {/* Step 1: 入力 */}
      {step === 'input' && (
        <Stack gap="lg">
          <Card withBorder radius="lg" shadow="sm" p="lg">
            <Stack gap="md">
              <Select
                label="アカウント"
                data={accounts.map(a => ({ value: a.id, label: a.name }))}
                value={selectedAccount}
                onChange={setSelectedAccount}
                placeholder="アカウントを先に登録してください"
                styles={{ label: { fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--mantine-color-gray-6)' } }}
              />
              <TextInput
                label="投稿テーマ"
                placeholder="例：高卒でも転職できる3つの理由"
                value={theme}
                onChange={e => setTheme(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                styles={{ label: { fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--mantine-color-gray-6)' } }}
              />
            </Stack>
          </Card>

          {/* 投稿の型 */}
          <Box>
            <Group justify="space-between" mb="sm">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>投稿の型</Text>
              <Text size="xs" c="dimmed">任意</Text>
            </Group>
            <Group gap="xs">
              {POST_TYPES.map(t => (
                <UnstyledButton
                  key={t.value}
                  onClick={() => setPostType(postType === t.value ? null : t.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: '12px 8px',
                    borderRadius: 10,
                    border: postType === t.value
                      ? '1.5px solid var(--mantine-color-violet-5)'
                      : '1.5px solid var(--mantine-color-gray-2)',
                    background: postType === t.value
                      ? 'var(--mantine-color-violet-0)'
                      : 'white',
                    transition: 'all 0.15s',
                  }}
                >
                  <Text size="xl" lh={1}>{t.emoji}</Text>
                  <Text
                    size="xs"
                    fw={600}
                    c={postType === t.value ? 'violet' : 'dark'}
                    ta="center"
                    lh={1.2}
                  >
                    {t.label}
                  </Text>
                  <Text size="xs" c="dimmed" ta="center" lh={1.2}>{t.desc}</Text>
                </UnstyledButton>
              ))}
            </Group>
          </Box>

          <Button
            onClick={handleGenerate}
            disabled={!selectedAccount || !theme.trim()}
            loading={loading}
            variant="gradient"
            gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
            size="lg"
            radius="md"
            leftSection={<Sparkles size={17} />}
            fullWidth
            style={{ boxShadow: '0 4px 20px rgba(124,58,237,0.2)' }}
          >
            AI生成する
          </Button>
        </Stack>
      )}

      {/* Step 2: プレビュー */}
      {step === 'preview' && (
        <Stack gap="md">
          {/* 投稿文 */}
          <Card withBorder radius="lg" shadow="sm" p="lg">
            <Group justify="space-between" mb="sm">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>投稿文</Text>
              <Button
                variant="subtle"
                color="violet"
                size="xs"
                leftSection={<RefreshCw size={12} className={loading ? 'animate-spin' : ''} />}
                onClick={handleGenerate}
                disabled={loading}
                px={8}
              >
                再生成
              </Button>
            </Group>
            <Textarea
              value={generatedText}
              onChange={e => setGeneratedText(e.target.value)}
              autosize
              minRows={8}
              maxRows={15}
              styles={{
                input: {
                  border: 'none',
                  padding: 0,
                  fontSize: 14,
                  lineHeight: 1.8,
                  resize: 'none',
                  background: 'transparent',
                },
              }}
            />
            <Group justify="space-between" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-1)' }}>
              <Text size="xs" c="dimmed">{generatedText.length} 文字</Text>
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: generatedText.length > 450
                    ? 'var(--mantine-color-red-5)'
                    : generatedText.length > 350
                    ? 'var(--mantine-color-yellow-5)'
                    : 'var(--mantine-color-teal-5)',
                }}
              />
            </Group>
          </Card>

          {/* 図解画像 */}
          <Card withBorder radius="lg" shadow="sm" p="lg">
            <Group justify="space-between" mb="sm">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>図解画像</Text>
              <Button
                variant="subtle"
                color="violet"
                size="xs"
                leftSection={imageLoading ? <Loader size={12} color="violet" /> : <ImageIcon size={12} />}
                onClick={handleGenerateImage}
                disabled={imageLoading}
                px={8}
              >
                {imageLoading ? '生成中...' : imageUrl ? '再生成' : '図解を生成'}
              </Button>
            </Group>
            {imageUrl ? (
              <Image src={imageUrl} alt="生成された図解" radius="md" />
            ) : (
              <Box
                style={{
                  height: 140,
                  border: '2px dashed var(--mantine-color-gray-2)',
                  borderRadius: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <ImageIcon size={20} color="var(--mantine-color-gray-4)" />
                <Text size="xs" c="dimmed">「図解を生成」ボタンで追加</Text>
              </Box>
            )}
          </Card>

          {/* 予約投稿 */}
          <Card withBorder radius="lg" shadow="sm" p="lg">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }} mb="sm">
              予約投稿
            </Text>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              style={{
                border: '1px solid var(--mantine-color-gray-3)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 14,
                color: 'var(--mantine-color-dark-6)',
                background: 'var(--mantine-color-gray-0)',
                outline: 'none',
              }}
            />
            {!scheduledAt && (
              <Text size="xs" c="dimmed" mt={6}>空白の場合は下書き保存になります</Text>
            )}
          </Card>

          {/* アクションボタン */}
          <Group grow>
            <Button
              variant="default"
              size="md"
              radius="md"
              leftSection={<Save size={15} />}
              onClick={() => handleSave(false)}
              disabled={loading}
            >
              {scheduledAt ? '予約保存' : '下書き保存'}
            </Button>
            <Button
              variant="gradient"
              gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
              size="md"
              radius="md"
              leftSection={loading ? <Loader size={14} color="white" /> : <Send size={15} />}
              onClick={() => handleSave(true)}
              disabled={loading || !!scheduledAt}
              style={{ boxShadow: '0 4px 16px rgba(124,58,237,0.2)' }}
            >
              今すぐ投稿
            </Button>
          </Group>
        </Stack>
      )}
    </Box>
  )
}
