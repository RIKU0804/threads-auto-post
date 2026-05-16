// X (Twitter) API v2 adapter
// Docs: https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
// OAuth フローは廃止。アクセストークンは手動入力で受け取り、必要なら refresh のみ実行。

const X_API_BASE = 'https://api.twitter.com/2'
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token'
const REQUEST_TIMEOUT_MS = 30_000

export interface XTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface XTweetResult {
  id: string
  text: string
}

export class XAuthError extends Error {
  constructor(message = 'X access token expired or invalid') {
    super(message)
    this.name = 'XAuthError'
  }
}

async function xRequest<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${X_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[X API]', path, res.status, errText)
    if (res.status === 401 || res.status === 403) {
      throw new XAuthError()
    }
    throw new Error(`X API error (HTTP ${res.status})`)
  }
  return res.json() as Promise<T>
}

export async function createXTweet(
  accessToken: string,
  text: string,
  replyToId?: string
): Promise<XTweetResult> {
  const body: Record<string, unknown> = { text }
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId }

  const result = await xRequest<{ data: XTweetResult }>(
    '/tweets',
    accessToken,
    { method: 'POST', body: JSON.stringify(body) }
  )
  return result.data
}

export async function createXThread(
  accessToken: string,
  parts: string[]
): Promise<XTweetResult[]> {
  const results: XTweetResult[] = []
  for (const text of parts) {
    const replyToId = results.at(-1)?.id
    const tweet = await createXTweet(accessToken, text, replyToId)
    results.push(tweet)
  }
  return results
}

export async function getXMe(accessToken: string) {
  const result = await xRequest<{ data: { id: string; username: string; name: string } }>(
    '/users/me',
    accessToken
  )
  return result.data
}

/**
 * refresh_token と client_id/client_secret から access_token を再取得する。
 * 手動入力経路で refresh_token を持っているユーザー向け（X_CLIENT_ID/SECRET の env が必要）。
 */
export async function refreshXToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<XTokens> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })

  const res = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: params.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[X token refresh]', res.status, errText)
    throw new XAuthError(`X token refresh failed (HTTP ${res.status})`)
  }

  const data = await res.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}
