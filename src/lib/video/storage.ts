import 'server-only'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Supabase Storage ヘルパー (動画パイプライン用)。
 *
 * バケット: `videos` (private, RLS は service_role のみ書き込み可)
 * パス規約: `{userId}/{videoId}/...`
 *   - シーン画像: `{userId}/{videoId}/scenes/{order}.png`
 *   - シーン音声: `{userId}/{videoId}/scenes/{order}.mp3`
 *   - 完成動画 : `{userId}/{videoId}/final.mp4`
 *
 * すべて service-role キー (createAdminClient) で実行する。
 * これによりワーカー / バックグラウンドジョブのように
 * 認証 cookie が無い文脈でも RLS をバイパスして書き込める。
 *
 * 戻り値の `storagePath` は DB の `image_url` / `audio_url` / `final_video_url` に
 * 保存する正規パス。`signedUrl` は Remotion レンダリングや配信に使う一時 URL。
 */

const BUCKET_NAME = 'videos'

// Signed URL の既定期限。
// シーン素材はパイプライン中だけ使えれば良いので 24h、
// 完成動画はユーザーがダッシュボードや SNS 投稿で使うので 7d。
const SCENE_ASSET_EXPIRES_SEC = 60 * 60 * 24 // 24h
const FINAL_VIDEO_EXPIRES_SEC = 60 * 60 * 24 * 7 // 7d

export class VideoStorageError extends Error {
  public readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'VideoStorageError'
    this.cause = cause
  }
}

interface PathParts {
  userId: string
  videoId: string
  sceneOrder?: number
}

function assertId(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VideoStorageError(`${field} が空です`)
  }
  // パス・トラバーサル対策。userId/videoId は UUID 想定。
  if (value.includes('/') || value.includes('..') || value.includes('\\')) {
    throw new VideoStorageError(`${field} に不正な文字が含まれています: ${value}`)
  }
}

function sceneImagePath({ userId, videoId, sceneOrder }: PathParts): string {
  assertId(userId, 'userId')
  assertId(videoId, 'videoId')
  if (typeof sceneOrder !== 'number' || !Number.isInteger(sceneOrder) || sceneOrder < 0) {
    throw new VideoStorageError(`sceneOrder が不正です: ${sceneOrder}`)
  }
  return `${userId}/${videoId}/scenes/${sceneOrder}.png`
}

function sceneAudioPath({ userId, videoId, sceneOrder }: PathParts): string {
  assertId(userId, 'userId')
  assertId(videoId, 'videoId')
  if (typeof sceneOrder !== 'number' || !Number.isInteger(sceneOrder) || sceneOrder < 0) {
    throw new VideoStorageError(`sceneOrder が不正です: ${sceneOrder}`)
  }
  return `${userId}/${videoId}/scenes/${sceneOrder}.mp3`
}

function finalVideoPath({ userId, videoId }: PathParts): string {
  assertId(userId, 'userId')
  assertId(videoId, 'videoId')
  return `${userId}/${videoId}/final.mp4`
}

interface UploadOutcome {
  storagePath: string
  signedUrl: string
}

async function uploadBytes(
  storagePath: string,
  bytes: Uint8Array,
  contentType: string,
  expiresInSec: number,
): Promise<UploadOutcome> {
  if (!bytes || bytes.byteLength === 0) {
    throw new VideoStorageError(`アップロード対象のバイト列が空です: ${storagePath}`)
  }
  const supabase = createAdminClient()
  // Supabase JS は ArrayBuffer / Uint8Array / Buffer を受け取れる。
  // Node の Buffer に揃えると content-length が安定する。
  const body = Buffer.from(bytes)

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, body, {
      contentType,
      upsert: true,
      cacheControl: '3600',
    })
  if (uploadError) {
    throw new VideoStorageError(
      `Storage アップロードに失敗しました (${storagePath}): ${uploadError.message}`,
      uploadError,
    )
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, expiresInSec)
  if (signedError || !signed?.signedUrl) {
    throw new VideoStorageError(
      `Signed URL 取得に失敗しました (${storagePath}): ${signedError?.message ?? 'unknown'}`,
      signedError,
    )
  }
  return { storagePath, signedUrl: signed.signedUrl }
}

export interface UploadSceneImageOptions {
  userId: string
  videoId: string
  sceneOrder: number
  imageBytes: Uint8Array
  contentType: string
}

export async function uploadSceneImage(
  opts: UploadSceneImageOptions,
): Promise<UploadOutcome> {
  const path = sceneImagePath({
    userId: opts.userId,
    videoId: opts.videoId,
    sceneOrder: opts.sceneOrder,
  })
  return uploadBytes(path, opts.imageBytes, opts.contentType, SCENE_ASSET_EXPIRES_SEC)
}

export interface UploadSceneAudioOptions {
  userId: string
  videoId: string
  sceneOrder: number
  audioBytes: Uint8Array
  contentType: string
}

export async function uploadSceneAudio(
  opts: UploadSceneAudioOptions,
): Promise<UploadOutcome> {
  const path = sceneAudioPath({
    userId: opts.userId,
    videoId: opts.videoId,
    sceneOrder: opts.sceneOrder,
  })
  return uploadBytes(path, opts.audioBytes, opts.contentType, SCENE_ASSET_EXPIRES_SEC)
}

export interface UploadFinalVideoOptions {
  userId: string
  videoId: string
  mp4Bytes: Uint8Array
}

export async function uploadFinalVideo(
  opts: UploadFinalVideoOptions,
): Promise<UploadOutcome> {
  const path = finalVideoPath({ userId: opts.userId, videoId: opts.videoId })
  return uploadBytes(path, opts.mp4Bytes, 'video/mp4', FINAL_VIDEO_EXPIRES_SEC)
}

/**
 * 既存の storage path に対して signed URL を再発行する。
 * Remotion レンダラーが期限切れ URL を持ち回らないように
 * パイプラインのリトライ時に都度呼ぶことを想定。
 */
export async function getSignedUrl(
  storagePath: string,
  expiresInSec: number = SCENE_ASSET_EXPIRES_SEC,
): Promise<string> {
  if (!storagePath || storagePath.trim().length === 0) {
    throw new VideoStorageError('storagePath が空です')
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, expiresInSec)
  if (error || !data?.signedUrl) {
    throw new VideoStorageError(
      `Signed URL 取得に失敗しました (${storagePath}): ${error?.message ?? 'unknown'}`,
      error,
    )
  }
  return data.signedUrl
}
