import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { maskApiKey } from '@/lib/ai/api-keys'
import { encryptSecret, decryptSecret, isEncryptionAvailable } from '@/lib/crypto'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

const MAX_KEY_LEN = 500

interface ResponseShape {
  openrouter_masked: string | null
  openai_masked: string | null
  elevenlabs_masked: string | null
  heygen_masked: string | null
  has_openrouter: boolean
  has_openai: boolean
  has_elevenlabs: boolean
  has_heygen: boolean
  updated_at: string | null
}

function emptyResponse(): ResponseShape {
  return {
    openrouter_masked: null,
    openai_masked: null,
    elevenlabs_masked: null,
    heygen_masked: null,
    has_openrouter: false,
    has_openai: false,
    has_elevenlabs: false,
    has_heygen: false,
    updated_at: null,
  }
}

function toResponse(
  openrouterStored: string | null,
  openaiStored: string | null,
  elevenlabsStored: string | null,
  heygenStored: string | null,
  updatedAt: string | null,
): ResponseShape {
  const or = decryptSecret(openrouterStored)
  const oa = decryptSecret(openaiStored)
  const el = decryptSecret(elevenlabsStored)
  const hg = decryptSecret(heygenStored)
  return {
    openrouter_masked: maskApiKey(or),
    openai_masked: maskApiKey(oa),
    elevenlabs_masked: maskApiKey(el),
    heygen_masked: maskApiKey(hg),
    has_openrouter: !!or,
    has_openai: !!oa,
    has_elevenlabs: !!el,
    has_heygen: !!hg,
    updated_at: updatedAt,
  }
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const { data } = await supabase
      .from('user_api_keys')
      .select('openrouter_key, openai_key, elevenlabs_key, heygen_key, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!data) return NextResponse.json(emptyResponse())
    return NextResponse.json(
      toResponse(
        data.openrouter_key,
        data.openai_key,
        data.elevenlabs_key,
        data.heygen_key,
        data.updated_at ?? null,
      ),
    )
  } catch (e) {
    console.error('[api-keys GET]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
}

/**
 * 値を保存用に正規化:
 *  - undefined / 空文字 → "変更しない" (= symbol KEEP)
 *  - null → 削除 (DB NULL)
 *  - string → 暗号化して保存
 */
const KEEP = Symbol('keep')

function normalize(v: unknown): string | null | typeof KEEP {
  if (v === undefined) return KEEP
  if (v === null) return null
  if (typeof v !== 'string') return KEEP
  const trimmed = v.trim()
  if (!trimmed) return KEEP // 空欄は誤削除防止のため「変更しない」
  return encryptSecret(trimmed.slice(0, MAX_KEY_LEN))
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

    const rl = await checkRateLimit(user.id, 'api_keys', RATE_LIMITS.apiKeys.limit, RATE_LIMITS.apiKeys.windowSeconds, RATE_LIMITS.apiKeys.failMode)
    if (!rl.ok) {
      return NextResponse.json(
        { error: '更新が多すぎます。しばらくしてからお試しください。', code: 'RATE_LIMITED' },
        { status: 429 },
      )
    }

    if (!isEncryptionAvailable()) {
      console.error('[api-keys PUT] ENCRYPTION_KEY not configured')
      return NextResponse.json(
        { error: 'サーバー側の暗号化設定が未完了です。管理者にお問い合わせください。' },
        { status: 503 },
      )
    }

    const body = await req.json() as {
      openrouterKey?: unknown
      openaiKey?: unknown
      elevenlabsKey?: unknown
      heygenKey?: unknown
    }

    const orVal = normalize(body.openrouterKey)
    const oaVal = normalize(body.openaiKey)
    const elVal = normalize(body.elevenlabsKey)
    const hgVal = normalize(body.heygenKey)

    // 既存行の有無で insert / update を分岐（部分更新でアトミック性を保つ）
    const { data: existing } = await supabase
      .from('user_api_keys')
      .select('openrouter_key, openai_key, elevenlabs_key, heygen_key')
      .eq('user_id', user.id)
      .maybeSingle()

    const nowIso = new Date().toISOString()

    if (!existing) {
      const { error } = await supabase.from('user_api_keys').insert({
        user_id: user.id,
        openrouter_key: orVal === KEEP ? null : orVal,
        openai_key: oaVal === KEEP ? null : oaVal,
        elevenlabs_key: elVal === KEEP ? null : elVal,
        heygen_key: hgVal === KEEP ? null : hgVal,
        updated_at: nowIso,
      })
      if (error) throw error
      return NextResponse.json(
        toResponse(
          orVal === KEEP ? null : orVal,
          oaVal === KEEP ? null : oaVal,
          elVal === KEEP ? null : elVal,
          hgVal === KEEP ? null : hgVal,
          nowIso,
        ),
      )
    }

    const updates: Record<string, string | null> = { updated_at: nowIso }
    if (orVal !== KEEP) updates.openrouter_key = orVal
    if (oaVal !== KEEP) updates.openai_key = oaVal
    if (elVal !== KEEP) updates.elevenlabs_key = elVal
    if (hgVal !== KEEP) updates.heygen_key = hgVal

    const { error } = await supabase
      .from('user_api_keys')
      .update(updates)
      .eq('user_id', user.id)
    if (error) throw error

    const finalOr = orVal === KEEP ? existing.openrouter_key : orVal
    const finalOa = oaVal === KEEP ? existing.openai_key : oaVal
    const finalEl = elVal === KEEP ? (existing as { elevenlabs_key?: string | null }).elevenlabs_key ?? null : elVal
    const finalHg = hgVal === KEEP ? (existing as { heygen_key?: string | null }).heygen_key ?? null : hgVal
    return NextResponse.json(toResponse(finalOr, finalOa, finalEl, finalHg, nowIso))
  } catch (e) {
    console.error('[api-keys PUT]', e instanceof Error ? e.message : 'unknown')
    return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
  }
}
