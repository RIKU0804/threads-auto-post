import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { enqueueVideoPipeline } from '@/lib/video/jobs'
import { videoCapability } from '@/lib/runtime-env'
import { isValidVoiceId } from '@/lib/video/voice-presets'
import { requireApiKey, MissingApiKeyError } from '@/lib/ai/api-keys'
import { requireElevenLabsKey, MissingElevenLabsKeyError } from '@/lib/video/elevenlabs'
import { requireHeyGenKey, MissingHeyGenKeyError } from '@/lib/video/heygen'
import type { GenerationMode, VoiceSource } from '@/types/database'

/**
 * 動画パイプラインに必要な API キーを「動画生成を開始する前」に検証する。
 *
 * 既存挙動: pipeline 開始後に MissingApiKeyError が出て failed 状態になっていた。
 * 失敗バナーから設定ページに行く導線も無く、ユーザーは延々 restart を押すしかなかった。
 * → 開始前に 400 を返してフロント側で設定ページに誘導する。
 */
async function validateApiKeysForMode(
  userId: string,
  mode: GenerationMode,
  voiceSource: VoiceSource | null,
): Promise<{ ok: true } | { ok: false; provider: string; message: string }> {
  try {
    // 台本生成 (src/lib/video/script.ts) は remotion / heygen_avatar の
    // どちらの経路でも OpenRouter を必須とする。ここで検証しないと OpenRouter
    // 未設定でも動画レコード作成とジョブ投入まで進み、pipeline 側で failed に
    // 落ちてしまう。両モード共通の前提として先頭で確認する。
    await requireApiKey('openrouter')
    if (mode === 'remotion') {
      await requireApiKey('openai')
      await requireElevenLabsKey(userId)
    } else {
      await requireHeyGenKey(userId)
      if (voiceSource === 'elevenlabs') {
        await requireElevenLabsKey(userId)
      }
    }
    return { ok: true }
  } catch (e: unknown) {
    if (e instanceof MissingApiKeyError) {
      return { ok: false, provider: e.provider, message: e.message }
    }
    if (e instanceof MissingElevenLabsKeyError) {
      return { ok: false, provider: 'elevenlabs', message: e.message }
    }
    if (e instanceof MissingHeyGenKeyError) {
      return { ok: false, provider: 'heygen', message: e.message }
    }
    throw e
  }
}

const MAX_TITLE_LEN = 200
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const MAX_HEYGEN_ID_LEN = 256
const HEYGEN_ID_REGEX = /^[\w-]{1,256}$/

// 動画生成は外部 API コストが大きいため fail-closed
const VIDEO_CREATE_LIMIT = 5
const VIDEO_CREATE_WINDOW_SEC = 3600

/** GenerationMode 型述語 */
function isGenerationMode(s: string): s is GenerationMode {
  return s === 'remotion' || s === 'heygen_avatar'
}

interface VideoListRow {
  id: string
  created_at: string
  [key: string]: unknown
}

interface CursorPayload {
  createdAt: string
  id: string
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(`${payload.createdAt}|${payload.id}`, 'utf8').toString('base64url')
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    const idx = decoded.indexOf('|')
    if (idx <= 0) return null
    const createdAt = decoded.slice(0, idx)
    const id = decoded.slice(idx + 1)
    if (!createdAt || !id) return null
    // ISO 8601 形式の最低限チェック（不正値で SQL に渡るのを防ぐ）
    if (Number.isNaN(Date.parse(createdAt))) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.floor(n), 1), MAX_LIMIT)
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const url = new URL(req.url)
    const limit = clampLimit(url.searchParams.get('limit'))
    const cursorRaw = url.searchParams.get('cursor')
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null
    if (cursorRaw && !cursor) {
      return NextResponse.json(
        { error: 'cursor が不正です', code: 'INVALID_CURSOR' },
        { status: 400 },
      )
    }

    let query = supabase
      .from('videos')
      .select('*, scenes:scenes(count)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1) // hasMore 判定用に 1 件多く取得

    if (cursor) {
      // (created_at, id) < (cursorCreatedAt, cursorId) を表現
      // 1. created_at < cursor.createdAt
      // 2. created_at == cursor.createdAt AND id < cursor.id
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      )
    }

    const { data, error } = await query
    if (error) throw error

    const rows = (data ?? []) as VideoListRow[]
    const hasMore = rows.length > limit
    const videos = hasMore ? rows.slice(0, limit) : rows

    const meta: { hasMore: boolean; nextCursor?: string } = { hasMore }
    if (hasMore) {
      const last = videos[videos.length - 1]
      meta.nextCursor = encodeCursor({ createdAt: last.created_at, id: last.id })
    }

    return NextResponse.json({ videos, meta })
  } catch (e) {
    console.error('[videos GET]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

const PostBodySchema = z.object({
  theme: z.string().min(1).max(200),
  title: z.string().max(MAX_TITLE_LEN).optional(),
  sceneCount: z.number().int().min(2).max(15).optional(),
  targetDurationSec: z.number().int().min(15).max(120).optional(),
  generationMode: z.enum(['remotion', 'heygen_avatar']).default('remotion'),
  voiceSource: z.enum(['elevenlabs', 'heygen']).optional(),
  heygenAvatarId: z.string().regex(HEYGEN_ID_REGEX).max(MAX_HEYGEN_ID_LEN).optional(),
  heygenVoiceId: z.string().regex(HEYGEN_ID_REGEX).max(MAX_HEYGEN_ID_LEN).optional(),
  // Remotion 経路のナレーション voice (ElevenLabs)
  // voice-presets.ts に登録された ID のみ許可
  elevenlabsVoiceId: z.string().refine(isValidVoiceId, { message: '未知の voice_id です' }).optional(),
}).strict()
  .superRefine((data, ctx) => {
    if (data.generationMode === 'heygen_avatar') {
      if (!data.heygenAvatarId) {
        ctx.addIssue({ code: 'custom', path: ['heygenAvatarId'], message: 'アバターを選択してください' })
      }
      if (!data.voiceSource) {
        ctx.addIssue({ code: 'custom', path: ['voiceSource'], message: 'voiceSource は必須です' })
      }
      if (data.voiceSource === 'heygen' && !data.heygenVoiceId) {
        ctx.addIssue({ code: 'custom', path: ['heygenVoiceId'], message: 'ボイスを選択してください' })
      }
    }
  })

export async function POST(req: NextRequest) {
  try {
    // capability チェックは generationMode 確定後に行う（HeyGen は Vercel でも可、
    // Remotion はローカル限定）。ここでは認証・レート制限を先に通す。
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const rl = await checkRateLimit(
      user.id,
      'video:create',
      VIDEO_CREATE_LIMIT,
      VIDEO_CREATE_WINDOW_SEC,
      'closed',
    )
    if (!rl.ok) {
      return NextResponse.json(
        { error: '動画生成リクエストが多すぎます。しばらくしてからお試しください。', code: 'RATE_LIMITED' },
        { status: 429 },
      )
    }

    const rawBody: unknown = await req.json()
    const parsed = PostBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: '入力内容に誤りがあります',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      )
    }

    // 念のため二重ガード（Zod でも enum 検証済みだが、型述語で narrow）
    const generationModeStr: string = parsed.data.generationMode
    if (!isGenerationMode(generationModeStr)) {
      return NextResponse.json(
        { error: 'generationMode が不正です', code: 'INVALID_MODE' },
        { status: 400 },
      )
    }
    const generationMode: GenerationMode = generationModeStr

    // 動画生成の実行可否を mode 別に判定。
    // Remotion は Chromium 必須でローカル限定、HeyGen はクラウドレンダで Vercel でも可。
    const capability = videoCapability(generationMode)
    if (!capability.enabled) {
      return NextResponse.json(
        { error: capability.message, code: 'LOCAL_ONLY' },
        { status: 503 },
      )
    }

    const theme = parsed.data.theme.trim()
    const titleRaw = parsed.data.title?.trim() ?? ''
    const title = titleRaw ? titleRaw.slice(0, MAX_TITLE_LEN) : theme.slice(0, 80)
    const sceneCount = parsed.data.sceneCount ?? null
    const targetDurationSec = parsed.data.targetDurationSec ?? null

    const voiceSource = generationMode === 'heygen_avatar' ? (parsed.data.voiceSource ?? null) : null
    const heygenAvatarId = generationMode === 'heygen_avatar' ? (parsed.data.heygenAvatarId ?? null) : null
    const heygenVoiceId =
      generationMode === 'heygen_avatar' && voiceSource === 'heygen'
        ? (parsed.data.heygenVoiceId ?? null)
        : null
    // Remotion 経路でのみ ElevenLabs voice を保存する (HeyGen はアバター内蔵 voice)
    const elevenlabsVoiceId =
      generationMode === 'remotion' ? (parsed.data.elevenlabsVoiceId ?? null) : null

    // 動画生成の事前検証: 必要な API キーが揃っているか
    // 失敗すると pipeline で failed になる前に 400 で返す
    const keyCheck = await validateApiKeysForMode(user.id, generationMode, voiceSource)
    if (!keyCheck.ok) {
      return NextResponse.json(
        {
          error: keyCheck.message,
          code: 'MISSING_API_KEY',
          provider: keyCheck.provider,
        },
        { status: 400 },
      )
    }

    // HeyGen mode はアバター動画として 1 本生成するため、scenes は使わない (持たない)。
    // Remotion mode 時のみ pipeline 側で scenes を作成する。
    const { data, error } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        title,
        status: 'draft',
        publish_status: 'unpublished',
        script: null,
        generation_mode: generationMode,
        voice_source: voiceSource,
        heygen_avatar_id: heygenAvatarId,
        heygen_voice_id: heygenVoiceId,
        elevenlabs_voice_id: elevenlabsVoiceId,
        // 進捗バーの経過時間計算で使う。リロード後もこの時刻からの差分を表示する
        generation_started_at: new Date().toISOString(),
        // theme / sceneCount / targetDurationSec はパイプライン側でメタ参照する想定
        // videos テーブルに対応カラムがない場合は jobs 側に渡す
      })
      .select()
      .single()

    if (error) throw error

    // fire-and-forget: パイプラインのキック失敗で API レスポンスを落とさない
    void enqueueVideoPipeline(data.id, { theme, sceneCount, targetDurationSec }).catch(err => {
      console.error('[videos POST] enqueue failed', data.id, err instanceof Error ? err.message : 'unknown')
    })

    return NextResponse.json({ video: data }, { status: 201 })
  } catch (e) {
    console.error('[videos POST]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '動画の作成に失敗しました' }, { status: 500 })
  }
}
