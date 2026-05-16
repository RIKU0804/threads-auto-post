import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { fetchAccountPromptExtra, appendUserExtra } from '@/lib/ai/prompt-settings'
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

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured')

    // 既存投稿のテーマ一覧を取得（重複回避用）
    const { data: existingPosts } = await supabase
      .from('posts')
      .select('theme, text_content')
      .eq('user_id', user.id)
      .not('theme', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200)

    const usedThemes = (existingPosts ?? [])
      .map(p => p.theme)
      .filter((t): t is string => Boolean(t))
      // 過去のユーザー入力に基づくため、プロンプト内で命令として解釈されないようサニタイズ
      .map(t => t.replace(/[\n\r`]/g, ' ').slice(0, 120))
      .slice(0, 100)

    const topics = account.post_topics?.join('、') ?? '転職、キャリア'
    const audience = account.target_audience ?? '20代社会人'
    const persona = account.persona ?? '転職アドバイザー'

    const avoidSection = usedThemes.length > 0
      ? `\n\n【すでに投稿済み・使用済みのテーマ（これらと被らないこと）】\n${usedThemes.map(t => `- ${t}`).join('\n')}`
      : ''

    const basePrompt = `${persona}として、${audience}向けのThreads投稿テーマを15個考えてください。
テーマ一覧：${topics}${avoidSection}

条件：
- 具体的で検索・共感されやすいタイトル
- バズ型・共感型・数字型・体験談型・問いかけ型をバランスよく混ぜる
- 各テーマは20〜40文字程度
- すでに投稿済みのテーマと内容・切り口が被らないこと
- 必ずJSON配列で返す

返答形式（他の文章は不要）：
["テーマ1", "テーマ2", "テーマ3", "テーマ4", "テーマ5", "テーマ6"]`

    const userExtra = await fetchAccountPromptExtra(accountId, 'themes')
    const prompt = appendUserExtra(basePrompt, userExtra)

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? '',
        'X-Title': 'SNS Auto Post',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
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
