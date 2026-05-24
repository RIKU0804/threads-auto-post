import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { enqueueVideoPipeline } from '@/lib/video/jobs'
import { videoCapability } from '@/lib/runtime-env'

const MIN_THEME_LEN = 3
const MAX_THEME_LEN = 200
const MAX_TITLE_LEN = 200
const MIN_DURATION = 15
const MAX_DURATION = 90
const MIN_SCENE_COUNT = 3
const MAX_SCENE_COUNT = 10
const DEFAULT_LIMIT = 50

// 動画生成は外部 API コストが大きいため fail-closed
const VIDEO_CREATE_LIMIT = 5
const VIDEO_CREATE_WINDOW_SEC = 3600

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { data, error } = await supabase
      .from('videos')
      .select('*, scenes:scenes(count)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(DEFAULT_LIMIT)

    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (e) {
    console.error('[videos GET]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.floor(n), min), max)
}

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

    const body = await req.json() as {
      theme?: unknown
      title?: unknown
      targetDurationSec?: unknown
      sceneCount?: unknown
    }

    const themeRaw = typeof body.theme === 'string' ? body.theme.trim() : ''
    if (themeRaw.length < MIN_THEME_LEN || themeRaw.length > MAX_THEME_LEN) {
      return NextResponse.json(
        { error: `theme は ${MIN_THEME_LEN}〜${MAX_THEME_LEN} 文字で指定してください` },
        { status: 400 },
      )
    }
    const theme = themeRaw

    const titleRaw = typeof body.title === 'string' ? body.title.trim() : ''
    const title = titleRaw
      ? titleRaw.slice(0, MAX_TITLE_LEN)
      : theme.slice(0, 80)

    const targetDurationSec =
      body.targetDurationSec === undefined
        ? null
        : clampInt(body.targetDurationSec, MIN_DURATION, MAX_DURATION, 45)
    const sceneCount =
      body.sceneCount === undefined
        ? null
        : clampInt(body.sceneCount, MIN_SCENE_COUNT, MAX_SCENE_COUNT, 6)

    const { data, error } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        title,
        status: 'draft',
        publish_status: 'unpublished',
        script: null,
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

    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    console.error('[videos POST]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '動画の作成に失敗しました' }, { status: 500 })
  }
}
