import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'

/**
 * 「テーマを提案」機能の共通フック。
 * generate の threads / instagram / x で完全に同一だったロジックを集約。
 */
export function useThemeSuggestions(selectedAccount: string) {
  const toast = useToast()
  const [themeSuggestions, setThemeSuggestions] = useState<string[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)

  async function suggestThemes() {
    setSuggestLoading(true)
    setThemeSuggestions([])
    try {
      const res = await fetch('/api/generate/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccount || undefined }),
      })
      const data = await res.json() as { themes?: string[]; error?: string }
      if (data.error) throw new Error(data.error)
      setThemeSuggestions(data.themes ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'テーマ生成に失敗しました')
    } finally {
      setSuggestLoading(false)
    }
  }

  return { themeSuggestions, setThemeSuggestions, suggestLoading, suggestThemes }
}
