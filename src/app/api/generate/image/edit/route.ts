import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { uploadGeneratedImage } from '@/lib/ai/image'
import { requireApiKey, MissingApiKeyError } from '@/lib/ai/api-keys'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import OpenAI, { toFile } from 'openai'

// OpenAI SDK の型は overload で複雑なので、必要な戻り値だけを取り出す薄いラッパー型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImageEditFn = (p: any) => Promise<{
  data?: Array<{ b64_json?: string }>
}>

const FETCH_TIMEOUT_MS = 20_000
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB

/**
 * imageUrl の SSRF 対策:
 *  - https:// のみ許可
 *  - 自前 Supabase Storage の publicUrl ホスト と OpenAI が返す既知ホストのみ allowlist
 */
function isAllowedImageUrl(input: string): boolean {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (supabaseUrl) {
    try {
      const allowedHost = new URL(supabaseUrl).host
      if (url.host === allowedHost) return true
    } catch {}
  }
  // OpenAI が返す生成画像 URL のホスト
  if (url.host.endsWith('.openai.com') || url.host.endsWith('.oaiusercontent.com')) {
    return true
  }
  return false
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const rl = await checkRateLimit(user.id, 'generate', RATE_LIMITS.generate.limit, RATE_LIMITS.generate.windowSeconds, RATE_LIMITS.generate.failMode)
    if (!rl.ok) {
      return NextResponse.json(
        { error: '生成リクエストが多すぎます。しばらくしてからお試しください。', code: 'RATE_LIMITED' },
        { status: 429 },
      )
    }

    const { imageUrl, editPrompt } = await req.json() as {
      imageUrl?: string
      editPrompt?: string
    }

    if (!imageUrl || !editPrompt?.trim()) {
      return NextResponse.json({ error: 'imageUrl と editPrompt が必要です' }, { status: 400 })
    }
    if (!isAllowedImageUrl(imageUrl)) {
      return NextResponse.json({ error: '対応していない画像URLです' }, { status: 400 })
    }
    if (editPrompt.length > 1000) {
      return NextResponse.json({ error: '編集指示は1000文字以内にしてください' }, { status: 400 })
    }

    // 元画像をダウンロード
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!imgRes.ok) {
      return NextResponse.json({ error: '元画像の取得に失敗しました' }, { status: 400 })
    }
    const contentLength = Number(imgRes.headers.get('content-length') ?? 0)
    if (contentLength && contentLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: '画像サイズが大きすぎます' }, { status: 400 })
    }
    const arrayBuffer = await imgRes.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: '画像サイズが大きすぎます' }, { status: 400 })
    }
    const imgBuffer = Buffer.from(arrayBuffer)

    const openaiKey = await requireApiKey('openai')
    const client = new OpenAI({ apiKey: openaiKey, timeout: 120_000, maxRetries: 0 })

    let response: { data?: Array<{ b64_json?: string }> } | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await (client.images.edit as ImageEditFn)({
          model: 'gpt-image-2',
          image: await toFile(imgBuffer, 'image.png', { type: 'image/png' }),
          prompt: editPrompt.trim(),
          n: 1,
          size: '1024x1024',
          quality: 'medium',
        })
        break
      } catch (e) {
        const status = (e as Error & { status?: number }).status
        if (attempt === 0 && (status === 500 || status === 502 || status === 503 || status === 504)) {
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        throw e
      }
    }

    const b64 = response?.data?.[0]?.b64_json
    if (!b64) throw new Error('編集後の画像データが取得できませんでした')

    const publicUrl = await uploadGeneratedImage(b64, 'png', 'image/png')
    return NextResponse.json({ imageUrl: publicUrl })
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    console.error('[generate/image/edit]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '画像編集に失敗しました' }, { status: 500 })
  }
}
