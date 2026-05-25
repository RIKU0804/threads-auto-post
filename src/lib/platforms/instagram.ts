// Instagram Graph API adapter
// Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
// Token はすべて Authorization: Bearer ヘッダーで送信（URL query への露出を避ける）

const IG_API_BASE = 'https://graph.facebook.com/v21.0'
const REQUEST_TIMEOUT_MS = 30_000

/** Instagram キャプション上限 (Reels / Feed 共通) — 単一情報源 */
export const INSTAGRAM_CAPTION_MAX = 2200

interface InstagramCredentials {
  accessToken: string
  igUserId: string
}

interface CreatePostOptions {
  caption: string
  imageUrl: string
}

interface InstagramPostResult {
  id: string
}

export interface InstagramReelPostResult {
  /** media_publish 後の最終的な公開メディア ID */
  mediaId: string
  /** /media で作成した中間コンテナ ID（poll/publish のリトライ・回収用に永続化推奨） */
  containerId: string
}

export interface InstagramTokenRefreshResult {
  accessToken: string
  /** epoch ミリ秒 */
  expiresAt: number
}

export class InstagramAuthError extends Error {
  constructor(message = 'Instagram access token expired or invalid') {
    super(message)
    this.name = 'InstagramAuthError'
  }
}

async function igRequest<T>(
  path: string,
  accessToken: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, string> } = {},
): Promise<T> {
  const { method = 'GET', body } = options
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }
  if (method === 'POST' && body) {
    init.headers = { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' }
    init.body = new URLSearchParams(body).toString()
  }

  const res = await fetch(`${IG_API_BASE}${path}`, init)
  if (!res.ok) {
    // 機密情報 (token / 内部メタデータ等) は出力しない。status と path のみ。
    // 詳細が必要な場合は呼び出し側で thrown Error の message を見る。
    console.error('[Instagram API]', method, path, res.status)
    if (res.status === 401 || res.status === 403) {
      throw new InstagramAuthError()
    }
    throw new Error(`Instagram API error (HTTP ${res.status})`)
  }
  return res.json() as Promise<T>
}

/**
 * Instagram Business Account に画像+キャプションを投稿
 * 2-step: メディアコンテナ作成 → 公開
 */
export async function createInstagramPost(
  credentials: InstagramCredentials,
  { caption, imageUrl }: CreatePostOptions,
): Promise<InstagramPostResult> {
  const { accessToken, igUserId } = credentials

  if (!imageUrl) {
    throw new Error('Instagramは画像が必須です')
  }
  // 注: https-only & SSRF 縮小は publisher 層 (publishers.ts:assertFetchableHttpsUrl) で
  // 行う。低レベル API では非 null チェックのみ（多重 validation を避けて単一情報源化）。

  const container = await igRequest<{ id: string }>(
    `/${encodeURIComponent(igUserId)}/media`,
    accessToken,
    { method: 'POST', body: { image_url: imageUrl, caption } },
  )

  const published = await igRequest<{ id: string }>(
    `/${encodeURIComponent(igUserId)}/media_publish`,
    accessToken,
    { method: 'POST', body: { creation_id: container.id } },
  )

  return { id: published.id }
}

/**
 * Instagram Business Account に Reels (短尺縦動画) を投稿
 *
 * 3-step:
 *   1. media_type=REELS で video_url を渡してコンテナ作成
 *   2. Graph API が公開可能になるまで status_code をポーリング (FINISHED で OK)
 *   3. media_publish でフィードに公開
 *
 * - Graph API は video_url を自分でフェッチするため公開アクセス可能な https URL が必要
 *   (Supabase Storage の signed URL でも有効期限内なら可)
 * - share_to_feed は publisher 層でデフォルト解決済み。ここでは明示必須。
 *
 * 戻り値は `{ mediaId, containerId }` の双方を返す。containerId は呼び出し元が
 * poll 失敗 / Vercel タイムアウト時のリカバリ用に永続化することを想定する。
 *
 * @param onContainerCreated コンテナ作成直後（poll 開始前）に呼ばれるコールバック。
 *   呼び出し元はここで containerId を DB に永続化することで、処理が途中で
 *   死んでも漏れた中間リソースを追跡可能にする。失敗しても poll/publish は続行する。
 */
export async function createInstagramReelPost(
  credentials: InstagramCredentials,
  options: {
    caption: string
    videoUrl: string
    /** メインフィードへの露出可否。publisher 層で必ず明示指定する（デフォルト無し） */
    shareToFeed: boolean
    onContainerCreated?: (containerId: string) => Promise<void> | void
  },
): Promise<InstagramReelPostResult> {
  const { accessToken, igUserId } = credentials
  const { caption, videoUrl, shareToFeed, onContainerCreated } = options

  if (!videoUrl) {
    throw new Error('Instagram Reels は動画 URL が必須です')
  }
  // 注: https-only & SSRF 縮小は publisher 層 (publishers.ts:assertFetchableVideoUrl) で
  // 行う。低レベル API では非 null チェックのみ（多重 validation を避けて単一情報源化）。

  const container = await igRequest<{ id: string }>(
    `/${encodeURIComponent(igUserId)}/media`,
    accessToken,
    {
      method: 'POST',
      body: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        share_to_feed: shareToFeed ? 'true' : 'false',
      },
    },
  )

  // コンテナ作成直後に即永続化。poll/publish が落ちても containerId は失われない。
  if (onContainerCreated) {
    try {
      await onContainerCreated(container.id)
    } catch (e) {
      // 永続化失敗は致命ではない（投稿自体は継続）。ID も漏らさず status のみ。
      console.error('[Instagram API] onContainerCreated callback failed', e instanceof Error ? e.name : 'unknown')
    }
  }

  // 公開可能状態まで待つ (Reels は処理に時間がかかる)
  await waitForReelsContainerReady(container.id, accessToken)

  const published = await igRequest<{ id: string }>(
    `/${encodeURIComponent(igUserId)}/media_publish`,
    accessToken,
    { method: 'POST', body: { creation_id: container.id } },
  )

  return { mediaId: published.id, containerId: container.id }
}

const REELS_POLL_INTERVAL_MS = 5_000
const REELS_POLL_TIMEOUT_MS = 5 * 60_000 // 5 分以内に FINISHED にならなければ諦める

/**
 * TODO(webhook-migration): この 5 分ポーリングはサーバ実行時間と費用の両面で
 * 重い。本来は Instagram Graph API の Webhooks (media field の status_code
 * 通知) を購読し、コンテナ作成時に containerId を永続化 → webhook 受信時に
 * media_publish を発火する非同期フローに置き換えるべき。
 * 中間 containerId は createInstagramReelPost の onContainerCreated コールバックで
 * 既に永続化可能なので、移行時はこのポーリングを撤去し webhook ハンドラ
 * (POST /api/webhooks/instagram) を新設するだけで済む。
 */
async function waitForReelsContainerReady(
  containerId: string,
  accessToken: string,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < REELS_POLL_TIMEOUT_MS) {
    const data = await igRequest<{ status_code?: string; status?: string }>(
      `/${encodeURIComponent(containerId)}?fields=status_code,status`,
      accessToken,
    )
    const code = data.status_code ?? data.status ?? ''
    if (code === 'FINISHED') return
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(`Instagram Reels コンテナの処理に失敗しました (status=${code})`)
    }
    await new Promise((resolve) => setTimeout(resolve, REELS_POLL_INTERVAL_MS))
  }
  throw new Error('Instagram Reels コンテナの処理が制限時間内に完了しませんでした')
}

/**
 * Instagram long-lived access token のリフレッシュ。
 * - long-lived token は 60 日有効。期限直前に rotate して新 token を取得する。
 * - 入力 token も同じく long-lived である必要がある（short-lived は別エンドポイント）。
 * Docs: https://developers.facebook.com/docs/instagram-platform/refresh-access-tokens
 */
export async function refreshInstagramAccessToken(
  currentAccessToken: string,
): Promise<InstagramTokenRefreshResult> {
  const res = await igRequest<{ access_token: string; expires_in: number; token_type?: string }>(
    '/refresh_access_token?grant_type=ig_refresh_token',
    currentAccessToken,
  )
  if (!res.access_token) {
    throw new InstagramAuthError('Instagram token refresh response did not include access_token')
  }
  return {
    accessToken: res.access_token,
    expiresAt: Date.now() + (res.expires_in ?? 60 * 24 * 60 * 60) * 1000,
  }
}

/**
 * Token から接続済みの Instagram Business Account ID を取得
 */
export async function fetchInstagramUserId(accessToken: string): Promise<string> {
  const data = await igRequest<{
    data?: Array<{ instagram_business_account?: { id: string; username?: string } }>
  }>(
    '/me/accounts?fields=instagram_business_account{id,username}',
    accessToken,
  )
  const igAccount = (data.data ?? []).find(p => p.instagram_business_account?.id)
  if (!igAccount?.instagram_business_account?.id) {
    throw new Error('連携済みの Instagram ビジネスアカウントが見つかりません')
  }
  return igAccount.instagram_business_account.id
}
