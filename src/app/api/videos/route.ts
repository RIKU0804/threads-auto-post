import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { enqueueVideoPipeline } from '@/lib/video/jobs'
import { videoCapability } from '@/lib/runtime-env'
import type { GenerationMode } from '@/types/database'

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
    // 動画生成は Vercel Functions では実行不可（Chromium 1.5GB / タイムアウト）
    // VIDEO_RENDERING_ENABLED=1 で強制有効化可（自前ワーカー運用時の脱出ハッチ）
    const capability = videoCapability()
    if (!capability.enabled) {
      return NextResponse.json(
        { error: capability.message, code: 'LOCAL_ONLY' },
        { status: 503 },
      )
    }

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
