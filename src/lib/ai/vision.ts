/**
 * 参考画像を vision モデルで構造分析する
 * - 具体的な被写体・テキストではなく、構造・レイアウト・配色・スタイルを抽出
 * - 画像生成プロンプトに合成する用
 */

const VISION_MODEL = 'google/gemini-flash-latest'
const REQUEST_TIMEOUT_MS = 30_000

const SYSTEM_PROMPT = `You analyze an image's *visual design structure* to be used as a reference template for generating a NEW image with different content.

Output a single concise paragraph (max 200 words, English) describing:
- Overall layout (vertical sections, grid, centered panel, etc.)
- Color palette (dominant + accent colors with rough hex if visible)
- Typography style (size hierarchy, weight, decorative vs minimal)
- Design elements (icons, frames, dividers, illustrations, charts)
- Visual hierarchy (what catches the eye first)
- Overall aesthetic (minimal/busy, modern/retro, professional/playful)

DO NOT describe specific text content, names, or subject matter.
Focus ONLY on reusable structural & stylistic patterns.
Start the paragraph directly. No preface like "This image shows".`

export async function analyzeImageStructure(
  imageBase64: string,
  mimeType = 'image/png',
  apiKey?: string,
): Promise<string> {
  if (!apiKey) throw new Error('OpenRouter API key is required')

  // base64 が data URI の場合は剥がす
  const cleanBase64 = imageBase64.replace(/^data:image\/[^;]+;base64,/, '')

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? '',
      'X-Title': 'SNS Auto Post',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this reference image\'s visual design structure.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${cleanBase64}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[Vision API]', res.status, errText)
    throw new Error(`Vision API error (HTTP ${res.status})`)
  }

  const json = await res.json() as { choices: Array<{ message: { content: string } }> }
  return json.choices[0]?.message?.content?.trim() ?? ''
}
