import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { generateSNSText } from '@/lib/ai/text'
import { fetchAccountPromptTemplate } from '@/lib/ai/prompt-settings'
import { requireApiKey, MissingApiKeyError } from '@/lib/ai/api-keys'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { sanitizeProviderError } from '@/lib/ai/sanitize-error'
import type { Account } from '@/types/database'

// アカウントなし時のデフォルト設定
const DEMO_ACCOUNT: Account = {
  id: 'demo',
  user_id: 'demo',
  platform: 'threads',
  name: 'デモ',
  persona: '転職ノウハウ発信者',
  tone: 'friendly',
  target_audience: 'キャリアに不安のある高卒20代',
  post_topics: ['転職ノウハウ', 'キャリア相談', '仕事の悩み'],
  access_token: null,
  token_expires_at: null,
  threads_user_id: null,
  threads_client_id: null,
  threads_client_secret: null,
  instagram_user_id: null,
  x_user_id: null,
  x_api_key: null,
  x_api_secret: null,
  x_access_secret: null,
  tiktok_open_id: null,
  tiktok_refresh_token: null,
  youtube_channel_id: null,
  youtube_refresh_token: null,
  is_active: false,
  created_at: '',
  updated_at: '',
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

    const body = await req.json() as {
      accountId?: string
      theme?: string
      postType?: string
      referencePost?: string
      referenceAccountName?: string
      draftId?: string
    }
    const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, 200) : ''
    if (!theme) {
      return NextResponse.json({ error: 'theme は必須です' }, { status: 400 })
    }
    const postType = typeof body.postType === 'string' ? body.postType.slice(0, 50) : undefined
    const referencePost = typeof body.referencePost === 'string'
      ? body.referencePost.slice(0, 2000)
      : undefined
    const referenceAccountName = typeof body.referenceAccountName === 'string'
      ? body.referenceAccountName.trim().slice(0, 80).replace(/[<>]/g, '')
      : undefined
    const accountId = typeof body.accountId === 'string' ? body.accountId : undefined

    let account: Account = DEMO_ACCOUNT
    let recentSummaries: string[] = []

    // アカウントIDが指定されている場合のみDB参照
    if (accountId) {
      const [{ data: accountData, error }, { data: recentPosts }] = await Promise.all([
        supabase
          .from('accounts')
          .select('*')
          .eq('id', accountId)
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('posts')
          .select('summary')
          .eq('account_id', accountId)
          .not('summary', 'is', null)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      if (error || !accountData) {
        return NextResponse.json({ error: 'アカウントが見つかりません' }, { status: 404 })
      }

      account = accountData
      recentSummaries = (recentPosts ?? [])
        .map(p => p.summary as string)
        .filter(Boolean)
    }

    const apiKey = await requireApiKey('openrouter')
    const promptTemplate = await fetchAccountPromptTemplate(accountId, 'text')

    const result = await generateSNSText({
      account,
      theme,
      postType,
      recentSummaries,
      referencePost,
      referenceAccountName,
      promptTemplate,
      apiKey,
    })

    // 生成完了時に下書きを自動保存（ページ離脱しても結果が残る）
    // 再生成時は既存 draftId を更新し、下書きの乱立を防ぐ
    let draftId = typeof body.draftId === 'string' && body.draftId ? body.draftId : null
    const draftFields = {
      text_content: result.content,
      summary: result.summary || null,
      theme: theme || null,
    }
    try {
      if (draftId) {
        const { data: updated } = await supabase
          .from('posts')
          .update(draftFields)
          .eq('id', draftId)
          .eq('user_id', user.id)
          .select('id')
          .maybeSingle()
        if (!updated) draftId = null // 他人/不正な id は無視して新規作成へ
      }
      if (!draftId) {
        const { data: inserted } = await supabase
          .from('posts')
          .insert({
            user_id: user.id,
            account_id: accountId ?? null,
            status: 'draft',
            ...draftFields,
          })
          .select('id')
          .single()
        draftId = inserted?.id ?? null
        if (draftId) {
          await supabase.from('post_logs').insert({
            post_id: draftId, action: 'generated', message: '自動下書き保存',
          })
        }
      }
    } catch (e) {
      // 下書き保存に失敗しても生成結果自体は返す（致命にしない）
      console.error('[generate/text] draft autosave failed', e instanceof Error ? e.message : 'unknown')
    }

    return NextResponse.json({ ...result, draftId })
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    console.error('[generate/text]', sanitizeProviderError(e))
    return NextResponse.json({ error: '生成に失敗しました' }, { status: 500 })
  }
}
