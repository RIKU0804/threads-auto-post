// YouTube Data API v3 adapter（OAuth 2.0 / レジューマブルアップロード）
//
// ※ このモジュールは現状どこからも import されていない。将来 YouTube 連携を
//   有効化する際に publishers.ts / Platform 型 / UI に組み込む前提の下準備コード。
//   （ユーザー要望: コードだけ用意し UI には出さない）
//
// Docs:
// - Videos: insert:   https://developers.google.com/youtube/v3/docs/videos/insert
// - Resumable upload:  https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
// - OAuth refresh:     https://developers.google.com/identity/protocols/oauth2/web-server#offline
//
// YouTube は動画前提。アップロードは 2 ステップ:
//   1) resumable セッション開始（メタデータ JSON を POST → Location ヘッダに upload URL）
//   2) その URL に動画バイト列を PUT
// Shorts にしたい場合は description / title に #Shorts を含める運用。

const YT_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'
const YT_API_BASE = 'https://www.googleapis.com/youtube/v3'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REQUEST_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 180_000

export interface YouTubeCredentials {
  /** OAuth 2.0 Access Token（scope: youtube.upload） */
  accessToken: string
}

export type YouTubePrivacy = 'public' | 'unlisted' | 'private'

export interface UploadYouTubeVideoOptions {
  /** 動画バイト列 */
  videoBytes: Uint8Array
  videoMimeType?: string
  title: string
  description?: string
  tags?: string[]
  privacyStatus?: YouTubePrivacy
  /** YouTube カテゴリ ID（22 = People & Blogs が無難なデフォルト） */
  categoryId?: string
  /** 子ども向け表記。false=「子ども向けではない」 */
  madeForKids?: boolean
}

export interface YouTubeVideoResult {
  id: string
  /** https://youtu.be/<id> */
  url: string
}

export interface YouTubeChannel {
  id: string
  title: string
}

export interface YouTubeRefreshResult {
  accessToken: string
  /** epoch ミリ秒 */
  expiresAt: number
}

export class YouTubeAuthError extends Error {
  constructor(message = 'YouTube アクセストークンが無効または期限切れです') {
    super(message)
    this.name = 'YouTubeAuthError'
  }
}

// NOTE: 公開URLから動画バイト列を取得するヘルパーは SSRF 防御を持つ
// `fetchVideoBytesSafe` を publishers.ts 内に集約済み。ここからは export しない。

/**
 * レジューマブルアップロードで動画を投稿。
 * 大きな動画はチャンク再開が望ましいが、ここでは単一 PUT のシンプル実装。
 */
export async function uploadYouTubeVideo(
  cred: YouTubeCredentials,
  opts: UploadYouTubeVideoOptions,
): Promise<YouTubeVideoResult> {
  const metadata = {
    snippet: {
      title: opts.title.slice(0, 100),
      description: (opts.description ?? '').slice(0, 5000),
      tags: opts.tags?.slice(0, 30),
      categoryId: opts.categoryId ?? '22',
    },
    status: {
      privacyStatus: opts.privacyStatus ?? 'private',
      selfDeclaredMadeForKids: opts.madeForKids ?? false,
    },
  }

  // 1) resumable セッション開始
  const initRes = await fetch(YT_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cred.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': opts.videoMimeType ?? 'video/mp4',
      'X-Upload-Content-Length': String(opts.videoBytes.byteLength),
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => '')
    console.error('[YouTube API]', 'init', initRes.status, errText)
    if (initRes.status === 401 || initRes.status === 403) throw new YouTubeAuthError()
    throw new Error(`YouTube API error (HTTP ${initRes.status})`)
  }

  const uploadUrl = initRes.headers.get('location')
  if (!uploadUrl) {
    throw new Error('YouTube: アップロードセッションURLを取得できませんでした')
  }

  // 2) 動画バイト列を PUT
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': opts.videoMimeType ?? 'video/mp4',
      'Content-Length': String(opts.videoBytes.byteLength),
    },
    body: opts.videoBytes as BodyInit,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  })

  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => '')
    console.error('[YouTube API]', 'upload', putRes.status, errText)
    if (putRes.status === 401 || putRes.status === 403) throw new YouTubeAuthError()
    throw new Error(`YouTube upload error (HTTP ${putRes.status})`)
  }

  const json = (await putRes.json()) as { id?: string }
  if (!json.id) throw new Error('YouTube: 動画IDを取得できませんでした')
  return { id: json.id, url: `https://youtu.be/${json.id}` }
}

export async function getYouTubeChannel(
  cred: YouTubeCredentials,
): Promise<YouTubeChannel> {
  const res = await fetch(`${YT_API_BASE}/channels?part=snippet&mine=true`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cred.accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[YouTube API]', 'channels', res.status, errText)
    if (res.status === 401 || res.status === 403) throw new YouTubeAuthError()
    throw new Error(`YouTube API error (HTTP ${res.status})`)
  }
  const json = (await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>
  }
  const ch = json.items?.[0]
  if (!ch?.id) throw new Error('YouTube: チャンネル情報を取得できませんでした')
  return { id: ch.id, title: ch.snippet?.title ?? '' }
}

/**
 * Refresh token で Access Token を更新（Google OAuth 2.0）。
 * client_id / client_secret は Google Cloud Console の OAuth クライアント資格情報。
 */
export async function refreshYouTubeToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<YouTubeRefreshResult> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    // トークンエンドポイントのエラーボディは秘密情報をエコーし得るため status のみ記録
    console.error('[YouTube OAuth]', 'refresh failed', res.status)
    throw new YouTubeAuthError('YouTube トークンのリフレッシュに失敗しました')
  }

  const json = (await res.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!json.access_token) {
    throw new YouTubeAuthError('YouTube トークンのリフレッシュに失敗しました')
  }
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}
