import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { publishVideoToAccount } from '../../../_lib/publish-helper'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const rl = await checkRateLimit(
      user.id,
      'publish:instagram',
      RATE_LIMITS.publishVideo.limit,
      RATE_LIMITS.publishVideo.windowSeconds,
      RATE_LIMITS.publishVideo.failMode,
    )
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'リクエストが多すぎます', code: 'RATE_LIMITED' },
        { status: 429 },
      )
    }

    const body = await req.json() as {
      accountId?: unknown
      caption?: unknown
      shareToFeed?: unknown
    }
    const accountId = typeof body.accountId === 'string' ? body.accountId : ''
    const captionRaw = typeof body.caption === 'string' ? body.caption.trim() : ''
    const caption = captionRaw ? captionRaw.slice(0, 2200) : undefined
    const shareToFeed = body.shareToFeed === false ? false : true

    return await publishVideoToAccount({
      videoId: id,
      accountId,
      platform: 'instagram',
      userId: user.id,
      supabase,
      captionOverride: caption,
      publisherOptions: {
        instagramShareToFeed: shareToFeed,
      },
    })
  } catch (e) {
    console.error('[videos/publish/instagram]', id, e instanceof Error ? e.message : 'unknown')
    return NextResponse.json(
      { error: 'Instagram への公開に失敗しました', code: 'PUBLISH_ERROR' },
      { status: 500 },
    )
  }
}
