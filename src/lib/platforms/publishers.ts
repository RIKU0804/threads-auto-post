// Platform Publisher Strategy
// 各プラットフォームは validate + publish を提供。ルートは publishPost ヘルパー経由で呼ぶ。
// 投稿時に access_token が期限切れだった場合の自動 refresh は publishPost 側で吸収する。

import 'server-only'
import type { Account, Platform, Post, Video } from '@/types/database'
import { createAdminClient } from '@/lib/supabase-admin'
import { decryptSecret, encryptSecret, isEncryptionAvailable } from '@/lib/crypto'
import { createThreadsPost, refreshThreadsToken, ThreadsAuthError } from './threads'
import { createInstagramPost, InstagramAuthError } from './instagram'
import { createXTweet, createXThread, uploadXMedia, XAuthError, type XCredentials } from './x'
import {
  refreshYouTubeToken,
  uploadYouTubeVideo,
  YouTubeAuthError,
  type YouTubePrivacy,
} from './youtube'
import {
  createTikTokVideoPost,
  refreshTikTokToken,
  TikTokAuthError,
  type TikTokPrivacy,
} from './tiktok'

export interface PublishContext {
  post: Pick<Post, 'id' | 'text_content' | 'image_url'>
  account: Account
}

export interface PublishResult {
  platformPostId: string
  platformPostIds?: string[]
}

export interface Publisher {
  platform: Platform
  validate(ctx: PublishContext): void
  publish(ctx: PublishContext): Promise<PublishResult>
}

// ---------- Threads ----------
const threadsPublisher: Publisher = {
  platform: 'threads',
  validate({ account }) {
    if (!account.access_token || !account.threads_user_id) {
      throw new Error('Threads APIトークンが設定されていません')
    }
  },
  async publish({ post, account }) {
    const result = await createThreadsPost(
      { accessToken: account.access_token!, userId: account.threads_user_id! },
      { text: post.text_content ?? '', imageUrl: post.image_url ?? undefined },
    )
    return { platformPostId: result.id }
  },
}

// ---------- Instagram ----------
const instagramPublisher: Publisher = {
  platform: 'instagram',
  validate({ post, account }) {
    if (!account.access_token || !account.instagram_user_id) {
      throw new Error('Instagram APIトークンまたはアカウントIDが設定されていません')
    }
    if (!post.image_url) {
      throw new Error('Instagram投稿には画像が必須です')
    }
  },
  async publish({ post, account }) {
    const result = await createInstagramPost(
      { accessToken: account.access_token!, igUserId: account.instagram_user_id! },
      { caption: post.text_content ?? '', imageUrl: post.image_url! },
    )
    return { platformPostId: result.id }
  },
}

// ---------- X ----------
// 本文中に "\n---\n" 区切りが含まれていればスレッド投稿として送信。
function xCredentials(account: Account): XCredentials {
  return {
    apiKey: account.x_api_key!,
    apiSecret: account.x_api_secret!,
    accessToken: account.access_token!,
    accessSecret: account.x_access_secret!,
  }
}

const MAX_X_IMAGE_BYTES = 5 * 1024 * 1024 // X の画像上限相当
const MAX_VIDEO_BYTES = 256 * 1024 * 1024 // YouTube Shorts 用上限ガード（256MB）

/**
 * 外部 URL をサーバー側 fetch する前の SSRF 縮小ガード。
 * 画像 / 動画 URL はユーザー設定 or Supabase signed URL 等で持ち込めるため、
 * https のみ・ループバック/プライベート/メタデータ宛先を拒否する。
 * （DNS リバインディングまでは防げないため、呼び出し側で redirect:'manual'
 *  とサイズ上限も併用する）
 */
function assertFetchableHttpsUrl(raw: string, label: string): void {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error(`${label}のURLが不正です`)
  }
  if (u.protocol !== 'https:') {
    throw new Error(`${label}のURLは https:// である必要があります`)
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '169.254.169.254' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^(::ffff:)?0\.0\.0\.0$/.test(host) ||
    /^f[cd][0-9a-f]{2}:/.test(host) // fc00::/7 ユニークローカル
  ) {
    throw new Error(`${label}のURLのホストが許可されていません`)
  }
}

function assertFetchableImageUrl(raw: string): void {
  assertFetchableHttpsUrl(raw, '添付画像')
}

function assertFetchableVideoUrl(raw: string): void {
  assertFetchableHttpsUrl(raw, '動画ファイル')
}

const xPublisher: Publisher = {
  platform: 'x',
  validate({ account }) {
    if (!account.x_api_key || !account.x_api_secret || !account.access_token || !account.x_access_secret) {
      throw new Error('X の4キー（API Key/Secret・Access Token/Secret）が設定されていません')
    }
  },
  async publish({ post, account }) {
    const cred = xCredentials(account)
    const text = post.text_content ?? ''

    // 画像があれば X にアップロードして media_id を取得（スレッド時は先頭ツイートに添付）
    let mediaIds: string[] | undefined
    if (post.image_url) {
      assertFetchableImageUrl(post.image_url)
      // redirect:'manual' でリダイレクト経由の SSRF 迂回を遮断
      const imgRes = await fetch(post.image_url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      })
      if (!imgRes.ok) throw new Error('添付画像の取得に失敗しました')
      const declaredLen = Number(imgRes.headers.get('content-length') ?? 0)
      if (declaredLen > MAX_X_IMAGE_BYTES) {
        throw new Error('添付画像が大きすぎます（5MB以下にしてください）')
      }
      const arrayBuf = await imgRes.arrayBuffer()
      if (arrayBuf.byteLength > MAX_X_IMAGE_BYTES) {
        throw new Error('添付画像が大きすぎます（5MB以下にしてください）')
      }
      const bytes = new Uint8Array(arrayBuf)
      const mime = imgRes.headers.get('content-type') ?? 'image/png'
      mediaIds = [await uploadXMedia(cred, bytes, mime)]
    }

    const parts = text.split(/\n---\n/).map(s => s.trim()).filter(Boolean)
    if (parts.length > 1) {
      const results = await createXThread(cred, parts, mediaIds)
      return {
        platformPostId: results[0].id,
        platformPostIds: results.map(r => r.id),
      }
    }
    const result = await createXTweet(cred, text, undefined, mediaIds)
    return { platformPostId: result.id }
  },
}

// NOTE: tiktok / youtube は今後 publisher 実装を追加するため、ここでは未登録。
// 呼び出し側 (publishPost) が undefined を弾く分岐を持っているので安全。
export const publishers: Partial<Record<Platform, Publisher>> = {
  threads: threadsPublisher,
  instagram: instagramPublisher,
  x: xPublisher,
}

// ---------- Token refresh ----------
// auth error 時に DB の access_token を更新し、true なら再試行する。
async function tryRefreshToken(account: Account): Promise<boolean> {
  const admin = createAdminClient()

  if (account.platform === 'threads') {
    if (!account.access_token) return false
    try {
      const refreshed = await refreshThreadsToken(account.access_token)
      account.access_token = refreshed.accessToken
      account.token_expires_at = new Date(refreshed.expiresAt).toISOString()
      await admin
        .from('accounts')
        .update({
          access_token: refreshed.accessToken,
          token_expires_at: new Date(refreshed.expiresAt).toISOString(),
        })
        .eq('id', account.id)
      return true
    } catch (e) {
      console.error('[publishers] Threads refresh failed', e instanceof Error ? e.message : 'unknown')
      return false
    }
  }

  // X は手動入力トークン運用なので refresh は実施しない（期限切れ時は再連携してもらう）
  // Instagram も long-lived token の refresh は頻度が低く未対応
  return false
}

function isAuthError(e: unknown): boolean {
  return (
    e instanceof ThreadsAuthError ||
    e instanceof XAuthError ||
    e instanceof InstagramAuthError
  )
}

/**
 * validate + publish を行う。auth error なら 1 回だけ refresh を試みて再投稿する。
 */
export async function publishPost(ctx: PublishContext): Promise<PublishResult> {
  const publisher = publishers[ctx.account.platform]
  if (!publisher) {
    throw new Error(`${ctx.account.platform} の投稿は未対応です`)
  }
  publisher.validate(ctx)

  try {
    return await publisher.publish(ctx)
  } catch (e) {
    if (!isAuthError(e)) throw e

    const refreshed = await tryRefreshToken(ctx.account)
    if (!refreshed) {
      throw new Error('アクセストークンの有効期限が切れています。再連携が必要です')
    }
    // 更新後の credentials で 1 回だけ再試行
    return publisher.publish(ctx)
  }
}

// ============================================================================
// Video Publishers (Shorts / TikTok / YouTube Shorts)
// ----------------------------------------------------------------------------
// 動画前提のプラットフォーム用 publisher。テキスト投稿系の Publisher とは
// 入力 (Video) も出力 (publishedUrl) も異なるため別インターフェースで定義する。
// ============================================================================

export type VideoPlatform = Extract<Platform, 'tiktok' | 'youtube'>

export interface VideoPublishContext {
  video: Pick<Video, 'id' | 'title' | 'script' | 'final_video_url'>
  account: Account
  /** 個別 publish 毎の上書きオプション（公開範囲など） */
  options?: VideoPublishOptions
}

export interface VideoPublishOptions {
  /** YouTube: public | unlisted | private。デフォルト 'public' */
  privacyStatus?: YouTubePrivacy
  /** YouTube: カテゴリ ID。デフォルト '22' (People & Blogs) */
  categoryId?: string
  /** TikTok: アカウントの公開範囲。デフォルト 'SELF_ONLY'（unaudited app は SELF_ONLY 必須） */
  tiktokPrivacyLevel?: TikTokPrivacy
}

export interface VideoPublishResult {
  /** プラットフォーム上の動画 ID (YouTube videoId / TikTok publish_id 等) */
  platformPublishId: string
  /** ブラウザで開ける公開 URL */
  publishedUrl?: string
}

export interface VideoPublisher {
  platform: VideoPlatform
  validate(ctx: VideoPublishContext): void
  publish(ctx: VideoPublishContext): Promise<VideoPublishResult>
}

// ---------- YouTube ----------
const YOUTUBE_REQUIRED_ENV = ['YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET'] as const

function ensureYouTubeOAuthConfig(): { clientId: string; clientSecret: string } {
  const missing = YOUTUBE_REQUIRED_ENV.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`YouTube OAuth が未設定です (${missing.join(', ')} を確認してください)`)
  }
  return {
    clientId: process.env.YOUTUBE_OAUTH_CLIENT_ID!,
    clientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!,
  }
}

/**
 * #Shorts タグを title (または description) に必ず含めるためのヘルパー。
 * 1080x1920 縦動画 + 60秒未満は動画生成パイプライン側で保証されている前提。
 */
const SHORTS_TAG = '#Shorts'

function ensureShortsTitle(rawTitle: string): string {
  const trimmed = (rawTitle || '').trim()
  if (/#shorts\b/i.test(trimmed)) return trimmed.slice(0, 100)
  // YouTube タイトルは 100 文字上限。末尾に #Shorts を入れる余裕がなければ切り詰める
  const suffix = ` ${SHORTS_TAG}`
  const max = 100
  if (trimmed.length + suffix.length <= max) return `${trimmed}${suffix}`
  return `${trimmed.slice(0, max - suffix.length)}${suffix}`
}

function buildShortsDescription(script: string | null): string {
  const body = (script ?? '').trim()
  // YouTube Shorts は本文先頭に #Shorts を入れる慣習にも準拠（重複しても無害）
  if (/#shorts\b/i.test(body)) return body.slice(0, 5000)
  return `${SHORTS_TAG}\n\n${body}`.slice(0, 5000)
}

const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
])

/**
 * 動画URL（典型は Supabase signed URL）からバイト列を取得する。
 * - https 限定 + 内部ネットワーク拒否 (assertFetchableVideoUrl)
 * - redirect 'manual' で SSRF 迂回を遮断（opaqueredirect は明示エラー）
 * - content-length ヘッダ → ストリーミング byte カウント の二段で
 *   256MB 上限を強制（ヘッダなしでもメモリ事前確保せず early abort）
 * - mime はホワイトリスト（YouTube に偽装ファイルを送らないため）
 */
async function fetchVideoBytesSafe(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  assertFetchableVideoUrl(url)
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(180_000),
  })
  if (res.type === 'opaqueredirect') {
    throw new Error('動画ファイルのURLがリダイレクトを返しました（許可されていません）')
  }
  if (!res.ok) {
    throw new Error(`動画ファイルの取得に失敗しました (HTTP ${res.status})`)
  }

  const declaredLen = Number(res.headers.get('content-length') ?? 0)
  if (declaredLen > MAX_VIDEO_BYTES) {
    throw new Error('動画ファイルが大きすぎます（256MB以下にしてください）')
  }

  const rawMime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const mimeType = ALLOWED_VIDEO_MIME.has(rawMime) ? rawMime : 'video/mp4'

  // ストリーミングで読みながら都度サイズチェック → 超過時は即 abort
  if (!res.body) {
    // ボディが取得できない実装環境向けのフォールバック（実質 Node では到達しない）
    const arrayBuf = await res.arrayBuffer()
    if (arrayBuf.byteLength > MAX_VIDEO_BYTES) {
      throw new Error('動画ファイルが大きすぎます（256MB以下にしてください）')
    }
    return { bytes: new Uint8Array(arrayBuf), mimeType }
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > MAX_VIDEO_BYTES) {
        await reader.cancel('size limit exceeded').catch(() => undefined)
        throw new Error('動画ファイルが大きすぎます（256MB以下にしてください）')
      }
      chunks.push(value)
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  return { bytes, mimeType }
}

/**
 * 投稿直前に access token を更新する。
 * YouTube の access token は 1 時間で失効するため、毎回 refresh する運用にしている。
 * 戻り値の accessToken は呼び出し元でその場限り使う（DB には保存しない）。
 */
async function refreshYouTubeAccessToken(account: Account): Promise<string> {
  const { clientId, clientSecret } = ensureYouTubeOAuthConfig()
  const encrypted = account.youtube_refresh_token
  if (!encrypted) {
    throw new YouTubeAuthError('YouTube refresh token が保存されていません')
  }
  const refreshToken = decryptSecret(encrypted)
  if (!refreshToken) {
    throw new YouTubeAuthError('YouTube refresh token を復号できませんでした')
  }
  const refreshed = await refreshYouTubeToken(clientId, clientSecret, refreshToken)

  // token_expires_at は監査用に更新しておく（access_token 自体は短命なので DB には書かない）
  try {
    const admin = createAdminClient()
    await admin
      .from('accounts')
      .update({ token_expires_at: new Date(refreshed.expiresAt).toISOString() })
      .eq('id', account.id)
  } catch (e) {
    console.error('[publishers] YouTube token_expires_at update failed', e instanceof Error ? e.message : 'unknown')
  }

  return refreshed.accessToken
}

const youtubePublisher: VideoPublisher = {
  platform: 'youtube',
  validate({ video, account }) {
    if (account.platform !== 'youtube') {
      throw new Error('アカウントが YouTube ではありません')
    }
    if (!account.youtube_refresh_token) {
      throw new Error('YouTube の連携が未完了です（refresh token がありません）')
    }
    if (!account.youtube_channel_id) {
      throw new Error('YouTube チャンネル ID が登録されていません')
    }
    if (!video.final_video_url) {
      throw new Error('最終動画ファイルが用意されていません')
    }
    if (!video.title || !video.title.trim()) {
      throw new Error('動画タイトルが未設定です')
    }
    // 設定検証を早期に走らせる
    ensureYouTubeOAuthConfig()
  },
  async publish({ video, account, options }) {
    // publish 単独で呼ばれても安全な様に early guard（validate を経由しないパスへの保険）
    if (!video.final_video_url) {
      throw new Error('最終動画ファイルが用意されていません')
    }
    if (!video.title || !video.title.trim()) {
      throw new Error('動画タイトルが未設定です')
    }

    // 1) refresh で access token を取得（YouTube access token は 1h 失効）
    const accessToken = await refreshYouTubeAccessToken(account)

    // 2) Supabase Storage の signed URL から動画バイト列を取得
    const { bytes, mimeType } = await fetchVideoBytesSafe(video.final_video_url)

    // 3) Shorts として投稿: title に #Shorts を強制注入し、description 先頭にも入れる
    //    （YouTube 側は title または description のどちらかに #Shorts があれば
    //     Shorts シェルフ対象。両方に入れて取りこぼしを防ぐ）
    const title = ensureShortsTitle(video.title)
    const description = buildShortsDescription(video.script)

    const result = await uploadYouTubeVideo(
      { accessToken },
      {
        videoBytes: bytes,
        videoMimeType: mimeType,
        title,
        description,
        privacyStatus: options?.privacyStatus ?? 'public',
        categoryId: options?.categoryId ?? '22',
        madeForKids: false,
      },
    )

    return {
      platformPublishId: result.id,
      publishedUrl: `https://youtu.be/${result.id}`,
    }
  },
}

// ---------- TikTok ----------
const TIKTOK_TITLE_MAX = 2200

function buildTikTokCaption(video: Pick<Video, 'title' | 'script'>): string {
  const t = (video.title ?? '').trim()
  if (t) return t.slice(0, TIKTOK_TITLE_MAX)
  const firstLine = (video.script ?? '').trim().split(/\n+/)[0] ?? ''
  return firstLine.slice(0, TIKTOK_TITLE_MAX)
}

function decryptTikTokAccessToken(account: Account): string {
  if (!account.access_token) {
    throw new TikTokAuthError('TikTok access_token が保存されていません')
  }
  const plaintext = decryptSecret(account.access_token)
  if (!plaintext) {
    throw new TikTokAuthError('TikTok access_token を復号できませんでした')
  }
  return plaintext
}

const tiktokVideoPublisher: VideoPublisher = {
  platform: 'tiktok',
  validate({ video, account }) {
    if (account.platform !== 'tiktok') {
      throw new Error('アカウントが TikTok ではありません')
    }
    if (!account.access_token) {
      throw new Error('TikTok アクセストークンが設定されていません')
    }
    if (!account.tiktok_open_id) {
      throw new Error('TikTok アカウント情報（open_id）が未取得です。再連携してください')
    }
    if (!video.final_video_url) {
      throw new Error('動画ファイルが生成されていません')
    }
    if (!video.title || !video.title.trim()) {
      // buildTikTokCaption が script からフォールバックするが、両方空の事故を早期検出
      if (!video.script || !video.script.trim()) {
        throw new Error('TikTok 投稿のキャプションが空です（titleもscriptも未設定）')
      }
    }
    assertFetchableVideoUrl(video.final_video_url)
  },
  async publish({ video, account, options }) {
    if (!video.final_video_url) {
      throw new Error('動画ファイルが生成されていません')
    }
    // unaudited app は SELF_ONLY 強制。アプリ審査通過後に options で上書き可能。
    const privacy: TikTokPrivacy = options?.tiktokPrivacyLevel ?? 'SELF_ONLY'
    const accessToken = decryptTikTokAccessToken(account)
    const result = await createTikTokVideoPost(
      { accessToken },
      {
        videoUrl: video.final_video_url,
        title: buildTikTokCaption(video),
        privacyLevel: privacy,
      },
    )
    return { platformPublishId: result.publishId }
  },
}

/**
 * TikTok の refresh_token を使って新しい access/refresh トークンを取得し、
 * DB に保存して **新しい Account オブジェクト** を返す（呼び出し元の account は mutate しない）。
 *
 * 平文トークン保存を防ぐため、ENCRYPTION_KEY が未設定なら fail する（旧実装の
 * フォールバックは本番でリークの温床になっていたので廃止）。
 */
async function refreshTikTokAccountToken(account: Account): Promise<Account | null> {
  const refreshTokenEnc = account.tiktok_refresh_token
  if (!refreshTokenEnc) return null

  const clientKey = process.env.TIKTOK_CLIENT_KEY
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  if (!clientKey || !clientSecret) {
    console.error('[publishers] TIKTOK_CLIENT_KEY/SECRET が未設定です')
    return null
  }

  if (!isEncryptionAvailable()) {
    // 暗号化キーが無いと平文で DB に書く事になり、ローテーションの度に漏洩リスクが膨らむ
    throw new Error(
      'ENCRYPTION_KEY が未設定のため TikTok のトークンを安全に保存できません',
    )
  }

  const refreshTokenPlain = decryptSecret(refreshTokenEnc)
  if (!refreshTokenPlain) {
    console.error('[publishers] TikTok refresh_token の復号に失敗しました')
    return null
  }

  try {
    const refreshed = await refreshTikTokToken(clientKey, clientSecret, refreshTokenPlain)
    const admin = createAdminClient()
    const nextAccessTokenEnc = encryptSecret(refreshed.accessToken)
    const nextRefreshTokenEnc = encryptSecret(refreshed.refreshToken)
    const nextExpiresAt = new Date(refreshed.expiresAt).toISOString()

    await admin
      .from('accounts')
      .update({
        access_token: nextAccessTokenEnc,
        tiktok_refresh_token: nextRefreshTokenEnc,
        token_expires_at: nextExpiresAt,
      })
      .eq('id', account.id)

    return {
      ...account,
      access_token: nextAccessTokenEnc,
      tiktok_refresh_token: nextRefreshTokenEnc,
      token_expires_at: nextExpiresAt,
    }
  } catch (e) {
    console.error(
      '[publishers] TikTok refresh failed',
      e instanceof Error ? e.message : 'unknown',
    )
    return null
  }
}

export const videoPublishers: Partial<Record<VideoPlatform, VideoPublisher>> = {
  youtube: youtubePublisher,
  tiktok: tiktokVideoPublisher,
}

function isVideoAuthError(e: unknown): boolean {
  return e instanceof YouTubeAuthError || e instanceof TikTokAuthError
}

function asVideoPlatform(platform: Platform): VideoPlatform | null {
  return platform === 'tiktok' || platform === 'youtube' ? platform : null
}

/**
 * 動画をプラットフォームへ投稿する。
 * - 入力 `ctx` は不変。リトライ時は refresh で得た新 account を持つ新しい ctx を作る
 * - YouTube は publish 内で毎回 access token を refresh するので auth error retry は
 *   一度だけ走らせれば十分（同じ refresh_token で再度 publish）
 * - TikTok は refresh_token から新トークンを取得し、新 account で publish 再実行
 */
export async function publishVideo(ctx: VideoPublishContext): Promise<VideoPublishResult> {
  const platform = asVideoPlatform(ctx.account.platform)
  if (!platform) {
    throw new Error(`${ctx.account.platform} の動画投稿は未対応です`)
  }
  const publisher = videoPublishers[platform]
  if (!publisher) {
    throw new Error(`${platform} の動画投稿は未対応です`)
  }
  publisher.validate(ctx)

  try {
    return await publisher.publish(ctx)
  } catch (e) {
    if (!isVideoAuthError(e)) throw e

    if (platform === 'tiktok') {
      const next = await refreshTikTokAccountToken(ctx.account)
      if (!next) {
        throw new Error('TikTok のアクセストークン更新に失敗しました。再連携してください')
      }
      return publisher.publish({ ...ctx, account: next })
    }

    // YouTube: publish 自体が refresh するため、同じ ctx で 1 回だけリトライ
    try {
      return await publisher.publish(ctx)
    } catch (retryErr) {
      if (isVideoAuthError(retryErr)) {
        throw new Error('YouTube のアクセストークン更新に失敗しました。再連携してください')
      }
      throw retryErr
    }
  }
}
