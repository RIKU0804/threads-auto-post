import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  listVoices,
  MissingHeyGenKeyError,
  HeyGenAuthError,
} from '@/lib/video/heygen'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const rl = await checkRateLimit(
      user.id,
      'heygen:list',
      RATE_LIMITS.heygenList.limit,
      RATE_LIMITS.heygenList.windowSeconds,
      RATE_LIMITS.heygenList.failMode,
    )
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'リクエストが多すぎます', code: 'RATE_LIMITED' },
        { status: 429 },
      )
    }

    try {
      const voices = await listVoices(user.id)
      return NextResponse.json({ voices })
    } catch (e) {
      if (e instanceof MissingHeyGenKeyError) {
        return NextResponse.json(
          { error: e.message, code: 'MISSING_HEYGEN_KEY' },
          { status: 400 },
        )
      }
      if (e instanceof HeyGenAuthError) {
        return NextResponse.json(
          { error: 'HeyGen API キーが無効です', code: 'HEYGEN_AUTH' },
          { status: 401 },
        )
      }
      console.error('[heygen/voices]', e instanceof Error ? e.message : 'unknown')
      return NextResponse.json(
        { error: 'ボイス一覧の取得に失敗しました' },
        { status: 500 },
      )
    }
  } catch (e) {
    console.error('[heygen/voices]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json(
      { error: 'ボイス一覧の取得に失敗しました' },
      { status: 500 },
    )
  }
}
