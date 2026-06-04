'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Sparkles, Info, Loader2, RefreshCw, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { SelectNative } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { LocalOnlyBanner } from '@/components/video/LocalOnlyBanner'
import { useHeygenList } from '@/lib/hooks/use-heygen-list'
import { useThemeSuggestions } from '@/lib/hooks/use-theme-suggestions'
import { VOICE_PRESETS, DEFAULT_VOICE_ID } from '@/lib/video/voice-presets'
import type { Video, GenerationMode, VoiceSource } from '@/types/database'

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

interface HeygenAvatar {
  avatar_id: string
  avatar_name: string
  gender?: string
  preview_image_url?: string
  preview_video_url?: string
}

interface HeygenVoice {
  voice_id: string
  name: string
  language?: string
  gender?: string
  preview_audio?: string
}

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
          <Info className="h-3 w-3 text-gray-500" />
          <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] font-normal normal-case text-white group-hover:block">
            {hint}
          </span>
        </span>
      )}
    </div>
  )
}

// useSearchParams() を使うため Suspense でラップして CSR bailout を許容する
export default function NewVideoPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">読み込み中...</div>}>
      <NewVideoPageInner />
    </Suspense>
  )
}

function NewVideoPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [theme, setTheme] = useState('')
  const [title, setTitle] = useState('')
  const [sceneCount, setSceneCount] = useState(DEFAULT_SCENE_COUNT)
  const [targetDurationSec, setTargetDurationSec] = useState(DEFAULT_DURATION)
  const [loading, setLoading] = useState(false)

  // 動画生成モード
  const [mode, setMode] = useState<GenerationMode>('remotion')
  const [voiceSource, setVoiceSource] = useState<VoiceSource>('elevenlabs')
  const [heygenAvatarId, setHeygenAvatarId] = useState('')
  const [heygenVoiceId, setHeygenVoiceId] = useState('')
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState<string>(DEFAULT_VOICE_ID)

  // AI テーマ提案 (動画作成にはアカウント選択が無いので '' = デモペルソナで提案)。
  // API 側で過去の投稿・動画タイトルを避けて生成する。
  const { themeSuggestions, suggestLoading, suggestThemes } = useThemeSuggestions('')

  const { state: avatarsState, refetch: refetchAvatars } = useHeygenList<HeygenAvatar>({
    url: '/api/heygen/avatars',
    dataKey: 'avatars',
    enabled: mode === 'heygen_avatar',
    defaultErrorMessage: 'アバター一覧の取得に失敗しました',
  })

  const { state: voicesState, refetch: refetchVoices } = useHeygenList<HeygenVoice>({
    url: '/api/heygen/voices',
    dataKey: 'voices',
    enabled: mode === 'heygen_avatar' && voiceSource === 'heygen',
    defaultErrorMessage: 'ボイス一覧の取得に失敗しました',
  })

  // ?theme=... があればプリフィル（複製機能で利用）
  useEffect(() => {
    const t = searchParams.get('theme')
    if (t) {
      setTheme(t.slice(0, MAX_THEME_LEN))
    }
  }, [searchParams])

  const themeError = theme.trim().length > 0 && theme.trim().length < MIN_THEME_LEN
  const isHeygenLoading =
    mode === 'heygen_avatar' &&
    (avatarsState.status === 'loading' ||
      (voiceSource === 'heygen' && voicesState.status === 'loading'))
  const canSubmit =
    theme.trim().length >= MIN_THEME_LEN &&
    theme.trim().length <= MAX_THEME_LEN &&
    !loading &&
    !isHeygenLoading

  // 1コマあたりの秒数を表示（ユーザーが直感的にバランスを取れるように）
  const secPerScene = (targetDurationSec / sceneCount).toFixed(1)

  const selectedAvatar =
    avatarsState.status === 'success'
      ? avatarsState.data.find((a) => a.avatar_id === heygenAvatarId)
      : undefined

  async function handleSubmit() {
    if (!canSubmit) return
    // HeyGen モード時のクライアントサイドガード
    if (mode === 'heygen_avatar') {
      if (!heygenAvatarId) {
        toast.error('アバターを選択してください')
        return
      }
      if (voiceSource === 'heygen' && !heygenVoiceId) {
        toast.error('ボイスを選択してください')
        return
      }
    }
    setLoading(true)
    try {
      const payload: {
        theme: string
        title?: string
        sceneCount: number
        targetDurationSec: number
        generationMode: GenerationMode
        voiceSource?: VoiceSource
        heygenAvatarId?: string
        heygenVoiceId?: string
        elevenlabsVoiceId?: string
      } = {
        theme: theme.trim(),
        title: title.trim() || undefined,
        sceneCount,
        targetDurationSec,
        generationMode: mode,
      }
      if (mode === 'remotion') {
        payload.elevenlabsVoiceId = elevenlabsVoiceId
      }
      if (mode === 'heygen_avatar') {
        payload.voiceSource = voiceSource
        payload.heygenAvatarId = heygenAvatarId
        if (voiceSource === 'heygen') {
          payload.heygenVoiceId = heygenVoiceId
        }
      }
      const res = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as { video?: Video; error?: string; code?: string; provider?: string; details?: unknown }
      if (!res.ok || data.error || !data.video) {
        if (data.code === 'RATE_LIMITED') {
          toast.error('1時間に5本までです。少し時間を空けて再度お試しください')
        } else if (data.code === 'MISSING_API_KEY') {
          // 設定ページへのリンクをユーザーに見せる
          toast.error(`${data.error ?? 'API キーが未登録です'} → /dashboard/settings から登録してください`)
        } else {
          toast.error(data.error ?? '動画の作成に失敗しました')
        }
        return
      }
      router.push(`/dashboard/videos/${data.video.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '動画の作成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // コスト警告メッセージ（モードとボイスソースの組み合わせ別）
  const costNotice = (() => {
    if (mode === 'remotion') {
      return '⚠️ 動画生成は外部 AI コストが大きいため 1時間あたり5本まで に制限しています'
    }
    if (voiceSource === 'elevenlabs') {
      return '⚠️ AIアバター動画は HeyGen のクレジット + ElevenLabs の文字数を消費します。残量は各サービスのダッシュボードで確認してください。'
    }
    return '⚠️ AIアバター動画は HeyGen のクレジットを消費します。残量は HeyGen のダッシュボードで確認してください。'
  })()

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <Link
          href="/dashboard/videos"
          className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-600"
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

      {/* ローカル限定バナーは Remotion モードのみ。HeyGen はクラウドレンダなので Vercel でも生成可。 */}
      {mode === 'remotion' && <LocalOnlyBanner variant="block" />}

      <Card className="space-y-5">
        {/* 生成モード */}
        <div role="radiogroup" aria-label="生成モード">
          <SectionLabel hint="シーン合成は質感重視、AIアバターは本人感重視">
            生成モード
          </SectionLabel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ModeOption
              name="generation-mode"
              checked={mode === 'remotion'}
              onChange={() => setMode('remotion')}
              title="シーン合成（標準）"
              description="画像+ナレーションを Remotion で合成。質感重視。"
              disabled={loading}
            />
            <ModeOption
              name="generation-mode"
              checked={mode === 'heygen_avatar'}
              onChange={() => setMode('heygen_avatar')}
              title="AIアバター（HeyGen）"
              description="アバターが台本を喋る動画。本人感重視。"
              disabled={loading}
            />
          </div>
        </div>

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
          <div id="theme-help" className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
            <span>{themeError ? `${MIN_THEME_LEN} 文字以上で入力してください` : `${MIN_THEME_LEN}〜${MAX_THEME_LEN} 文字`}</span>
            <span>{theme.length} / {MAX_THEME_LEN}</span>
          </div>
          {/* テーマ提案: AI生成 + クイック例 */}
          <div className="mt-2">
            <button
              type="button"
              onClick={suggestThemes}
              disabled={loading || suggestLoading}
              aria-busy={suggestLoading}
              className="inline-flex items-center gap-1 rounded-md border border-[#00A3BF]/40 bg-[#E9F7F9] px-2.5 py-1 text-[11px] font-medium text-[#006F83] hover:bg-[#D5F0F4] disabled:opacity-50"
            >
              {suggestLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {suggestLoading ? '提案を生成中...' : 'AIでテーマを提案'}
            </button>

            <div className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">
              {(themeSuggestions.length > 0 ? themeSuggestions : THEME_EXAMPLES).map((ex) => (
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
            {themeSuggestions.length > 0 && (
              <p className="mt-1 text-[10px] text-gray-500">
                過去の投稿・動画と被らないよう AI が提案しました（クリックで入力）
              </p>
            )}
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

        {mode === 'remotion' && (
          <>
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
              <div className="mt-1 flex justify-between text-[10px] text-gray-500">
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
              <div className="mt-1 flex justify-between text-[10px] text-gray-500">
                <span>15 秒</span>
                <span>90 秒</span>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">1シーンあたり約 {secPerScene} 秒</p>
            </div>

            {/* ナレーション voice 選択 */}
            <div>
              <SectionLabel hint="ナレーションの声のトーン。あとから変更も可能">
                ナレーションの声
              </SectionLabel>
              <SelectNative
                aria-label="ナレーションの声"
                value={elevenlabsVoiceId}
                onChange={(e) => setElevenlabsVoiceId(e.target.value)}
                disabled={loading}
              >
                {VOICE_PRESETS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}（{v.tag}）
                  </option>
                ))}
              </SelectNative>
              <p className="mt-1 text-[11px] text-gray-500">
                {VOICE_PRESETS.find((v) => v.id === elevenlabsVoiceId)?.description ?? ''}
              </p>
            </div>
          </>
        )}

        {mode === 'heygen_avatar' && (
          <>
            {/* アバター選択 */}
            <div>
              <SectionLabel hint="HeyGen のアカウントで使えるアバターを選択します">
                アバター (必須)
              </SectionLabel>
              {avatarsState.status === 'loading' && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin text-[#00A3BF]" />
                  アバター一覧を取得中…
                </div>
              )}
              {avatarsState.status === 'error' && (
                <ErrorMessage
                  code={avatarsState.code}
                  defaultMessage={avatarsState.message}
                  onRetry={refetchAvatars}
                />
              )}
              {avatarsState.status === 'success' && avatarsState.data.length === 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-[11px] text-amber-800">
                  HeyGen アカウントにアバターが登録されていません。
                  <a
                    href="https://app.heygen.com/avatars"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 inline-flex items-center gap-0.5 font-semibold underline"
                  >
                    HeyGen で作成
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {avatarsState.status === 'success' && avatarsState.data.length > 0 && (
                <>
                  <SelectNative
                    aria-label="アバター"
                    value={heygenAvatarId}
                    onChange={(e) => setHeygenAvatarId(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">アバターを選択してください</option>
                    {avatarsState.data.map((a) => (
                      <option key={a.avatar_id} value={a.avatar_id}>
                        {a.avatar_name}
                        {a.gender ? ` (${a.gender})` : ''}
                      </option>
                    ))}
                  </SelectNative>
                  {selectedAvatar?.preview_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedAvatar.preview_image_url}
                      alt={selectedAvatar.avatar_name}
                      className="mt-2 h-24 w-24 rounded-md border border-gray-200 object-cover"
                    />
                  )}
                </>
              )}
            </div>

            {/* ボイスソース */}
            <div role="radiogroup" aria-label="ナレーション音声">
              <SectionLabel hint="ナレーション音声をどこから取るかを選びます">
                ナレーション音声
              </SectionLabel>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ModeOption
                  name="voice-source"
                  checked={voiceSource === 'elevenlabs'}
                  onChange={() => setVoiceSource('elevenlabs')}
                  title="ElevenLabs"
                  description="高品質、自分の鍵を消費"
                  disabled={loading}
                />
                <ModeOption
                  name="voice-source"
                  checked={voiceSource === 'heygen'}
                  onChange={() => setVoiceSource('heygen')}
                  title="HeyGen 内蔵ボイス"
                  description="追加コストなし"
                  disabled={loading}
                />
              </div>
            </div>

            {/* ボイス選択（HeyGen ボイスのみ） */}
            {voiceSource === 'heygen' && (
              <div>
                <SectionLabel hint="HeyGen の内蔵ボイスから選択します">
                  ボイス (必須)
                </SectionLabel>
                {voicesState.status === 'loading' && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin text-[#00A3BF]" />
                    ボイス一覧を取得中…
                  </div>
                )}
                {voicesState.status === 'error' && (
                  <ErrorMessage
                    code={voicesState.code}
                    defaultMessage={voicesState.message}
                    onRetry={refetchVoices}
                  />
                )}
                {voicesState.status === 'success' && voicesState.data.length === 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-[11px] text-amber-800">
                    HeyGen アカウントで利用可能なボイスがありません。
                    <a
                      href="https://app.heygen.com/voice"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 inline-flex items-center gap-0.5 font-semibold underline"
                    >
                      HeyGen を確認
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                {voicesState.status === 'success' && voicesState.data.length > 0 && (
                  <SelectNative
                    aria-label="ボイス"
                    value={heygenVoiceId}
                    onChange={(e) => setHeygenVoiceId(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">ボイスを選択してください</option>
                    {voicesState.data.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}
                        {v.language ? ` (${v.language})` : ''}
                      </option>
                    ))}
                  </SelectNative>
                )}
              </div>
            )}
          </>
        )}

        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-[11px] text-amber-800">
          {costNotice}
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

function ModeOption({
  name,
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  name: string
  checked: boolean
  onChange: () => void
  title: string
  description: string
  disabled?: boolean
}) {
  return (
    <label
      className={
        'relative flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition ' +
        (checked
          ? 'border-[#00A3BF] bg-[#00A3BF]/5 ring-1 ring-[#00A3BF]/30'
          : 'border-gray-200 bg-white hover:border-gray-300') +
        (disabled ? ' opacity-60 pointer-events-none' : '')
      }
    >
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className={'text-sm font-semibold ' + (checked ? 'text-[#006F83]' : 'text-gray-900')}>
        {title}
      </span>
      <span className="text-[11px] leading-snug text-gray-500">{description}</span>
    </label>
  )
}

function ErrorMessage({
  code,
  defaultMessage,
  onRetry,
}: {
  code?: string | null
  defaultMessage: string
  onRetry?: () => void
}) {
  const text = (() => {
    if (code === 'MISSING_HEYGEN_KEY') {
      return (
        <>
          HeyGen API キーが未登録です。
          <Link href="/dashboard/settings" className="ml-1 font-semibold underline">
            設定ページ
          </Link>
          から登録してください
        </>
      )
    }
    if (code === 'HEYGEN_AUTH') {
      return <>HeyGen API キーが無効です。設定ページから再登録してください。</>
    }
    return defaultMessage
  })()
  // ネットワーク/サーバエラーは再試行可能。鍵不在/鍵無効は再試行しても直らないので隠す。
  const showRetry = onRetry && code !== 'MISSING_HEYGEN_KEY' && code !== 'HEYGEN_AUTH'
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border border-red-200 bg-red-50/60 p-2.5 text-[11px] text-red-700">
      <div className="flex-1">{text}</div>
      {showRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50"
        >
          <RefreshCw className="h-3 w-3" />
          再試行
        </button>
      )}
    </div>
  )
}
