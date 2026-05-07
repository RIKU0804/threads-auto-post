import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { startVideoGeneration, pollUntilComplete } from '@/lib/ai/heygen'

// HeyGenの動画生成は1〜3分かかる。Vercel Fluid Compute デフォルトは 300s。
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { text, avatarId, lookId, voiceId, audioUrl, accountId, caption = true } = await req.json() as {
      text?: string
      avatarId?: string
      lookId?: string
      voiceId?: string
      audioUrl?: string
      accountId?: string
      caption?: boolean
    }

    if (!text?.trim()) {
      return NextResponse.json({ error: 'text は必須です' }, { status: 400 })
    }

    // accountIdがあればそこから avatarId/voiceId を取得（指定があれば優先）
    let resolvedAvatarId = avatarId
    let resolvedVoiceId = voiceId

    if (accountId && (!resolvedAvatarId || !resolvedVoiceId)) {
      const { data: acc } = await supabase
        .from('accounts')
        .select('heygen_avatar_id, heygen_voice_id')
        .eq('id', accountId)
        .eq('user_id', user.id)
        .single()

      resolvedAvatarId = resolvedAvatarId || acc?.heygen_avatar_id || undefined
      resolvedVoiceId = resolvedVoiceId || acc?.heygen_voice_id || undefined
    }

    if (!resolvedAvatarId && !lookId) {
      return NextResponse.json(
        { error: 'avatarId または lookId が必要です' },
        { status: 400 },
      )
    }

    if (!audioUrl && !resolvedVoiceId) {
      return NextResponse.json(
        { error: 'voiceId または audioUrl が必要です' },
        { status: 400 },
      )
    }

    // 1) HeyGen で生成開始
    const videoId = await startVideoGeneration({
      text: text.trim(),
      avatarId: resolvedAvatarId,
      lookId,
      voiceId: resolvedVoiceId,
      audioUrl,
      caption,
      width: 1080,
      height: 1920,
    })

    // 2) 完成までポーリング
    const status = await pollUntilComplete(videoId, { maxAttempts: 50, intervalMs: 5000 })
    if (!status.video_url) {
      throw new Error('HeyGenから動画URLが返りませんでした')
    }

    // 3) HeyGenの署名URLは期限切れするので Supabase Storage に保存
    const videoRes = await fetch(status.video_url)
    if (!videoRes.ok) throw new Error('HeyGen動画ダウンロード失敗')
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

    const storage = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const fileName = `generated/${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
    const { error: uploadError } = await storage.storage
      .from('post-videos')
      .upload(fileName, videoBuffer, { contentType: 'video/mp4', upsert: false })

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`)
    }

    const { data: { publicUrl } } = storage.storage
      .from('post-videos')
      .getPublicUrl(fileName)

    return NextResponse.json({
      videoUrl: publicUrl,
      thumbnailUrl: status.thumbnail_url,
      duration: status.duration,
      heygenVideoId: videoId,
    })
  } catch (e) {
    console.error('[generate/video]', e instanceof Error ? e.message : 'unknown')
    const message = e instanceof Error ? e.message : '動画生成に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
