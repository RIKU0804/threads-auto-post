// TikTok Content Posting API adapter（OAuth 2.0 / Direct Post 方式）
//
// ※ このモジュールは現状どこからも import されていない。将来 TikTok 連携を
//   有効化する際に publishers.ts / Platform 型 / UI に組み込む前提の下準備コード。
//   （ユーザー要望: コードだけ用意し UI には出さない）
//
// Docs:
// - Content Posting API: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post/
// - OAuth:               https://developers.tiktok.com/doc/oauth-user-access-token-management/
//
// TikTok は動画前提のプラットフォーム。Direct Post は
//   1) creator_info/query で投稿可能か（privacy options 等）を確認
//   2) post/publish/video/init で PULL_FROM_URL もしくは FILE_UPLOAD を開始
//   3) post/publish/status/fetch で公開完了をポーリング
// という 3 ステップ。ここでは公開動画 URL を渡す PULL_FROM_URL を実装する。

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2'
const TIKTOK_OAUTH_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const REQUEST_TIMEOUT_MS = 30_000

export interface TikTokCredentials {
  /** OAuth 2.0 User Access Token */
  accessToken: string
}

export type TikTokPrivacy =
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR'
  | 'SELF_ONLY'

export interface CreateTikTokVideoOptions {
  /** 公開アクセス可能な https の動画 URL（PULL_FROM_URL で TikTok 側が取得） */
  videoUrl: string
  /** キャプション（本文）。ハッシュタグ・メンション込みで可 */
  title: string
  privacyLevel?: TikTokPrivacy
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
}

export interface TikTokInitResult {
  /** 公開ステータス確認に使う publish_id */
  publishId: string
}

export interface TikTokCreatorInfo {
  creatorUsername: string
  creatorNickname: string
  privacyLevelOptions: string[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxVideoPostDurationSec: number
}

export interface TikTokUser {
  openId: string
  unionId?: string
  displayName?: string
}

export interface TikTokPublishStatus {
  /** PROCESSING_UPLOAD | PROCESSING_DOWNLOAD | SEND_TO_USER_INBOX | PUBLISH_COMPLETE | FAILED 等 */
  status: string
  failReason?: string
  publiclyAvailablePostId?: string[]
}

export interface TikTokRefreshResult {
  accessToken: string
  refreshToken: string
  /** epoch ミリ秒 */
  expiresAt: number
}

export class TikTokAuthError extends Error {
  constructor(message = 'TikTok アクセストークンが無効または期限切れです') {
    super(message)
    this.name = 'TikTokAuthError'
  }
}

interface TikTokEnvelope<T> {
  data?: T
  error?: { code?: string; message?: string; log_id?: string }
}

async function tiktokRequest<T>(
  path: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${TIKTOK_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[TikTok API]', 'POST', path, res.status, errText)
    if (res.status === 401 || res.status === 403) throw new TikTokAuthError()
    throw new Error(`TikTok API error (HTTP ${res.status})`)
  }

  const json = (await res.json()) as TikTokEnvelope<T>
  // TikTok は HTTP 200 でも error.code !== 'ok' で失敗を返すことがある
  const code = json.error?.code
  if (code && code !== 'ok') {
    console.error('[TikTok API]', 'POST', path, 'error', JSON.stringify(json.error))
    if (code === 'access_token_invalid' || code === 'scope_not_authorized') {
      throw new TikTokAuthError()
    }
    throw new Error(`TikTok API error (${code}: ${json.error?.message ?? 'unknown'})`)
  }
  return (json.data ?? ({} as T)) as T
}

/**
 * Direct Post の事前確認。privacy options 等が取れない場合は連携不備。
 */
export async function getTikTokCreatorInfo(
  cred: TikTokCredentials,
): Promise<TikTokCreatorInfo> {
  const data = await tiktokRequest<{
    creator_username: string
    creator_nickname: string
    privacy_level_options: string[]
    comment_disabled: boolean
    duet_disabled: boolean
    stitch_disabled: boolean
    max_video_post_duration_sec: number
  }>('/post/publish/creator_info/query/', cred.accessToken)

  return {
    creatorUsername: data.creator_username,
    creatorNickname: data.creator_nickname,
    privacyLevelOptions: data.privacy_level_options ?? [],
    commentDisabled: !!data.comment_disabled,
    duetDisabled: !!data.duet_disabled,
    stitchDisabled: !!data.stitch_disabled,
    maxVideoPostDurationSec: data.max_video_post_duration_sec ?? 0,
  }
}

/**
 * 公開 URL の動画を Direct Post（PULL_FROM_URL）。
 * 戻り値の publishId を getTikTokPublishStatus でポーリングして公開完了を確認する。
 * 注意: PULL_FROM_URL の場合、URL ドメインが TikTok 開発者ポータルで
 *       URL prefix 検証済みである必要がある。
 */
export async function createTikTokVideoPost(
  cred: TikTokCredentials,
  opts: CreateTikTokVideoOptions,
): Promise<TikTokInitResult> {
  if (!/^https:\/\//i.test(opts.videoUrl)) {
    throw new Error('TikTok の動画URLは https:// で始まる必要があります')
  }

  const data = await tiktokRequest<{ publish_id: string }>(
    '/post/publish/video/init/',
    cred.accessToken,
    {
      post_info: {
        title: opts.title.slice(0, 2200),
        privacy_level: opts.privacyLevel ?? 'SELF_ONLY',
        disable_comment: opts.disableComment ?? false,
        disable_duet: opts.disableDuet ?? false,
        disable_stitch: opts.disableStitch ?? false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: opts.videoUrl,
      },
    },
  )

  if (!data.publish_id) throw new Error('TikTok: publish_id を取得できませんでした')
  return { publishId: data.publish_id }
}

export async function getTikTokPublishStatus(
  cred: TikTokCredentials,
  publishId: string,
): Promise<TikTokPublishStatus> {
  const data = await tiktokRequest<{
    status: string
    fail_reason?: string
    publicaly_available_post_id?: string[]
    publicly_available_post_id?: string[]
  }>('/post/publish/status/fetch/', cred.accessToken, { publish_id: publishId })

  return {
    status: data.status,
    failReason: data.fail_reason,
    // TikTok のレスポンスはタイポ揺れがあるため両方拾う
    publiclyAvailablePostId:
      data.publicly_available_post_id ?? data.publicaly_available_post_id,
  }
}

export async function getTikTokUser(cred: TikTokCredentials): Promise<TikTokUser> {
  const res = await fetch(
    `${TIKTOK_API_BASE}/user/info/?fields=open_id,union_id,display_name`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${cred.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[TikTok API]', 'GET', '/user/info', res.status, errText)
    if (res.status === 401 || res.status === 403) throw new TikTokAuthError()
    throw new Error(`TikTok API error (HTTP ${res.status})`)
  }
  const json = (await res.json()) as TikTokEnvelope<{
    user: { open_id: string; union_id?: string; display_name?: string }
  }>
  const u = json.data?.user
  if (!u?.open_id) throw new Error('TikTok: ユーザー情報を取得できませんでした')
  return { openId: u.open_id, unionId: u.union_id, displayName: u.display_name }
}

/**
 * Refresh token で User Access Token を更新。
 * client_key / client_secret は TikTok 開発者ポータルのアプリ資格情報。
 */
export async function refreshTikTokToken(
  clientKey: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TikTokRefreshResult> {
  const res = await fetch(TIKTOK_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[TikTok OAuth]', 'refresh', res.status, errText)
    throw new TikTokAuthError('TikTok トークンのリフレッシュに失敗しました')
  }

  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
  }
  if (!json.access_token || !json.refresh_token) {
    throw new TikTokAuthError('TikTok トークンのリフレッシュに失敗しました')
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 86400) * 1000,
  }
}
