/**
 * 外部 AI プロバイダ (OpenAI / OpenRouter) 由来のエラーを
 * 本番ログ・DB 向けに無害化するユーティリティ。
 *
 * 背景:
 *   OpenAI の 401 認証エラーメッセージは
 *     "Incorrect API key provided: sk-pr…XXXX. You can find your API key at …"
 *   のように API キーの断片を含む。これを console.error や videos.error_message に
 *   そのまま流すと、Vercel ログや DB（ひいては UI）にキー断片が残ってしまう。
 *
 * 方針:
 *   1. 401 / 403 認証エラーは固定文言に置換し、生メッセージを出さない（最優先・確実）
 *      → SDK 例外は status を持つので、これが最も信頼できる判定軸。
 *   2. "sk-…" を含むメッセージも（キー混入とみなして）固定文言に置換
 *      → status が失われた経路（例: 例外メッセージを連結して再 throw した後）向けの保険。
 *   3. それ以外のメッセージは保険として鍵 / トークン断片を正規表現でマスクして返す。
 */

// 認証系として固定文言に置換する HTTP ステータス
const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403])

// ログ本文の上限（プロバイダのエラー本文は HTML 等で長大になりうるため切り詰める）
const MAX_BODY_CHARS = 300

// マスク用パターン: 実トークン（十分長い連続列）だけを置換する。
// OpenAI: sk-..., sk-proj-... / OpenRouter: sk-or-v1-... はいずれも "sk-" 始まり。
// 長さ下限 {16,} を課すのは "task-list" や "disk-usage" のような通常語
// （語中に "sk-..." を含む）を誤マスクしないため。実キーは十分長い。
const KEY_MASK_PATTERN = /sk-[A-Za-z0-9_-]{16,}/g
// Authorization ヘッダがエラー本文に混入した場合の保険。
const BEARER_MASK_PATTERN = /Bearer\s+[A-Za-z0-9._-]{8,}/gi

// 検出用パターン: 語境界の直後に現れる "sk-…" を API キー混入の疑いとみなす。
//   ": sk-proj…" や 先頭の "sk-or-v1…" を捕捉する一方、"task-list" / "disk-usage"
//   のような語中の "sk-" は直前が英数字なので誤検出しない。
//   OpenAI が中央をアスタリスクで伏せた "sk-pr****…XXXX" 形式（長さベースの
//   マスク正規表現では捕捉できない）も、この境界判定なら検出できる。
const KEY_LEAK_PATTERN = /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9]/

/**
 * 文字列に含まれる API キー / Bearer トークンらしき断片をマスクする保険処理。
 * 機密でない通常のログ文字列はそのまま通過する。
 */
export function maskSecrets(input: string): string {
  return input.replace(KEY_MASK_PATTERN, 'sk-***').replace(BEARER_MASK_PATTERN, 'Bearer ***')
}

/** OpenAI SDK (APIError) は status、fetch 由来ラッパは statusCode を持つことがある。 */
function extractStatus(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null) {
    const obj = e as { status?: unknown; statusCode?: unknown }
    if (typeof obj.status === 'number') return obj.status
    if (typeof obj.statusCode === 'number') return obj.statusCode
  }
  return undefined
}

function toRawMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'unknown'
}

/** メッセージ本文にキー断片（"sk-…"）が混入しているか。 */
function containsKeyFragment(raw: string): boolean {
  // KEY_LEAK_PATTERN は g フラグ無しのため test() はステートレス（lastIndex 不要）。
  return KEY_LEAK_PATTERN.test(raw)
}

/**
 * catch した例外（OpenAI SDK エラー等）をログ / DB 用の安全な文字列へ変換する。
 *
 * @example
 *   } catch (e) {
 *     console.error('[generate/image]', sanitizeProviderError(e))
 *   }
 */
export function sanitizeProviderError(e: unknown): string {
  const status = extractStatus(e)
  const raw = toRawMessage(e)

  if ((status !== undefined && AUTH_STATUSES.has(status)) || containsKeyFragment(raw)) {
    return status !== undefined
      ? `認証エラー(${status})`
      : '認証エラー（APIキーが無効な可能性があります）'
  }

  // 認証以外は生メッセージを保ちつつ、保険としてキー断片をマスクする。
  return maskSecrets(raw)
}

/**
 * HTTP レスポンス (status + body) 由来のプロバイダエラーをログ用の安全な文字列へ変換する。
 * OpenRouter などの `if (!res.ok)` 分岐でのエラーログ用。
 *
 * @example
 *   const errText = await res.text().catch(() => '')
 *   console.error('[OpenRouter text]', sanitizeProviderHttpError(res.status, errText))
 */
export function sanitizeProviderHttpError(status: number, body: string): string {
  if (AUTH_STATUSES.has(status)) return `認証エラー(${status})`
  if (containsKeyFragment(body)) return `プロバイダエラー(${status})`

  const safeBody = maskSecrets(body).replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_CHARS)
  return safeBody ? `${status} ${safeBody}` : `プロバイダエラー(${status})`
}
