'use client'

import { useEffect, useState } from 'react'
import {
  Sparkles, Save, RefreshCw, ChevronLeft,
  CheckCircle, Lightbulb, Loader2, Video, Mic, Download, Play,
  ChevronDown, X,
} from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { cx } from '@/lib/utils'
import type { Account, Post } from '@/types/database'

interface HeygenLook {
  look_id: string
  preview_image_url?: string
}

interface HeygenAvatar {
  avatar_id: string
  avatar_name: string
  gender?: string
  preview_image_url?: string
  looks?: HeygenLook[]
}

interface HeygenVoice {
  voice_id: string
  name: string
  gender?: string
  language?: string
  preview_audio?: string
}

type Step = 'input' | 'preview' | 'done'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </p>
  )
}

const TIKTOK_POST_TYPES = [
  { value: 'hook',      label: 'フック型',    desc: '最初3秒で掴む',  emoji: '🪝' },
  { value: 'list',      label: 'リスト型',    desc: 'N個の〇〇',      emoji: '📋' },
  { value: 'story',     label: 'ストーリー型', desc: '体験談・変化',   emoji: '📖' },
  { value: 'tutorial',  label: 'ハウツー型',  desc: 'やり方解説',     emoji: '🎓' },
  { value: 'challenge', label: '問いかけ型',  desc: 'コメント誘導',   emoji: '💬' },
] as const

type TikTokPostType = typeof TIKTOK_POST_TYPES[number]['value']

export default function TikTokGeneratePage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [theme, setTheme] = useState('')
  const [postType, setPostType] = useState<TikTokPostType | ''>('')
  const [step, setStep] = useState<Step>('input')
  const [loading, setLoading] = useState(false)
  const [themeSuggestions, setThemeSuggestions] = useState<string[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [generatedScript, setGeneratedScript] = useState('')
  const [generatedSummary, setGeneratedSummary] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [audioLoading, setAudioLoading] = useState(false)
  const [savedPost, setSavedPost] = useState<Post | null>(null)
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_voice_id') ?? '' : ''
  )
  const [heygenAvatarId, setHeygenAvatarId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('heygen_avatar_id') ?? '' : ''
  )
  const [heygenVoiceId, setHeygenVoiceId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('heygen_voice_id') ?? '' : ''
  )
  const [videoUrl, setVideoUrl] = useState('')
  const [videoLoading, setVideoLoading] = useState(false)
  const [heygenLookId, setHeygenLookId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('heygen_look_id') ?? '' : ''
  )
  const [avatarList, setAvatarList] = useState<HeygenAvatar[]>([])
  const [voiceList, setVoiceList] = useState<HeygenVoice[]>([])
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [showVoicePicker, setShowVoicePicker] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  // アバター選択後、そのLooks一覧を表示するために使う
  const [selectedAvatarForLooks, setSelectedAvatarForLooks] = useState<HeygenAvatar | null>(null)

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json() as Promise<Account[]>)
      .then(accs => {
        const tiktokAccounts = accs.filter(a => a.platform === 'tiktok')
        setAccounts(tiktokAccounts)
        if (tiktokAccounts.length > 0) setSelectedAccount(tiktokAccounts[0].id)
      })
  }, [])

  const currentAccount = accounts.find(a => a.id === selectedAccount)

  async function handleSuggestThemes() {
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
      alert(e instanceof Error ? e.message : 'テーマ生成に失敗しました')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function handleGenerate(overrideTheme?: string) {
    const targetTheme = overrideTheme ?? theme
    if (!targetTheme.trim()) return
    if (overrideTheme) setTheme(overrideTheme)
    setLoading(true)
    try {
      const res = await fetch('/api/generate/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount || undefined,
          theme: targetTheme,
          postType: postType || undefined,
          platform: 'tiktok',
        }),
      })
      const data = await res.json() as { content: string; summary: string; error?: string }
      if (data.error) throw new Error(data.error)
      setGeneratedScript(data.content)
      setGeneratedSummary(data.summary ?? '')
      setAudioUrl('')
      setVideoUrl('')
      setStep('preview')
    } catch (e) {
      alert(e instanceof Error ? e.message : '生成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerateAudio() {
    if (!generatedScript) return
    setAudioLoading(true)
    try {
      const res = await fetch('/api/generate/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: generatedScript,
          voiceId: elevenLabsVoiceId || undefined,
        }),
      })
      const data = await res.json() as { audioUrl?: string; error?: string }
      if (!res.ok || !data.audioUrl) throw new Error(data.error ?? '音声生成に失敗しました')
      setAudioUrl(data.audioUrl)
    } catch (e) {
      alert(e instanceof Error ? e.message : '音声生成に失敗しました')
    } finally {
      setAudioLoading(false)
    }
  }

  async function openAvatarPicker() {
    setShowAvatarPicker(true)
    if (avatarList.length > 0) return
    setPickerLoading(true)
    try {
      const res = await fetch('/api/heygen/avatars')
      const data = await res.json() as { avatars?: HeygenAvatar[]; error?: string }
      if (data.error) throw new Error(data.error)
      setAvatarList(data.avatars ?? [])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'アバター一覧の取得に失敗しました')
      setShowAvatarPicker(false)
    } finally {
      setPickerLoading(false)
    }
  }

  async function openVoicePicker() {
    setShowVoicePicker(true)
    if (voiceList.length > 0) return
    setPickerLoading(true)
    try {
      const res = await fetch('/api/heygen/voices?language=Japanese')
      const data = await res.json() as { voices?: HeygenVoice[]; error?: string }
      if (data.error) throw new Error(data.error)
      setVoiceList(data.voices ?? [])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'ボイス一覧の取得に失敗しました')
      setShowVoicePicker(false)
    } finally {
      setPickerLoading(false)
    }
  }

  async function handleGenerateVideo() {
    if (!generatedScript) return
    if (!heygenAvatarId && !heygenLookId) return
    if (!audioUrl && !heygenVoiceId) return
    setVideoLoading(true)
    try {
      const res = await fetch('/api/generate/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: generatedScript,
          avatarId: heygenAvatarId,
          lookId: heygenLookId || undefined,
          // ElevenLabs音声があれば優先して渡す（HeyGen Voice ID不要）
          ...(audioUrl ? { audioUrl } : { voiceId: heygenVoiceId }),
          accountId: selectedAccount || undefined,
        }),
      })
      const data = await res.json() as { videoUrl?: string; error?: string }
      if (!res.ok || !data.videoUrl) throw new Error(data.error ?? '動画生成に失敗しました')
      setVideoUrl(data.videoUrl)
    } catch (e) {
      alert(e instanceof Error ? e.message : '動画生成に失敗しました')
    } finally {
      setVideoLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount || undefined,
          textContent: generatedScript,
          videoUrl: videoUrl || audioUrl || undefined,
          theme,
          summary: generatedSummary || undefined,
        }),
      })
      const post = await res.json() as Post & { error?: string }
      if (post.error) throw new Error(post.error)
      setSavedPost(post)
      setStep('done')
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setStep('input')
    setTheme('')
    setPostType('')
    setGeneratedScript('')
    setGeneratedSummary('')
    setAudioUrl('')
    setVideoUrl('')
    setHeygenLookId('')
    setSavedPost(null)
    setThemeSuggestions([])
  }

  if (step === 'done') {
    return (
      <div className="p-6 lg:p-8 max-w-2xl">
        <Card className="py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">保存しました！</h2>
          <p className="mt-1 text-sm text-gray-500">下書きとして保存されました</p>
          {videoUrl ? (
            <p className="mt-1 text-xs text-gray-400">
              アバター動画をTikTokアプリからそのまま投稿できます
            </p>
          ) : audioUrl && (
            <p className="mt-1 text-xs text-gray-400">
              音声をCapCutなどで背景動画と合わせてTikTokに投稿してください
            </p>
          )}
          <Button onClick={handleReset} className="mt-6 gap-2" style={{ backgroundColor: '#ff2d55', borderColor: '#ff2d55' }}>
            <Sparkles className="h-4 w-4" />
            新しい動画を生成する
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <>
    <div className="p-6 lg:p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/dashboard/generate" className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors">
              <ChevronLeft className="h-4 w-4" />
              戻る
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
              <Video className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-xl font-semibold lg:text-2xl" style={{ color: '#061b31' }}>
              TikTok 動画生成
            </h1>
          </div>
          <p className="mt-0.5 text-sm text-gray-500 ml-9">30秒スクリプト + ElevenLabs音声を生成</p>
        </div>
        {step === 'preview' && (
          <button onClick={() => setStep('input')} className="mt-6 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft className="h-4 w-4" />
            入力に戻る
          </button>
        )}
      </div>

      {/* Step 1: 入力 */}
      {step === 'input' && (
        <div className="space-y-5">
          <Card className="space-y-4">
            {/* アカウント選択 */}
            <div>
              <SectionLabel>アカウント</SectionLabel>
              {accounts.length === 0 ? (
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-700">デモモードで動作中</p>
                      <p className="mt-0.5 text-xs text-blue-600">
                        アカウント未登録でもスクリプト生成・音声生成・下書き保存ができます。
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <select
                  value={selectedAccount}
                  onChange={e => setSelectedAccount(e.target.value)}
                  className="w-full appearance-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition focus:border-[#ff2d55] focus:ring-2 focus:ring-[#ff2d55]/20"
                >
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* テーマ入力 */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <SectionLabel>動画テーマ</SectionLabel>
                <button
                  onClick={handleSuggestThemes}
                  disabled={suggestLoading}
                  className="flex items-center gap-1 text-xs font-medium text-[#ff2d55] hover:text-[#d9244a] disabled:opacity-50 transition-colors"
                >
                  <Lightbulb className={cx('h-3 w-3', suggestLoading && 'animate-pulse')} />
                  {suggestLoading ? '考え中...' : 'テーマを提案'}
                </button>
              </div>
              {themeSuggestions.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {themeSuggestions.map(t => (
                    <button
                      key={t}
                      onClick={() => { setTheme(t); setThemeSuggestions([]) }}
                      className={cx(
                        'rounded-full border px-3 py-1 text-xs transition-all text-left',
                        theme === t
                          ? 'border-[#ff2d55] bg-red-50 text-[#ff2d55]'
                          : 'border-[#e5edf5] bg-white text-gray-600 hover:border-[#ff2d55] hover:text-[#ff2d55]',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={theme}
                onChange={e => setTheme(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                placeholder="例：1週間で5kg痩せた方法、朝5時起きのメリット"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-hidden transition placeholder-gray-400 focus:border-[#ff2d55] focus:ring-2 focus:ring-[#ff2d55]/20"
              />
            </div>
          </Card>

          {/* 投稿の型 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>動画の型</SectionLabel>
              <span className="text-xs text-gray-400">任意</span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {TIKTOK_POST_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPostType(postType === t.value ? '' : t.value)}
                  className={cx(
                    'flex flex-col items-center gap-1 rounded-lg border py-3 px-2 text-center transition-all',
                    postType === t.value
                      ? 'border-[#ff2d55] bg-red-50'
                      : 'border-[#e5edf5] bg-white hover:border-pink-200 hover:bg-red-50/30',
                  )}
                >
                  <span className="text-xl leading-none">{t.emoji}</span>
                  <span className={cx('text-xs font-medium leading-tight', postType === t.value ? 'text-[#ff2d55]' : 'text-gray-700')}>
                    {t.label}
                  </span>
                  <span className="text-[10px] text-gray-400 leading-tight">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={() => handleGenerate()}
            disabled={!theme.trim()}
            isLoading={loading}
            loadingText="生成中..."
            className="w-full gap-2 py-2.5"
            style={theme.trim() ? { backgroundColor: '#ff2d55', borderColor: '#ff2d55' } : {}}
          >
            <Sparkles className="h-4 w-4" />
            スクリプト生成する
          </Button>
        </div>
      )}

      {/* Step 2: プレビュー */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">テーマ</span>
            <span className="text-gray-700">{theme}</span>
            <button onClick={() => setStep('input')} className="ml-auto text-xs text-[#ff2d55] hover:underline">変更</button>
          </div>

          {/* スクリプト */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SectionLabel>トークスクリプト</SectionLabel>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">ElevenLabsが読み上げます</span>
              </div>
              <button onClick={() => handleGenerate()} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-[#ff2d55] hover:text-[#d9244a] disabled:opacity-50">
                <RefreshCw className={cx('h-3 w-3', loading && 'animate-spin')} />
                再生成
              </button>
            </div>
            <Textarea
              value={generatedScript}
              onChange={e => setGeneratedScript(e.target.value)}
              rows={10}
              className="resize-none border-none bg-transparent p-0 shadow-none focus:ring-0"
            />
            <div className="flex items-center justify-between border-t border-gray-100 pt-2">
              <span className="text-xs text-gray-400">{generatedScript.length} 文字</span>
              <span className="text-xs text-gray-400">
                約 {Math.round(generatedScript.length / 6)} 秒
              </span>
            </div>
          </Card>

          {/* AI音声 */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SectionLabel>AI音声</SectionLabel>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">ElevenLabs</span>
              </div>
              <button
                onClick={handleGenerateAudio}
                disabled={audioLoading || !generatedScript}
                className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
              >
                {audioLoading
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Mic className="h-3 w-3" />}
                {audioLoading ? '生成中...' : audioUrl ? '再生成' : '音声を生成'}
              </button>
            </div>

            {/* Voice ID 入力 */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                ElevenLabs Voice ID
                <span className="ml-1 text-gray-400 font-normal">（空欄でデフォルト使用）</span>
              </label>
              <input
                value={elevenLabsVoiceId}
                onChange={e => {
                  setElevenLabsVoiceId(e.target.value)
                  localStorage.setItem('elevenlabs_voice_id', e.target.value)
                }}
                placeholder="例：21m00Tcm4TlvDq8ikWAM"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 outline-hidden transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                ElevenLabs → Voices から Voice ID をコピー。入力値はブラウザに保存されます
              </p>
            </div>

            {/* 音声プレーヤー */}
            {audioUrl ? (
              <div className="space-y-2">
                <audio src={audioUrl} controls className="w-full" />
                <a
                  href={audioUrl}
                  download="tiktok-audio.mp3"
                  className="flex items-center justify-center gap-1.5 w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  音声をダウンロード (.mp3)
                </a>
              </div>
            ) : audioLoading ? (
              <div className="flex h-20 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-emerald-200 bg-emerald-50/30">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
                <p className="text-xs text-gray-500">ElevenLabsで音声生成中...</p>
              </div>
            ) : (
              <div className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-[#e5edf5]">
                <Mic className="h-4 w-4 text-gray-300" />
                <span className="text-xs text-gray-400">「音声を生成」でリアルな音声を作成</span>
              </div>
            )}
          </Card>

          {/* アバター動画 (HeyGen) */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SectionLabel>アバター動画</SectionLabel>
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-600">HeyGen</span>
              </div>
              <button
                onClick={handleGenerateVideo}
                disabled={videoLoading || !generatedScript || (!heygenAvatarId && !heygenLookId) || (!heygenVoiceId && !audioUrl)}
                className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 disabled:opacity-50"
              >
                {videoLoading
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Play className="h-3 w-3" />}
                {videoLoading ? '生成中...' : videoUrl ? '再生成' : '動画を生成'}
              </button>
            </div>

            {/* Avatar ID */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500">
                  Avatar ID
                  <span className="ml-1 font-normal text-gray-400">（またはLook IDのみでもOK）</span>
                </label>
                <button
                  type="button"
                  onClick={openAvatarPicker}
                  className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
                >
                  <ChevronDown className="h-3 w-3" />
                  一覧から選択
                </button>
              </div>
              <input
                value={heygenAvatarId}
                onChange={e => {
                  setHeygenAvatarId(e.target.value)
                  localStorage.setItem('heygen_avatar_id', e.target.value)
                }}
                placeholder="例：b81ecd3f96274a89b7fedfdefae05bbe"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 outline-hidden transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                HeyGenのURL: <code className="bg-gray-100 px-1 rounded">?avatarId=xxx</code> の値をそのまま入力でOK
              </p>
            </div>

            {/* Voice ID */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500">ボイス</label>
                {!audioUrl && (
                  <button
                    type="button"
                    onClick={openVoicePicker}
                    className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
                  >
                    <ChevronDown className="h-3 w-3" />
                    一覧から選択
                  </button>
                )}
              </div>
              {audioUrl && (
                <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                  <span className="text-[11px] text-emerald-700">✓ ElevenLabs音声を使用します（Voice ID不要）</span>
                </div>
              )}
              <input
                value={heygenVoiceId}
                onChange={e => {
                  setHeygenVoiceId(e.target.value)
                  localStorage.setItem('heygen_voice_id', e.target.value)
                }}
                placeholder={audioUrl ? '（ElevenLabs音声使用中 — 空欄でOK）' : 'ボイスを選択 または IDを直接入力'}
                disabled={!!audioUrl}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-900 outline-hidden transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                {audioUrl
                  ? 'ElevenLabs音声をアバターに同期します。生成には1〜3分かかります'
                  : '入力値はブラウザに保存されます。生成には1〜3分かかります'}
              </p>
            </div>

            {/* 動画プレーヤー / ステート */}
            {videoUrl ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={videoUrl} controls className="w-full rounded-md" />
                <a
                  href={videoUrl}
                  download="tiktok-video.mp4"
                  className="flex items-center justify-center gap-1.5 w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  動画をダウンロード (.mp4)
                </a>
              </div>
            ) : videoLoading ? (
              <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-violet-200 bg-violet-50/30">
                <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
                <p className="text-xs text-gray-500">HeyGenで動画生成中（1〜3分）...</p>
              </div>
            ) : (
              <div className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-[#e5edf5]">
                <Video className="h-4 w-4 text-gray-300" />
                <span className="text-xs text-gray-400">Avatar ID と Voice ID を入力して動画を生成</span>
              </div>
            )}
          </Card>

          {/* 使い方ガイド */}
          <div className="rounded-md border border-gray-100 bg-gray-50 px-4 py-3 space-y-1">
            <p className="text-xs font-medium text-gray-600">TikTok投稿の流れ</p>
            <ol className="list-decimal list-inside space-y-0.5 text-xs text-gray-500">
              <li>音声ファイルをダウンロード</li>
              <li>CapCut で背景動画 + テキスト字幕 + 音声を合わせて編集</li>
              <li>TikTokアプリから投稿</li>
            </ol>
          </div>

          {/* アクション */}
          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleSave} disabled={loading} isLoading={loading} loadingText="保存中..." className="flex-1 gap-2">
              <Save className="h-4 w-4" />
              下書き保存
            </Button>
          </div>
        </div>
      )}
    </div>

    {/* ── アバターピッカーモーダル ── */}
    {showAvatarPicker && (
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40" onClick={() => { setShowAvatarPicker(false); setSelectedAvatarForLooks(null) }}>
        <div className="w-full max-w-lg rounded-t-2xl sm:rounded-xl bg-white shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            {selectedAvatarForLooks && (
              <button onClick={() => setSelectedAvatarForLooks(null)} className="text-gray-400 hover:text-gray-600">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <p className="flex-1 text-sm font-semibold text-gray-900">
              {selectedAvatarForLooks ? `${selectedAvatarForLooks.avatar_name} — Lookを選択` : 'アバターを選択'}
            </p>
            <button onClick={() => { setShowAvatarPicker(false); setSelectedAvatarForLooks(null) }} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-y-auto p-4">
            {pickerLoading ? (
              <div className="flex h-40 items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
                <span className="text-sm text-gray-500">読み込み中...</span>
              </div>
            ) : selectedAvatarForLooks ? (
              /* ── Look一覧 ── */
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {/* Lookなしでアバターのデフォルトを使うオプション */}
                <button
                  type="button"
                  onClick={() => {
                    setHeygenAvatarId(selectedAvatarForLooks.avatar_id)
                    setHeygenLookId('')
                    localStorage.setItem('heygen_avatar_id', selectedAvatarForLooks.avatar_id)
                    localStorage.removeItem('heygen_look_id')
                    setShowAvatarPicker(false)
                    setSelectedAvatarForLooks(null)
                  }}
                  className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[#e5edf5] p-4 text-xs text-gray-400 hover:border-violet-400 hover:text-violet-600 transition-all"
                >
                  <Video className="h-6 w-6" />
                  デフォルト
                </button>
                {selectedAvatarForLooks.looks?.map(l => (
                  <button
                    key={l.look_id}
                    type="button"
                    onClick={() => {
                      setHeygenAvatarId(selectedAvatarForLooks.avatar_id)
                      setHeygenLookId(l.look_id)
                      localStorage.setItem('heygen_avatar_id', selectedAvatarForLooks.avatar_id)
                      localStorage.setItem('heygen_look_id', l.look_id)
                      setShowAvatarPicker(false)
                      setSelectedAvatarForLooks(null)
                    }}
                    className={cx(
                      'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-all hover:border-violet-400',
                      heygenLookId === l.look_id ? 'border-violet-500' : 'border-[#e5edf5]',
                    )}
                  >
                    {l.preview_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.preview_image_url} alt={l.look_id} className="aspect-[3/4] w-full object-cover" />
                    ) : (
                      <div className="aspect-[3/4] w-full bg-gray-100 flex items-center justify-center">
                        <Video className="h-8 w-8 text-gray-300" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              /* ── アバター一覧 ── */
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {avatarList.map(a => (
                  <button
                    key={a.avatar_id}
                    type="button"
                    onClick={() => {
                      if (a.looks && a.looks.length > 0) {
                        setSelectedAvatarForLooks(a)
                      } else {
                        setHeygenAvatarId(a.avatar_id)
                        setHeygenLookId('')
                        localStorage.setItem('heygen_avatar_id', a.avatar_id)
                        localStorage.removeItem('heygen_look_id')
                        setShowAvatarPicker(false)
                      }
                    }}
                    className={cx(
                      'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-all hover:border-violet-400',
                      heygenAvatarId === a.avatar_id ? 'border-violet-500' : 'border-[#e5edf5]',
                    )}
                  >
                    {a.preview_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.preview_image_url} alt={a.avatar_name} className="aspect-[3/4] w-full object-cover" />
                    ) : (
                      <div className="aspect-[3/4] w-full bg-gray-100 flex items-center justify-center">
                        <Video className="h-8 w-8 text-gray-300" />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-[11px] font-medium text-gray-800 leading-tight line-clamp-2">{a.avatar_name}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        {a.gender}{a.looks && a.looks.length > 0 ? ` · ${a.looks.length} looks` : ''}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* ── ボイスピッカーモーダル ── */}
    {showVoicePicker && (
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40" onClick={() => setShowVoicePicker(false)}>
        <div className="w-full max-w-lg rounded-t-2xl sm:rounded-xl bg-white shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">ボイスを選択（日本語）</p>
            <button onClick={() => setShowVoicePicker(false)} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-y-auto p-4">
            {pickerLoading ? (
              <div className="flex h-40 items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
                <span className="text-sm text-gray-500">読み込み中...</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {voiceList.map(v => (
                  <button
                    key={v.voice_id}
                    type="button"
                    onClick={() => {
                      setHeygenVoiceId(v.voice_id)
                      localStorage.setItem('heygen_voice_id', v.voice_id)
                      setShowVoicePicker(false)
                    }}
                    className={cx(
                      'flex w-full items-center justify-between rounded-lg border-2 px-3 py-2.5 text-left transition-all hover:border-violet-400',
                      heygenVoiceId === v.voice_id ? 'border-violet-500 bg-violet-50' : 'border-[#e5edf5] bg-white',
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{v.name}</p>
                      <p className="text-[11px] text-gray-400">{v.gender} · {v.language}</p>
                    </div>
                    {v.preview_audio && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); new Audio(v.preview_audio!).play() }}
                        className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 hover:bg-violet-100 transition-colors"
                      >
                        <Play className="h-3 w-3 text-gray-600" />
                      </button>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  )
}
