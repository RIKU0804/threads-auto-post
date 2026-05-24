'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Sparkles, Info } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { LocalOnlyBanner } from '@/components/video/LocalOnlyBanner'
import type { Video } from '@/types/database'

const MIN_THEME_LEN = 3
const MAX_THEME_LEN = 200
const DEFAULT_SCENE_COUNT = 6
const DEFAULT_DURATION = 45

// 副業・転職系の発信を想定した出だしの例
const THEME_EXAMPLES = [
  '副業で月10万円稼ぐ最短ロードマップ',
  '高卒20代が3年で年収500万になる方法',
  '転職で年収を200万上げた人がやっていた習慣',
  '人見知りでも結果を出せる営業の話し方',
  '20代のうちにやめた方がいい仕事の3つの特徴',
]

function SectionLabel({
  children,
  hint,
}: {
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {children}
      </p>
      {hint && (
        <span className="relative inline-flex group">
          <Info className="h-3 w-3 text-gray-400" />
          <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] font-normal normal-case text-white group-hover:block">
            {hint}
          </span>
        </span>
      )}
    </div>
  )
}

export default function NewVideoPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [theme, setTheme] = useState('')
  const [title, setTitle] = useState('')
  const [sceneCount, setSceneCount] = useState(DEFAULT_SCENE_COUNT)
  const [targetDurationSec, setTargetDurationSec] = useState(DEFAULT_DURATION)
  const [loading, setLoading] = useState(false)

  // ?theme=... があればプリフィル（複製機能で利用）
  useEffect(() => {
    const t = searchParams.get('theme')
    if (t) {
      setTheme(t.slice(0, MAX_THEME_LEN))
    }
  }, [searchParams])

  const themeError = theme.trim().length > 0 && theme.trim().length < MIN_THEME_LEN
  const canSubmit =
    theme.trim().length >= MIN_THEME_LEN &&
    theme.trim().length <= MAX_THEME_LEN &&
    !loading

  // 1コマあたりの秒数を表示（ユーザーが直感的にバランスを取れるように）
  const secPerScene = (targetDurationSec / sceneCount).toFixed(1)

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
      const data = (await res.json()) as Video & { error?: string; code?: string }
      if (!res.ok || data.error) {
        if (data.code === 'RATE_LIMITED') {
          toast.error('1時間に5本までです。少し時間を空けて再度お試しください')
        } else {
          toast.error(data.error ?? '動画の作成に失敗しました')
        }
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
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
          テーマを入力すると AI が台本・画像・音声を生成して 1 本の動画にまとめます（約3分）
        </p>
      </div>

      <LocalOnlyBanner variant="block" />

      <Card className="space-y-5">
        {/* テーマ */}
        <div>
          <SectionLabel hint="動画で扱う1つの話題を1文で書いてください">
            テーマ (必須)
          </SectionLabel>
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
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
          {/* テーマのクイック例 */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {THEME_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setTheme(ex)}
                disabled={loading}
                className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-600 hover:border-[#00A3BF] hover:bg-[#00A3BF]/5 hover:text-[#006F83]"
              >
                {ex}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            🤖 生成された台本は完成後に1コマずつ書き換えられます。「とりあえず AI に書かせて気に入らない部分だけ直す」が基本ワークフローです。
          </p>
        </div>

        {/* タイトル */}
        <div>
          <SectionLabel hint="未入力ならテーマから自動で作ります">
            タイトル (任意)
          </SectionLabel>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="未入力ならテーマから自動生成"
            maxLength={200}
            aria-label="タイトル"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-[#00A3BF] focus:ring-2 focus:ring-[#00A3BF]/20"
          />
        </div>

        {/* シーン数 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel hint="動画を区切る画面の枚数。6枚で約45秒が標準">
              シーン数
            </SectionLabel>
            <span className="text-xs font-semibold text-[#006F83]">{sceneCount}</span>
          </div>
          <input
            type="range"
            min={3}
            max={10}
            step={1}
            value={sceneCount}
            onChange={(e) => setSceneCount(Number(e.target.value))}
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
            <SectionLabel hint="完成動画のおおよその長さ">
              目安尺
            </SectionLabel>
            <span className="text-xs font-semibold text-[#006F83]">{targetDurationSec} 秒</span>
          </div>
          <input
            type="range"
            min={15}
            max={90}
            step={5}
            value={targetDurationSec}
            onChange={(e) => setTargetDurationSec(Number(e.target.value))}
            aria-label="目安尺 (秒)"
            className="w-full accent-[#00A3BF]"
          />
          <div className="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>15 秒</span>
            <span>90 秒</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">1シーンあたり約 {secPerScene} 秒</p>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-[11px] text-amber-800">
          ⚠️ 動画生成は外部 AI コストが大きいため <strong>1時間あたり5本まで</strong> に制限しています
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
