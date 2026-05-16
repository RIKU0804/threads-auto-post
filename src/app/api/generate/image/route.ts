import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { generateDiagramImage } from '@/lib/ai/image'
import { analyzeImageStructure } from '@/lib/ai/vision'
import { fetchAccountPromptExtra } from '@/lib/ai/prompt-settings'

const MAX_REF_IMAGE_BYTES = 7 * 1024 * 1024 // base64で約5MB相当
const ALLOWED_REF_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/**
 * 投稿本文から画像生成プロンプトを構築する
 * - タイトル行と番号付きリスト（①②③ or 1.2.3.）を抽出
 * - gpt-image-2 のテキスト描画能力を活かし、内容を画像に反映させる
 */
function buildImagePrompt(postContent: string): string {
  const lines = postContent
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  // タイトル候補: 【】や「」で囲まれた行、または最初の行
  const titleLine = lines.find(l => /【.+】|「.+」/.test(l)) ?? lines[0] ?? ''
  const title = titleLine.replace(/[#【】「」]/g, '').trim().slice(0, 60)

  // 番号付き箇条書きを抽出（①②③ or 1. or ・や→）
  const bullets = lines
    .filter(l => /^[①②③④⑤⑥⑦⑧⑨⑩]|^\d+[.．、]|^[・→▶]/.test(l))
    .map(l => l.replace(/^[①②③④⑤⑥⑦⑧⑨⑩\d][.．、]?\s*/, '').replace(/→.+/, '').trim())
    .slice(0, 4)

  // ハッシュタグを除いたプレーンな本文から主要キーワード抽出
  const bodyText = lines
    .filter(l => !l.startsWith('#') && !l.startsWith('→') && !/^[①-⑩]/.test(l))
    .join(' ')
    .replace(/[#【】「」🙌✅❌💡🔥]/g, '')
    .trim()
    .slice(0, 80)

  if (bullets.length > 0) {
    return [
      `Infographic poster in Japanese career advice style.`,
      `Title text: "${title}"`,
      `Show ${bullets.length} numbered points as labeled boxes:`,
      bullets.map((b, i) => `${i + 1}. "${b}"`).join(', '),
      `Clean flat design, white background, blue and green accent colors.`,
      `Include icons next to each point. Modern professional layout.`,
      `Include English subtitle: "${bodyText.slice(0, 40)}"`,
    ].join(' ')
  }

  return [
    `Infographic poster about: "${title}".`,
    `Topic: ${bodyText}`,
    `Japanese career and job change advice. Clean flat design, pastel colors, minimal icons, professional layout.`,
  ].join(' ')
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { accountId, prompt, postContent, style, referenceImageBase64, referenceImageMimeType } = await req.json() as {
      accountId?: string
      prompt?: string
      postContent?: string
      style?: 'diagram' | 'infographic' | 'minimal'
      referenceImageBase64?: string
      referenceImageMimeType?: string
    }

    const basePrompt = prompt ?? (postContent ? buildImagePrompt(postContent) : null)
    if (!basePrompt) {
      return NextResponse.json({ error: 'prompt か postContent が必要です' }, { status: 400 })
    }

    // 参考画像があれば vision 分析して構造をプロンプトに合成
    let resolvedPrompt = basePrompt
    if (referenceImageBase64) {
      if (referenceImageBase64.length > MAX_REF_IMAGE_BYTES) {
        return NextResponse.json({ error: '参考画像のサイズが大きすぎます' }, { status: 400 })
      }
      const mime = referenceImageMimeType ?? 'image/png'
      if (!ALLOWED_REF_MIME.has(mime)) {
        return NextResponse.json({ error: '対応していない画像形式です' }, { status: 400 })
      }
      try {
        const structure = await analyzeImageStructure(referenceImageBase64, mime)
        if (structure) {
          resolvedPrompt = `${basePrompt}\n\nApply this visual design style as reference (do NOT copy text or specific subject matter, only the visual structure):\n${structure}`
        }
      } catch (e) {
        // vision 失敗時は参考画像なしで続行
        console.error('[generate/image] vision analysis failed:', e instanceof Error ? e.message : 'unknown')
      }
    }

    const userExtra = await fetchAccountPromptExtra(accountId, 'image')
    if (userExtra) {
      resolvedPrompt = `${resolvedPrompt}

[User-defined style preferences (apply if not conflicting)]
${userExtra.slice(0, 3000)}`
    }

    const imageUrl = await generateDiagramImage({ prompt: resolvedPrompt, style })
    return NextResponse.json({ imageUrl })
  } catch (e) {
    console.error('[generate/image]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '画像生成に失敗しました' }, { status: 500 })
  }
}
