// X (Twitter) API v2 adapter — OAuth 1.0a User Context 方式
// Developer Portal の「Keys and tokens」でボタン取得できる4キーで投稿する。
// （ブラウザ認可フロー不要。API Key / API Key Secret / Access Token / Access Token Secret）
// Docs: https://developer.twitter.com/en/docs/authentication/oauth-1-0a

import crypto from 'crypto'
import { PublishError } from './errors'

const X_API_BASE = 'https://api.twitter.com/2'
// v1.1 media/upload は 2025-06-09 に廃止済み。v2 へ移行。
// OAuth 1.0a User Context で利用可（multipart は署名ベースに oauth_* のみ含める＝
// 既存 buildOAuthHeader で正しく署名できる）。
const X_MEDIA_UPLOAD_URL = 'https://api.x.com/2/media/upload'
const REQUEST_TIMEOUT_MS = 30_000
const MEDIA_UPLOAD_TIMEOUT_MS = 60_000

export interface XCredentials {
  apiKey: string        // Consumer / API Key
  apiSecret: string     // Consumer / API Key Secret
  accessToken: string   // Access Token
  accessSecret: string  // Access Token Secret
}

interface XTweetResult {
  id: string
  text: string
}

export class XAuthError extends PublishError {
  constructor(
    message = 'X認証エラー (HTTP 401): API Key/Secret・Access Token/Secret のいずれかが無効です。Developer Portal の4キーを再確認してください。',
  ) {
    super('X_AUTH_401', message)
    this.name = 'XAuthError'
  }
}

// X API v2 のエラーボディから、機密を含まない説明文だけを取り出す。
// 形式例: { title, detail, reason, errors:[{message}] }
function parseXErrorDetail(raw: string): string {
  try {
    const j = JSON.parse(raw) as {
      title?: string
      detail?: string
      reason?: string
      errors?: Array<{ message?: string }>
    }
    return (j.detail || j.errors?.[0]?.message || j.title || j.reason || '').toString().slice(0, 200)
  } catch {
    return ''
  }
}

// HTTP ステータスごとに、原因が分かる安全なエラーを投げる。
// authMode により 403 の復旧手順を出し分ける（OAuth2=再連携 / OAuth1=トークン再生成）。
function throwXHttpError(
  method: string,
  path: string,
  status: number,
  raw: string,
  authMode: XAuth['mode'] = 'oauth1',
): never {
  console.error('[X API]', method, path, status, raw.slice(0, 300))
  const detail = parseXErrorDetail(raw)
  if (status === 401) {
    throw new XAuthError()
  }
  if (status === 403) {
    // 403「You are not permitted to perform this action」= 実効トークンに書き込み権限が無い。
    // 原因は X アプリの App permissions が「Read」のまま、または権限付与前のトークン。
    const recovery =
      authMode === 'oauth2'
        ? 'X Developer Portal →「User authentication settings」で App permissions を「Read and write」にして保存したうえで、アプリの「Xと連携」からもう一度【再連携】してください（権限変更前に連携したトークンは書き込み不可のままです）。'
        : 'X Developer Portal でアプリ権限を「Read and write」にして保存したうえで、「Keys and tokens」で Access Token / Secret を【再生成】し、登録し直してください（権限変更前のトークンは読み取り専用のままです）。'
    throw new PublishError(
      'X_FORBIDDEN_403',
      `X投稿が拒否されました (HTTP 403)。アプリに「書き込み(Write)」権限が無い可能性が高いです。${recovery}${detail ? ` / X詳細: ${detail}` : ''}`,
    )
  }
  if (status === 429) {
    throw new PublishError(
      'X_RATE_LIMIT_429',
      'Xのレート制限に達しました (HTTP 429)。しばらく時間をおいてから再投稿してください。',
    )
  }
  throw new PublishError('X_HTTP_' + status, `Xエラー (HTTP ${status})${detail ? `: ${detail}` : ''}`)
}

// RFC3986 パーセントエンコード
function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

/**
 * OAuth 1.0a Authorization ヘッダを生成。
 * JSON body の場合、署名ベース文字列には oauth_* パラメータのみ含める（body は除外）。
 */
function buildOAuthHeader(
  method: 'GET' | 'POST',
  url: string,
  cred: XCredentials,
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: cred.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: cred.accessToken,
    oauth_version: '1.0',
  }

  const paramStr = Object.keys(oauth)
    .sort()
    .map(k => `${pctEncode(k)}=${pctEncode(oauth[k])}`)
    .join('&')

  const baseString = `${method}&${pctEncode(url)}&${pctEncode(paramStr)}`
  const signingKey = `${pctEncode(cred.apiSecret)}&${pctEncode(cred.accessSecret)}`
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64')

  const headerParams: Record<string, string> = { ...oauth, oauth_signature: signature }
  return (
    'OAuth ' +
    Object.keys(headerParams)
      .sort()
      .map(k => `${pctEncode(k)}="${pctEncode(headerParams[k])}"`)
      .join(', ')
  )
}

/**
 * 投稿時の認証情報。OAuth 1.0a（手動4キー / HMAC-SHA1 署名）と
 * OAuth 2.0（ブラウザ認可で得た User Access Token / Bearer）を統一的に扱う。
 */
export type XAuth =
  | { mode: 'oauth1'; cred: XCredentials }
  | { mode: 'oauth2'; accessToken: string }

function buildAuthHeader(method: 'GET' | 'POST', url: string, auth: XAuth): string {
  if (auth.mode === 'oauth2') return `Bearer ${auth.accessToken}`
  return buildOAuthHeader(method, url, auth.cred)
}

async function xPost<T>(path: string, auth: XAuth, body: unknown): Promise<T> {
  const url = `${X_API_BASE}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader('POST', url, auth),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throwXHttpError('POST', path, res.status, errText, auth.mode)
  }
  return res.json() as Promise<T>
}

async function xGet<T>(
  path: string,
  auth: XAuth,
): Promise<{ data: T; accessLevel: string | null }> {
  const url = `${X_API_BASE}${path}`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: buildAuthHeader('GET', url, auth) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throwXHttpError('GET', path, res.status, errText, auth.mode)
  }
  // x-access-level: トークンの実効権限を表す。read / read-write / read-write-directmessages。
  // 認証付き読み取りリクエストでも返るため、投稿を試す前に「読み取り専用」を検知できる。
  // Docs: https://developer.twitter.com/en/docs/apps/app-permissions
  const accessLevel = res.headers.get('x-access-level')
  return { data: (await res.json()) as T, accessLevel }
}

/**
 * 画像を X にアップロードして media_id を得る（v2 /2/media/upload, simple upload）。
 * multipart/form-data なので OAuth 署名ベースには oauth_* のみ含める
 * （buildOAuthHeader と同じ挙動でそのまま使える）。
 * v2 のレスポンスは { data: { id, media_key, ... } } で、id を media_id として使う。
 */
export async function uploadXMedia(
  auth: XAuth,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const form = new FormData()
  form.append('media', new Blob([bytes as BlobPart], { type: mimeType }))
  form.append('media_category', 'tweet_image')
  form.append('media_type', mimeType)

  const res = await fetch(X_MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: buildAuthHeader('POST', X_MEDIA_UPLOAD_URL, auth) },
    body: form,
    signal: AbortSignal.timeout(MEDIA_UPLOAD_TIMEOUT_MS),
  })

  const raw = await res.text().catch(() => '')
  if (!res.ok) {
    throwXHttpError('POST', '/2/media/upload', res.status, raw, auth.mode)
  }

  // HTTP 200 でも data 不在 / errors を返す場合があるため明示的に検査
  let mediaId: string | undefined
  try {
    const json = JSON.parse(raw) as {
      data?: { id?: string }
      errors?: unknown
    }
    mediaId = json.data?.id
    if (!mediaId && json.errors) {
      console.error('[X API]', '/2/media/upload returned errors', JSON.stringify(json.errors).slice(0, 300))
    }
  } catch {
    console.error('[X API]', '/2/media/upload non-JSON response', raw.slice(0, 200))
  }
  if (!mediaId) throw new PublishError('X_MEDIA_UPLOAD', 'X画像アップロードに失敗しました（media_id を取得できませんでした）')
  return mediaId
}

export async function createXTweet(
  auth: XAuth,
  text: string,
  replyToId?: string,
  mediaIds?: string[],
): Promise<XTweetResult> {
  const body: Record<string, unknown> = { text }
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId }
  if (mediaIds && mediaIds.length > 0) body.media = { media_ids: mediaIds }
  const result = await xPost<{ data: XTweetResult }>('/tweets', auth, body)
  return result.data
}

export async function createXThread(
  auth: XAuth,
  parts: string[],
  mediaIds?: string[],
): Promise<XTweetResult[]> {
  const results: XTweetResult[] = []
  for (let i = 0; i < parts.length; i++) {
    const replyToId = results.at(-1)?.id
    // 画像はスレッド先頭ツイートにのみ添付
    results.push(await createXTweet(auth, parts[i], replyToId, i === 0 ? mediaIds : undefined))
  }
  return results
}

export async function getXMe(
  auth: XAuth,
): Promise<{ id: string; username: string; name: string; accessLevel: string | null }> {
  const { data: body, accessLevel } = await xGet<{ data: { id: string; username: string; name: string } }>(
    '/users/me',
    auth,
  )
  return { ...body.data, accessLevel }
}

/** x-access-level が書き込み可能（read-write 系）かどうか。read のとき false。 */
export function isXWritable(accessLevel: string | null): boolean {
  // ヘッダ未取得(null)時は誤ブロックを避けて投稿を許可（フェイルオープン）。
  // 明示的に "read" のときだけ読み取り専用と判定する。
  return accessLevel !== 'read'
}
