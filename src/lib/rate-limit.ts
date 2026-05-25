import 'server-only'
import { createAdminClient } from '@/lib/supabase-admin'

export interface RateLimitResult {
  ok: boolean
  count: number
  limit: number
}

/**
 * 固定ウィンドウ方式のレート制限。
 * Supabase の increment_rate_limit() RPC でアトミックにカウント。
 *
 * failMode:
 *  - 'open'  : RPC 失敗時に通す（可用性優先。低リスクな bucket 用）
 *  - 'closed': RPC 失敗時にブロック（コスト保護が主目的の bucket 用）
 */
export async function checkRateLimit(
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
  failMode: 'open' | 'closed' = 'open',
): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('increment_rate_limit', {
      p_user_id: userId,
      p_bucket: bucket,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      console.error(JSON.stringify({ evt: 'rate_limit_rpc_error', bucket, msg: error.message }))
      return { ok: failMode === 'open', count: 0, limit }
    }
    const count = typeof data === 'number' ? data : 0
    return { ok: count <= limit, count, limit }
  } catch (e) {
    console.error(JSON.stringify({
      evt: 'rate_limit_exception', bucket,
      msg: e instanceof Error ? e.message : 'unknown',
    }))
    return { ok: failMode === 'open', count: 0, limit }
  }
}

/** プリセット（generate はコスト保護のため fail-closed） */
export const RATE_LIMITS = {
  generate:     { limit: 60, windowSeconds: 3600, failMode: 'closed' as const },
  apiKeys:      { limit: 20, windowSeconds: 3600, failMode: 'open' as const },
  heygenList:   { limit: 30, windowSeconds: 3600, failMode: 'open' as const },
  publishVideo: { limit: 30, windowSeconds: 3600, failMode: 'open' as const },
}
