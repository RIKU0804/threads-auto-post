'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { Button } from '@/components/ui/Button'

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#00A3BF]">
          <Zap className="h-6 w-6 text-white" strokeWidth={2.5} />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">SNS AutoPost</h1>
          <p className="text-sm text-gray-500">マルチSNS自動投稿</p>
        </div>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-8"
        style={{
          border: '1px solid #e5edf5',
          boxShadow: 'rgba(50,50,93,0.08) 0px 8px 20px -8px, rgba(0,0,0,0.05) 0px 5px 10px -5px',
        }}
      >
        <h2 className="mb-6 text-xl font-bold text-gray-900">ログイン</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
              メールアドレス
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="admin@example.com"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-gray-500">
              パスワード
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 ring-1 ring-red-200">
              {error}
            </p>
          )}

          <Button
            type="submit"
            isLoading={loading}
            loadingText="ログイン中..."
            className="mt-2 w-full py-2.5"
          >
            ログイン
          </Button>
        </form>
      </div>
    </div>
  )
}
