import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { toFile } from 'openai'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImageEditFn = (p: any) => Promise<{ data: Array<{ b64_json?: string }> }>

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { imageUrl, editPrompt } = await req.json() as {
      imageUrl?: string
      editPrompt?: string
    }

    if (!imageUrl || !editPrompt?.trim()) {
      return NextResponse.json({ error: 'imageUrl と editPrompt が必要です' }, { status: 400 })
    }

    // 元画像をダウンロード（PNG として渡す）
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error('元画像の取得に失敗しました')
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer())

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    // リトライあり（500はOpenAI側の一時エラーが多い）
    let response: { data: Array<{ b64_json?: string }> } | null = null
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
        const msg = e instanceof Error ? e.message : ''
        if (attempt === 0 && msg.includes('500')) {
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        throw e
      }
    }

    const b64 = response?.data[0]?.b64_json
    if (!b64) throw new Error('編集後の画像データが取得できませんでした')

    const storage = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const fileName = `generated/${Date.now()}-${Math.random().toString(36).slice(2)}.png`
    const { error: uploadError } = await storage.storage
      .from('post-images')
      .upload(fileName, Buffer.from(b64, 'base64'), { contentType: 'image/png', upsert: false })

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

    const { data: { publicUrl } } = storage.storage
      .from('post-images')
      .getPublicUrl(fileName)

    return NextResponse.json({ imageUrl: publicUrl })
  } catch (e) {
    const message = e instanceof Error ? e.message : '画像編集に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
