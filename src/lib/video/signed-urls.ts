import 'server-only'
import { getSignedUrl } from '@/lib/video/storage'
import type { Scene, VideoWithScenes } from '@/types/database'

/**
 * Supabase Storage path / Signed URL の値が混在しているフィールドを
 * 「ブラウザがそのまま `<img src>` / `<audio src>` に使える URL」に正規化する。
 *
 * 設計上、pipeline.ts は `scenes.image_url` / `scenes.audio_url` を
 * **storage path** (例: `userId/videoId/scenes/0.png`) で保存する。
 * 一方 `videos.final_video_url` は **signed URL** で保存される。
 * UI 側は両方を同じ「URL」として扱いたいので、API / SSR で signed URL に揃える。
 *
 * 期限切れ判定:
 *   - `https://` で始まる値は既に signed URL とみなし、token の exp を見て期限切れなら再発行
 *   - それ以外は storage path 扱いで signed URL を新規発行
 *
 * Signed URL の token はクエリパラメータ `token` の JWT で
 * `payload.exp` (秒) を持つ。skewMs ぶんマージンを取って判定する。
 */

const DEFAULT_EXPIRES_SEC = 60 * 60 // 1 時間: シーン素材の UI 表示用
const FINAL_VIDEO_EXPIRES_SEC = 60 * 60 * 24 * 7 // 7 日: 完成動画
const SKEW_MS = 60_000 // 1 分

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

/**
 * Supabase の signed URL の `token` クエリから JWT exp を取り出して期限切れ判定する。
 * 解釈できない場合は「期限切れ扱い」にして安全側に倒す (= 再発行を促す)。
 */
function isSignedUrlExpired(signedUrl: string): boolean {
  try {
    const u = new URL(signedUrl)
    const token = u.searchParams.get('token')
    if (!token) return true
    const parts = token.split('.')
    if (parts.length < 2) return true
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8')) as {
      exp?: number
    }
    if (typeof payload.exp !== 'number') return true
    return payload.exp * 1000 <= Date.now() + SKEW_MS
  } catch {
    return true
  }
}

/**
 * Supabase の signed URL から元の storage path を抜き出す。
 * 失敗時は null。再発行に使う。
 *
 * 形式: https://<project>.supabase.co/storage/v1/object/sign/{bucket}/{path}?token=...
 */
function extractStoragePath(signedUrl: string, bucketName = 'videos'): string | null {
  try {
    const u = new URL(signedUrl)
    const marker = `/storage/v1/object/sign/${bucketName}/`
    const idx = u.pathname.indexOf(marker)
    if (idx < 0) return null
    const raw = u.pathname.slice(idx + marker.length)
    if (!raw) return null
    const path = decodeURIComponent(raw)
    // パストラバーサル防御: `..` を含むパスは拒否する
    if (path.includes('..')) return null
    return path
  } catch {
    return null
  }
}

/**
 * `image_url` / `audio_url` のような「storage path もしくは signed URL」の値を
 * ブラウザで使える signed URL に解決する。
 *
 * null / 空文字列はそのまま null を返す。
 * 解決に失敗したら null を返す (UI は「画像なし」プレースホルダーを出す)。
 */
export async function resolveAssetUrl(
  value: string | null | undefined,
  expiresInSec: number = DEFAULT_EXPIRES_SEC,
): Promise<string | null> {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (isHttpUrl(trimmed)) {
    if (!isSignedUrlExpired(trimmed)) return trimmed
    // 期限切れ → storage path を抽出して再発行
    const path = extractStoragePath(trimmed)
    if (!path) {
      // 抽出失敗時は元 URL を返す (期限切れでも UI 側でブロックされるよりはマシ)
      return trimmed
    }
    try {
      return await getSignedUrl(path, expiresInSec)
    } catch {
      return null
    }
  }

  // storage path として signed URL を新規発行
  try {
    return await getSignedUrl(trimmed, expiresInSec)
  } catch {
    return null
  }
}

/**
 * 1 シーンの image_url / audio_url を signed URL に解決した shallow copy を返す。
 */
export async function decorateSceneUrls(scene: Scene): Promise<Scene> {
  const [imageUrl, audioUrl] = await Promise.all([
    resolveAssetUrl(scene.image_url),
    resolveAssetUrl(scene.audio_url),
  ])
  return { ...scene, image_url: imageUrl, audio_url: audioUrl }
}

/**
 * Video + scenes をまとめてブラウザ向けに signed URL 化する。
 *
 * 並列発行するが、scenes が 10 件 → 20 個の signed URL + final_video の 1 個 = 21 並列。
 * Supabase は createSignedUrl にレート制限が無いので問題なし。
 */
export async function decorateVideoWithSignedUrls(
  video: VideoWithScenes,
): Promise<VideoWithScenes> {
  const [scenes, finalVideoUrl, voiceUrl] = await Promise.all([
    Promise.all(video.scenes.map(decorateSceneUrls)),
    resolveAssetUrl(video.final_video_url, FINAL_VIDEO_EXPIRES_SEC),
    resolveAssetUrl(video.voice_url, FINAL_VIDEO_EXPIRES_SEC),
  ])
  return {
    ...video,
    scenes,
    final_video_url: finalVideoUrl,
    voice_url: voiceUrl,
  }
}
