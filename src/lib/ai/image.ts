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

  const fullPrompt = `${styleGuide[style]}, ${prompt}. No text in Japanese, use simple English labels or numbers only. High quality, suitable for social media.`

  // gpt-image-2 は b64_json で受け取る（URL形式は500エラーになる場合あり）
  const response = await client.images.generate({
    model: 'gpt-image-2',
    prompt: fullPrompt,
    n: 1,
    size: '1024x1024',
    quality: 'medium',
    response_format: 'b64_json',
  })

  const b64 = response.data?.[0]?.b64_json
  if (!b64) throw new Error('画像生成に失敗しました')

  // Supabase Storageに保存してパブリックURLを返す
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const fileName = `generated/${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  const buffer = Buffer.from(b64, 'base64')

  const { error } = await supabase.storage
    .from('post-images')
    .upload(fileName, buffer, { contentType: 'image/png', upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data: { publicUrl } } = supabase.storage
    .from('post-images')
    .getPublicUrl(fileName)

  return publicUrl
}
