'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import type { Video } from '@/types/database'

const MIN_THEME_LEN = 3
const MAX_THEME_LEN = 200
const DEFAULT_SCENE_COUNT = 6
const DEFAULT_DURATION = 45

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </p>
  )
}

export default function NewVideoPage() {
  const router = useRouter()
  const toast = useToast()
  const [theme, setTheme] = useState('')
  const [title, setTitle] = useState('')
  const [sceneCount, setSceneCount] = useState(DEFAULT_SCENE_COUNT)
  const [targetDurationSec, setTargetDurationSec] = useState(DEFAULT_DURATION)
  const [loading, setLoading] = useState(false)

  const themeError = theme.trim().length > 0 && theme.trim().length < MIN_THEME_LEN
  const canSubmit = theme.trim().length >= MIN_THEME_LEN && theme.trim().length <= MAX_THEME_LEN && !loading

  async function handleSubmit() {
    if (!canSubmit) return
    setLoading(true)
    try {
      const res = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: theme.trim(),
          title: title.trim() || undefined,
          sceneCount,
          targetDurationSec,
        }),
      })
      const data = await res.json() as Video & { error?: string }
      if (!res.ok || data.error) {
        toast.error(data.error ?? '動画の作成に失敗しました')
        return
      }
      router.push(`/dashboard/videos/${data.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '動画の作成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <Link
          href="/dashboard/videos"
          className="mb-2 inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"
        >
          <ChevronLeft className="h-4 w-4" />
          動画一覧に戻る
        </Link>
        <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
          新規動画作成
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          テーマを入力すると AI が台本・画像・音声を生成して 1 本の動画にまとめます
        </p>
      </div>

      <Card className="space-y-5">
        {/* テーマ */}
        <div>
          <SectionLabel>テーマ (必須)</SectionLabel>
          <Textarea
            value={theme}
            onChange={e => setTheme(e.target.value)}
            rows={3}
            placeholder="例：副業で月10万円稼ぐ最短ロードマップ"
            maxLength={MAX_THEME_LEN}
            hasError={themeError}
            aria-label="テーマ"
            aria-invalid={themeError}
            aria-describedby="theme-help"
          />
          <div id="theme-help" className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
            <span>{themeError ? `${MIN_THEME_LEN} 文字以上で入力してください` : `${MIN_THEME_LEN}〜${MAX_THEME_LEN} 文字`}</span>
            <span>{theme.length} / {MAX_THEME_LEN}</span>
          </div>
        </div>

        {/* タイトル */}
        <div>
          <SectionLabel>タイトル (任意)</SectionLabel>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="未入力ならテーマから自動生成"
            maxLength={200}
            aria-label="タイトル"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
          />
        </div>

        {/* シーン数 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>シーン数</SectionLabel>
            <span className="text-xs font-semibold text-[#006F83]">{sceneCount}</span>
          </div>
          <input
            type="range"
            min={3}
            max={10}
            step={1}
            value={sceneCount}
            onChange={e => setSceneCount(Number(e.target.value))}
            aria-label="シーン数"
            className="w-full accent-[#00A3BF]"
          />
          <div className="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>3</span>
            <span>10</span>
          </div>
        </div>

        {/* 目安尺 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>目安尺</SectionLabel>
            <span className="text-xs font-semibold text-[#006F83]">{targetDurationSec} 秒</span>
          </div>
          <input
            type="range"
            min={15}
            max={90}
            step={5}
            value={targetDurationSec}
            onChange={e => setTargetDurationSec(Number(e.target.value))}
            aria-label="目安尺 (秒)"
            className="w-full accent-[#00A3BF]"
          />
          <div className="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>15 秒</span>
            <span>90 秒</span>
          </div>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          isLoading={loading}
          loadingText="作成中..."
          className="w-full gap-2 py-2.5"
        >
          <Sparkles className="h-4 w-4" />
          動画を生成する
        </Button>
      </Card>
    </div>
  )
}
