import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase'
import { decryptSecret } from '@/lib/crypto'

export type ApiKeyProvider = 'openrouter' | 'openai'

export class MissingApiKeyError extends Error {
  constructor(public provider: ApiKeyProvider) {
    super(`${provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} の API キーが設定されていません。「設定」ページから登録してください。`)
    this.name = 'MissingApiKeyError'
  }
}

interface FetchedKeys {
  openrouter: string | null
  openai: string | null
}

/**
 * 認証ユーザーの API キーを DB から取得する。
 * RLS で本人のものしか引けない。未認証 / 未設定なら null。
 */
export async function fetchUserApiKeys(): Promise<FetchedKeys> {
  const empty: FetchedKeys = { openrouter: null, openai: null }
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return empty

    const { data } = await supabase
      .from('user_api_keys')
      .select('openrouter_key, openai_key')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!data) return empty

    // 移行前の平文レコード（v1: プレフィックス無し）を検知して監視ログを出す
    const isPlaintext = (v: string | null) =>
      typeof v === 'string' && v.length > 0 && !v.startsWith('v1:')
    if (isPlaintext(data.openrouter_key) || isPlaintext(data.openai_key)) {
      console.warn(JSON.stringify({
        evt: 'api_key_plaintext_in_use',
        user_id: user.id,
        hint: 'ENCRYPTION_KEY 設定後に「設定」ページで再保存すると暗号化されます',
      }))
    }

    return {
      openrouter: decryptSecret(data.openrouter_key)?.trim() || null,
      openai: decryptSecret(data.openai_key)?.trim() || null,
    }
  } catch (e) {
    console.error('[api-keys fetch]', e instanceof Error ? e.message : 'unknown')
    return empty
  }
}

/**
 * 指定プロバイダのキーを要求。未設定なら MissingApiKeyError を throw。
 */
export async function requireApiKey(provider: ApiKeyProvider): Promise<string> {
  const keys = await fetchUserApiKeys()
  const key = provider === 'openrouter' ? keys.openrouter : keys.openai
  if (!key) throw new MissingApiKeyError(provider)
  return key
}

/**
 * 表示用にキーをマスクする (最初4 + 末尾4のみ表示、間は ...)
 */
export function maskApiKey(key: string | null): string | null {
  if (!key) return null
  if (key.length < 16) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
