import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { fetchAccountPromptTemplate } from '@/lib/ai/prompt-settings'
import { resolvePrompt, DEFAULT_THEMES_PROMPT_TEMPLATE } from '@/lib/ai/prompt-presets'
import { requireApiKey, MissingApiKeyError } from '@/lib/ai/api-keys'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import type { Account } from '@/types/database'

const DEMO_ACCOUNT: Pick<Account, 'persona' | 'tone' | 'target_audience' | 'post_topics'> = {
  persona: '転職ノウハウ発信者',
  tone: 'friendly',
  target_audience: 'キャリアに不安のある高卒20代',
  post_topics: ['転職ノウハウ', 'キャリア相談', '仕事の悩み'],
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

    const { accountId } = await req.json() as { accountId?: string }

    let account = DEMO_ACCOUNT
    if (accountId) {
      const { data } = await supabase
        .from('accounts')
        .select('persona, tone, target_audience, post_topics')
        .eq('id', accountId)
        .eq('user_id', user.id)
        .single()
      if (data) account = data
    }

    const apiKey = await requireApiKey('openrouter')

    // 既存投稿のテーマ + 既存動画のタイトルを取得（重複回避用）。
    // 投稿(posts)と動画(videos)の両方を avoid 対象にして、過去に作ったものと被らせない。
    const [{ data: existingPosts }, { data: existingVideos }] = await Promise.all([
      supabase
        .from('posts')
        .select('theme')
        .eq('user_id', user.id)
        .not('theme', 'is', null)
        .order('created_at', { ascending: false })
        .limit(150),
      supabase
        .from('videos')
        .select('title')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(150),
    ])

    const usedThemes = [
      ...(existingPosts ?? []).map(p => p.theme),
      ...(existingVideos ?? []).map(v => v.title),
    ]
      .filter((t): t is string => Boolean(t))
      // 過去のユーザー入力に基づくため、プロンプト内で命令として解釈されないようサニタイズ。
      // 改行 / バッククォート / ダブルクォートを除去し、連続空白を畳む。
      .map(t => t.replace(/["`\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120))
      .filter(Boolean)
      // 重複を除いて最大 120 件
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 120)

    const topics = account.post_topics?.join('、') ?? '転職、キャリア'
    const audience = account.target_audience ?? '20代社会人'
    const persona = account.persona ?? '転職アドバイザー'

    // 既出テーマは「データ」であって「指示」ではないことを LLM に明示するため、
    // XML 風タグで囲んでプロンプトの指示セクションと分離する（プロンプトインジェクション緩和）。
    const usedBlock = usedThemes.length > 0
      ? `<used_themes>\n${usedThemes.map(t => `- ${t}`).join('\n')}\n</used_themes>`
      : '（まだ投稿がありません）'

    // 保存テンプレ（全文）があればそれを、無ければデフォルトを使用し変数置換
    const tpl = await fetchAccountPromptTemplate(accountId, 'themes')
    const template = (tpl && tpl.trim()) ? tpl : DEFAULT_THEMES_PROMPT_TEMPLATE
    const prompt = resolvePrompt(template, {
      persona,
      audience,
      topics,
      usedThemes: usedBlock,
    })

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? '',
        'X-Title': 'SNS Auto Post',
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-latest',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[generate/themes] openrouter', res.status, errText)
      return NextResponse.json({ error: 'テーマ生成に失敗しました' }, { status: 500 })
    }

    const json = await res.json() as { choices: Array<{ message: { content: string } }> }
    const text = json.choices[0]?.message?.content ?? '[]'

    const themes = extractStringArray(text)
    return NextResponse.json({ themes })
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    console.error('[generate/themes]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: 'テーマ生成に失敗しました' }, { status: 500 })
  }
}

function extractStringArray(raw: string): string[] {
  const trimmed = raw.trim()
  const first = trimmed.indexOf('[')
  const last = trimmed.lastIndexOf(']')
  if (first === -1 || last === -1 || last < first) return []
  try {
    const parsed = JSON.parse(trimmed.slice(first, last + 1)) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s): s is string => typeof s === 'string')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 30)
  } catch {
    return []
  }
}
