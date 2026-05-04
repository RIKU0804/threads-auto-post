import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

interface GenerateImageOptions {
  prompt: string
  style?: 'diagram' | 'infographic' | 'minimal'
}

export async function generateDiagramImage({
  prompt,
  style = 'diagram',
}: GenerateImageOptions): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const styleGuide: Record<string, string> = {
    diagram:     'Clean diagram infographic, flat design, white background, Japanese career advice, minimal icons, pastel colors, professional layout',
    infographic: 'Modern infographic, clean typography, data visualization, career tips, blue and white color scheme, professional',
    minimal:     'Minimal clean design, simple illustration, white background, career and job hunting theme, soft colors',
  }

  // ルート側で構造化済みのプロンプトをそのまま使う。スタイルガイドは補足として付加
  const fullPrompt = `${prompt} Style: ${styleGuide[style]}. High quality, 1:1 square format, suitable for social media.`

  // gpt-image-2: response_format 非対応、常に b64_json で返る
  // output_format は SDK 型定義未対応のため any でキャスト
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.images.generate as (p: any) => Promise<{ data: Array<{ b64_json?: string }> }>)({
    model: 'gpt-image-2',
    prompt: fullPrompt,
    n: 1,
    size: '1024x1024',
    quality: 'medium',
    output_format: 'webp',
  })

  const b64 = response.data[0]?.b64_json
  if (!b64) throw new Error('画像データが取得できませんでした')

  // Supabase Storage に保存してパブリック URL を返す
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const fileName = `generated/${Date.now()}-${Math.random().toString(36).slice(2)}.webp`
  const buffer = Buffer.from(b64, 'base64')

  const { error } = await supabase.storage
    .from('post-images')
    .upload(fileName, buffer, { contentType: 'image/webp', upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data: { publicUrl } } = supabase.storage
    .from('post-images')
    .getPublicUrl(fileName)

  return publicUrl
}
