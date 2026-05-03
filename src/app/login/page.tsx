'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Box,
  Button,
  Card,
  Center,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Alert,
} from '@mantine/core'
import { Zap, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })

    if (err) {
      setError('メールアドレスまたはパスワードが正しくありません')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: '#0D0D16',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 背景グロー */}
      <Box
        style={{
          position: 'absolute',
          top: '25%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 400,
          height: 400,
          background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <Box w="100%" maw={360} style={{ position: 'relative' }}>
        {/* ロゴ */}
        <Center mb="xl">
          <Stack align="center" gap={8}>
            <ThemeIcon
              size={56}
              radius={16}
              variant="gradient"
              gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
              style={{ boxShadow: '0 8px 32px rgba(124,58,237,0.35)' }}
            >
              <Zap size={24} strokeWidth={2.5} />
            </ThemeIcon>
            <Title order={2} c="white" fw={700} size="xl">AutoPost</Title>
            <Text size="sm" c="dark.3">Threads 自動投稿</Text>
          </Stack>
        </Center>

        {/* フォームカード */}
        <Card
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(12px)',
          }}
          radius="lg"
          p="xl"
        >
          <Text fw={600} c="white" mb="lg">ログイン</Text>

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label="メールアドレス"
                placeholder="admin@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                type="email"
                styles={{
                  label: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
                  input: {
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'white',
                    '&::placeholder': { color: 'rgba(255,255,255,0.2)' },
                    '&:focus': { borderColor: 'var(--mantine-color-violet-5)' },
                  },
                }}
              />

              <PasswordInput
                label="パスワード"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                styles={{
                  label: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
                  input: {
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'white',
                    '&:focus': { borderColor: 'var(--mantine-color-violet-5)' },
                  },
                  innerInput: { color: 'white' },
                }}
              />

              {error && (
                <Alert
                  icon={<AlertCircle size={16} />}
                  color="red"
                  variant="light"
                  radius="md"
                >
                  {error}
                </Alert>
              )}

              <Button
                type="submit"
                loading={loading}
                fullWidth
                mt={4}
                variant="gradient"
                gradient={{ from: 'violet', to: 'indigo', deg: 135 }}
                size="md"
                radius="md"
                style={{ boxShadow: '0 4px 16px rgba(124,58,237,0.3)' }}
              >
                ログイン
              </Button>
            </Stack>
          </form>
        </Card>
      </Box>
    </Box>
  )
}
