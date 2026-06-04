import 'server-only'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase-admin'
import { decryptSecret } from '@/lib/crypto'
import { MissingApiKeyError } from '@/lib/ai/api-keys'
import { sanitizeProviderError } from '@/lib/ai/sanitize-error'
import type { GenerationMode, Scene, Video, VideoStatus } from '@/types/database'
import { generateVideoScript, type SceneDraft } from '@/lib/video/script'
import {
  generateFullNarration,
  generateSceneNarration,
  type ElevenLabsVoiceOptions,
} from '@/lib/video/elevenlabs'
import { DEFAULT_VOICE_ID } from '@/lib/video/voice-presets'
import {
  generateAvatarVideo,
  getVideoStatus as getHeyGenVideoStatus,
  type HeyGenVoiceInput,
} from '@/lib/video/heygen'
import {
  getSignedUrl,
  uploadFinalVideo,
  uploadSceneAudio,
  uploadSceneImage,
  uploadVideoVoice,
} from '@/lib/video/storage'
import { assertFetchableVideoUrl } from '@/lib/platforms/publishers'

/**
 * 動画生成パイプラインのオーケストレーター。
 *
 * generation_mode で 2 系統に分岐する:
 *
 * 1) 'remotion' (デフォルト)
 *    draft
 *      → generating_script   (script.ts で台本生成、scenes 行を挿入)
 *      → generating_images   (各シーンの画像を gpt-image-2 で生成)
 *      → generating_voice    (各シーンの音声を ElevenLabs で生成)
 *      → rendering           (Remotion で MP4 レンダリング)
 *      → ready               (完成)
 *
 * 2) 'heygen_avatar'
 *    draft
 *      → generating_script   (連続ナレーション 1 本ぶんを生成、scenes 行は作らない)
 *      → generating_voice    (voice_source='elevenlabs' のときのみ。
 *                             voice_source='heygen' のときは HeyGen 内蔵 TTS を使うので
 *                             この遷移は省略され、generating_script から直接 rendering へ進む)
 *      → rendering           (HeyGen アバター動画ジョブを投入 → ポーリング)
 *      → ready               (HeyGen から MP4 をダウンロードして Supabase Storage に再アップロード)
 *
 *    HeyGen 経路は scenes/画像を持たないため generating_images フェーズはスキップする。
 *
 * いずれの段階でも uncatchable error は failed に遷移し、
 * videos.error_message にメッセージを書き込む。
 *
 * 各 step は idempotent:
 *   - Remotion: 画像/音声は url が空のシーンのみ、レンダーは final_video_url が空のときのみ
 *   - HeyGen  : script / voice_url / heygen_video_id / final_video_url を順に永続化し、
 *               レジューム時はそれぞれが揃っているフェーズから再開する
 */

// gpt-image-2 に統一（src/lib/ai/image.ts と同じモデル）
const IMAGE_MODEL = 'gpt-image-2'
const IMAGE_SIZE = '1024x1792' as const // 9:16 縦長 (Remotion 1080x1920 に近い比率)
const IMAGE_TIMEOUT_MS = 120_000

// 各シーン末尾に入れる無音の「間」。音声が終わってから次シーンに移るまでの余韻。
// SNS 動画として聴き取りやすさを保ちつつ、テンポを崩さないギリギリの量。
// 大きくしすぎるとダラっとして離脱率が上がる。
const SCENE_TAIL_GAP_SEC = 0.2
// scenes.duration の下限・上限
const SCENE_DURATION_MIN_SEC = 2
const SCENE_DURATION_MAX_SEC = 15

// ElevenLabs TTS の並列度。Free / Starter プランは同時 2 リクエストまでで
// それを超えると 429。安全側に 2 で固定 (Pro 以上でも体感は変わらない)。
const TTS_CONCURRENCY = 2

// gpt-image-2 の並列度。OpenAI の組織レート制限は通常 "5 images/min" のため
// 全シーンを一気に投げると 429 になる。並列度を絞りつつ、超過しても
// SDK の自動リトライ (maxRetries) が Retry-After を尊重して回復する。
const IMAGE_CONCURRENCY = 2
// gpt-image-2 の 429 / 5xx に対する SDK 自動リトライ回数。
// 「5枚/分」制限では 6 枚目以降が最大 60 秒待ちになるため多めに確保する。
const IMAGE_MAX_RETRIES = 5

// Remotion h264 エンコードの CRF (品質係数)。
//   - 範囲 1(高品質/大) 〜 51(低品質/小)。Remotion のデフォルトは 18 (高品質だがファイル巨大)。
//   - 24 にすると体感画質をほぼ保ったままファイルサイズが概ね 1/2〜1/3 になる。
//   - Supabase 無料プランの 50MB アップロード上限に収めるための主対策。
//   - 40 秒・1080×1920 で概ね 20〜35MB に収まる想定。
const VIDEO_CRF = 24

/**
 * 配列 items に対し関数 fn を並列度 concurrency で実行し、
 * Promise.allSettled 互換の結果配列を返す。
 *
 * 「ワーカープールから 1 件取って fn を実行する」を concurrency 個並列で回す。
 * input の順序は維持。
 */
async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn) => Promise<TOut>,
): Promise<PromiseSettledResult<TOut>[]> {
  // 空配列は早期 return（sparse array や無駄なワーカー spawn を避ける）。
  if (items.length === 0) return []
  const results: PromiseSettledResult<TOut>[] = new Array(items.length)
  const slots = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      try {
        const value = await fn(items[idx])
        results[idx] = { status: 'fulfilled', value }
      } catch (reason: unknown) {
        results[idx] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: slots }, () => worker()))
  return results
}

// パイプラインを Path A(Lambda) と Path B(local) で切り替えるフラグ。
// 既定は local。AWS をセットアップしたら REMOTION_PROVIDER=lambda にする。
const REMOTION_PROVIDER = (process.env.REMOTION_PROVIDER ?? 'local').toLowerCase()

export interface PipelineProgress {
  videoId: string
  status: VideoStatus
  step: 'script' | 'images' | 'voice' | 'render' | 'done'
  sceneProgress?: { completed: number; total: number }
  error?: string
}

/**
 * runVideoPipeline 用のオプション。
 * videos テーブルに theme カラムを持たないため、ジョブ起動時に渡してもらう。
 * 未指定の場合は videos.title をテーマとしてフォールバックする。
 */
export interface PipelineRunOptions {
  theme?: string | null
  sceneCount?: number | null
  targetDurationSec?: number | null
}

export class PipelineError extends Error {
  public readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'PipelineError'
    this.cause = cause
  }
}

// ---------------------------------------------------------------------------
// DB ヘルパー
// ---------------------------------------------------------------------------

async function loadVideo(videoId: string): Promise<Video> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .maybeSingle()
  if (error) {
    throw new PipelineError(`videos の取得に失敗しました: ${error.message}`, error)
  }
  if (!data) {
    throw new PipelineError(`videos が見つかりません: ${videoId}`)
  }
  return data as Video
}

async function loadScenes(videoId: string): Promise<Scene[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('scenes')
    .select('*')
    .eq('video_id', videoId)
    .order('order_index', { ascending: true })
  if (error) {
    throw new PipelineError(`scenes の取得に失敗しました: ${error.message}`, error)
  }
  return (data ?? []) as Scene[]
}

/**
 * scene を取得する。expectedVideoId を渡すと、その video に属さない scene は
 * 「見つからない」として扱う（IDOR / TOCTOU の防御層。route で検証済みでも二重に守る）。
 */
async function loadSceneById(sceneId: string, expectedVideoId?: string): Promise<Scene> {
  const supabase = createAdminClient()
  let query = supabase.from('scenes').select('*').eq('id', sceneId)
  if (expectedVideoId) query = query.eq('video_id', expectedVideoId)
  const { data, error } = await query.maybeSingle()
  if (error) {
    throw new PipelineError(`scene の取得に失敗しました: ${error.message}`, error)
  }
  if (!data) {
    throw new PipelineError(`scene が見つかりません: ${sceneId}`)
  }
  return data as Scene
}

/**
 * 削除済みシーンに対する fire-and-forget ジョブを早期 return するためのチェック。
 * 「シーン追加→削除→追加」を高速連打したときに、消えたシーンのために
 * 画像/音声 API を呼び続けるのを防ぐ。
 *
 * @returns true なら scene はまだ存在する (= 処理を続行してよい)
 */
async function sceneExists(sceneId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('scenes')
    .select('id')
    .eq('id', sceneId)
    .maybeSingle()
  if (error) return false
  return Boolean(data)
}

async function updateVideoStatus(
  videoId: string,
  status: VideoStatus,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('videos')
    .update({ status, ...patch })
    .eq('id', videoId)
  if (error) {
    throw new PipelineError(
      `videos.status (${status}) の更新に失敗しました: ${error.message}`,
      error,
    )
  }
}

async function markVideoFailed(videoId: string, message: string): Promise<void> {
  const supabase = createAdminClient()
  // 失敗書き込み自体が失敗しても呼び出し側は救えないので best-effort で握りつぶす。
  await supabase
    .from('videos')
    .update({ status: 'failed', error_message: message })
    .eq('id', videoId)
}

async function updateSceneRow(
  sceneId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('scenes')
    .update(patch)
    .eq('id', sceneId)
  if (error) {
    throw new PipelineError(
      `scenes(${sceneId}) の更新に失敗しました: ${error.message}`,
      error,
    )
  }
}

async function fetchOpenAiKey(userId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('openai_key')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    throw new PipelineError(`OpenAI API キー取得に失敗しました: ${error.message}`, error)
  }
  const decrypted = decryptSecret(data?.openai_key ?? null)?.trim() || null
  if (!decrypted) {
    throw new MissingApiKeyError('openai')
  }
  return decrypted
}

// ---------------------------------------------------------------------------
// Step 1: script
// ---------------------------------------------------------------------------

interface EnsureScriptOptions {
  sceneCount?: number | null
  targetDurationSec?: number | null
  /** 'remotion' のとき scenes 行を作る。'heygen_avatar' は scenes を作らず script 文字列だけ返す */
  mode: GenerationMode
}

interface EnsureScriptResult {
  script: string
  /** Remotion 経路では新規 / 既存の scenes を返す。HeyGen 経路では空配列。 */
  scenes: SceneDraft[]
}

/**
 * 台本を idempotent に生成 / 復元する内部ヘルパー。
 *
 * - videos.script が既にあれば再生成しない（status も更新しない）
 *   - Remotion 経路では scenes 行も既に挿入済みである前提だが、念のため空でも続行する
 *   - HeyGen 経路では scenes 行は使わないため、保存済み script をそのまま返すだけで OK
 * - 未生成なら videos.status を 'generating_script' にして
 *   generateVideoScript() を呼び、結果を永続化する
 *
 * Remotion / HeyGen の両方からこのヘルパーを呼ぶ。Remotion 経路の生成元は
 * `generateScript()`、HeyGen 経路の生成元は `runHeyGenPipeline()`。
 */
async function ensureScript(
  videoId: string,
  video: Pick<Video, 'script' | 'title' | 'user_id'>,
  theme: string,
  opts: EnsureScriptOptions,
): Promise<EnsureScriptResult> {
  // 既に生成済み → そのまま返す。status 更新もしない（idempotent）。
  // ただし Remotion 経路で「script はあるが scenes が無い」状態は壊れているので再生成する
  // (元の generateScript と同じ判定)。
  if (video.script && video.script.trim().length > 0) {
    if (opts.mode === 'remotion') {
      const existing = await loadScenes(videoId)
      if (existing.length > 0) {
        const drafts: SceneDraft[] = existing.map((s) => ({
          caption_text: s.caption_text ?? '',
          narration_text: s.narration_text ?? '',
          image_prompt: s.image_prompt ?? '',
          duration: typeof s.duration === 'number' ? s.duration : 3,
        }))
        return { script: video.script, scenes: drafts }
      }
      // scenes が無い → 下に落ちて再生成
    } else {
      // HeyGen 経路: scenes は使わないので script だけ揃っていれば OK
      return { script: video.script, scenes: [] }
    }
  }

  await updateVideoStatus(videoId, 'generating_script')

  const scriptOpts: { theme: string; sceneCount?: number; targetDurationSec?: number } = { theme }
  if (typeof opts.sceneCount === 'number') scriptOpts.sceneCount = opts.sceneCount
  if (typeof opts.targetDurationSec === 'number') {
    scriptOpts.targetDurationSec = opts.targetDurationSec
  }

  const draft = await generateVideoScript(scriptOpts, { userId: video.user_id })

  const supabase = createAdminClient()
  // タイトル / 台本を反映 (videos.title が "Untitled" の場合のみ更新)
  const videoUpdate: Record<string, unknown> = {
    script: draft.script,
  }
  if (!video.title || video.title === 'Untitled') {
    videoUpdate.title = draft.title
  }
  const { error: videoErr } = await supabase
    .from('videos')
    .update(videoUpdate)
    .eq('id', videoId)
  if (videoErr) {
    throw new PipelineError(`videos の台本反映に失敗: ${videoErr.message}`, videoErr)
  }

  // Remotion 経路のときだけ scenes 行を挿入する。
  if (opts.mode === 'remotion') {
    // 既存 scenes をクリアしてから再生成（script が空だった = 整合性を取り直す）
    const { error: delErr } = await supabase.from('scenes').delete().eq('video_id', videoId)
    if (delErr) {
      throw new PipelineError(`既存 scenes の削除に失敗: ${delErr.message}`, delErr)
    }
    const rows = draft.scenes.map((s, idx) => ({
      video_id: videoId,
      order_index: idx,
      caption_text: s.caption_text,
      narration_text: s.narration_text,
      image_prompt: s.image_prompt,
      duration: s.duration,
    }))
    const { error: insErr } = await supabase.from('scenes').insert(rows)
    if (insErr) {
      throw new PipelineError(`scenes の挿入に失敗: ${insErr.message}`, insErr)
    }
  }

  return { script: draft.script, scenes: draft.scenes }
}

/**
 * テーマから台本を生成し、videos.script と scenes 行を埋める (Remotion 経路用)。
 * scenes がすでに存在する場合はスキップ (idempotent)。
 */
export async function generateScript(
  videoId: string,
  theme: string,
  opts: { sceneCount?: number | null; targetDurationSec?: number | null } = {},
): Promise<void> {
  const video = await loadVideo(videoId)
  const ensureOpts: EnsureScriptOptions = { mode: 'remotion' }
  if (typeof opts.sceneCount === 'number') ensureOpts.sceneCount = opts.sceneCount
  if (typeof opts.targetDurationSec === 'number') {
    ensureOpts.targetDurationSec = opts.targetDurationSec
  }
  await ensureScript(videoId, video, theme, ensureOpts)
}

// ---------------------------------------------------------------------------
// Step 2: images
// ---------------------------------------------------------------------------

interface ImageGenInput {
  prompt: string
  userId: string
  videoId: string
  sceneOrder: number
}

interface ImageGenOutput {
  storagePath: string
  signedUrl: string
}

async function generateOneImage(
  input: ImageGenInput,
  openaiKey: string,
): Promise<ImageGenOutput> {
  // maxRetries で 429 (rate limit) を SDK が Retry-After を尊重して自動リトライする。
  const client = new OpenAI({ apiKey: openaiKey, timeout: IMAGE_TIMEOUT_MS, maxRetries: IMAGE_MAX_RETRIES })

  // SDK の return 型に依存せず、runtime で必要なフィールドのみ narrowing する。
  // double-cast (`as unknown as Foo`) は型エラーを潰すだけで実行時の安全性を担保しない。
  const res: unknown = await client.images.generate({
    model: IMAGE_MODEL,
    prompt: input.prompt,
    size: IMAGE_SIZE,
    n: 1,
    quality: 'medium',
  })

  const b64 = extractB64Json(res)
  if (!b64) {
    throw new PipelineError('画像 API から base64 データが返りませんでした')
  }
  const bytes = Buffer.from(b64, 'base64')
  return uploadSceneImage({
    userId: input.userId,
    videoId: input.videoId,
    sceneOrder: input.sceneOrder,
    imageBytes: bytes,
    contentType: 'image/png',
  })
}

/**
 * OpenAI images.generate のレスポンスから `data[0].b64_json` を安全に取り出す。
 * SDK バージョン揺れと「フィールド欠落」両方を runtime check で吸収する。
 */
function extractB64Json(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const data = (raw as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) return null
  const first = data[0]
  if (!first || typeof first !== 'object') return null
  const b64 = (first as { b64_json?: unknown }).b64_json
  return typeof b64 === 'string' && b64.length > 0 ? b64 : null
}

/**
 * 動画内の全シーンの画像を並列生成する。
 * 既に image_url を持つシーンはスキップ。
 *
 * 並列度はモデルのレートリミットに依存するが、ここでは Promise.allSettled で
 * 落ちたシーンを個別に failed として記録する方針。
 */
export async function generateSceneImages(videoId: string): Promise<void> {
  const video = await loadVideo(videoId)
  const scenes = await loadScenes(videoId)
  if (scenes.length === 0) {
    throw new PipelineError('シーンがありません。先に generateScript を実行してください')
  }
  await updateVideoStatus(videoId, 'generating_images')

  const todo = scenes.filter(s => !s.image_url && typeof s.image_prompt === 'string')
  if (todo.length === 0) return

  const openaiKey = await fetchOpenAiKey(video.user_id)

  // gpt-image-2 は組織あたり "5枚/分" 等の制限があるので並列度を絞る。
  // 全件並列だと 429 で後半シーンが落ちる。超過分は SDK の自動リトライで回復。
  const results = await mapWithConcurrency(todo, IMAGE_CONCURRENCY, async (scene) => {
    const out = await generateOneImage(
      {
        prompt: scene.image_prompt as string,
        userId: video.user_id,
        videoId,
        sceneOrder: scene.order_index,
      },
      openaiKey,
    )
    await updateSceneRow(scene.id, { image_url: out.storagePath })
    return out
  })

  const failures = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
  if (failures.length > 0) {
    const summary = failures
      .map((f, i) => `[${i}] ${f.reason instanceof Error ? sanitizeProviderError(f.reason) : String(f.reason)}`)
      .join('; ')
    throw new PipelineError(`画像生成で ${failures.length}/${todo.length} 件が失敗: ${summary}`)
  }
}

// ---------------------------------------------------------------------------
// Step 3: voice
// ---------------------------------------------------------------------------

/**
 * 各シーンのナレーション音声を並列生成し、scenes.audio_url を更新する。
 * durationEstimateSec は scenes.duration に反映 (Remotion のタイムライン精度向上のため)。
 */
export async function generateSceneAudio(videoId: string): Promise<void> {
  const video = await loadVideo(videoId)
  const scenes = await loadScenes(videoId)
  if (scenes.length === 0) {
    throw new PipelineError('シーンがありません')
  }
  await updateVideoStatus(videoId, 'generating_voice')

  const todo = scenes.filter(s => !s.audio_url && typeof s.narration_text === 'string')
  if (todo.length === 0) return

  const voiceOpts: ElevenLabsVoiceOptions = {
    voiceId: video.elevenlabs_voice_id ?? DEFAULT_VOICE_ID,
  }

  // ElevenLabs は同時リクエスト数制限が厳しいので並列度を絞る。
  // 全件並列だと 429 (rate limit) に当たって途中で落ちる。
  const results = await mapWithConcurrency(todo, TTS_CONCURRENCY, async (scene) => {
    const res = await generateSceneNarration(scene.narration_text as string, voiceOpts, video.user_id)
    const uploaded = await uploadSceneAudio({
      userId: video.user_id,
      videoId,
      sceneOrder: scene.order_index,
      audioBytes: res.audioBytes,
      contentType: res.mimeType,
    })
    // duration は「ナレーション尺 + 末尾無音バッファ」で補正
    // (最低 SCENE_DURATION_MIN_SEC、最大 SCENE_DURATION_MAX_SEC)
    const corrected = Math.max(
      SCENE_DURATION_MIN_SEC,
      Math.min(SCENE_DURATION_MAX_SEC, res.durationEstimateSec + SCENE_TAIL_GAP_SEC),
    )
    await updateSceneRow(scene.id, {
      audio_url: uploaded.storagePath,
      duration: Math.round(corrected * 10) / 10,
    })
    return uploaded
  })

  const failures = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
  if (failures.length > 0) {
    const summary = failures
      .map((f, i) => `[${i}] ${f.reason instanceof Error ? sanitizeProviderError(f.reason) : String(f.reason)}`)
      .join('; ')
    throw new PipelineError(`音声生成で ${failures.length}/${todo.length} 件が失敗: ${summary}`)
  }
}

// ---------------------------------------------------------------------------
// Step 4: render
// ---------------------------------------------------------------------------

interface RemotionSceneProps {
  caption_text: string
  narration_text: string
  image_url: string
  audio_url: string
  duration: number
}

interface RemotionInputProps {
  title: string
  scenes: RemotionSceneProps[]
}

async function buildRenderInputProps(
  video: Video,
  scenes: Scene[],
): Promise<RemotionInputProps> {
  // Remotion はレンダー時に image_url / audio_url を直接 fetch するため、
  // ここで毎回 signed URL を再発行する (リトライで使い回せるように)。
  const scenesProps: RemotionSceneProps[] = await Promise.all(
    scenes.map(async (s) => {
      if (!s.image_url) {
        throw new PipelineError(`scene[${s.order_index}] に image_url がありません`)
      }
      if (!s.audio_url) {
        throw new PipelineError(`scene[${s.order_index}] に audio_url がありません`)
      }
      const [imageSigned, audioSigned] = await Promise.all([
        getSignedUrl(s.image_url, 60 * 60 * 6),
        getSignedUrl(s.audio_url, 60 * 60 * 6),
      ])
      return {
        caption_text: s.caption_text ?? '',
        narration_text: s.narration_text ?? '',
        image_url: imageSigned,
        audio_url: audioSigned,
        duration: typeof s.duration === 'number' ? s.duration : 3,
      }
    }),
  )

  return {
    title: video.title ?? '',
    scenes: scenesProps,
  }
}

// バンドルパスはプロセス内でキャッシュする (バンドルは数秒〜数十秒かかる)。
// 本番デプロイでは build-time に一度バンドルして
// REMOTION_BUNDLE_PATH 環境変数で固定パスを指す運用を推奨。
let cachedBundlePath: string | null = null

async function ensureRemotionBundle(): Promise<string> {
  if (cachedBundlePath) return cachedBundlePath
  const preBundled = process.env.REMOTION_BUNDLE_PATH?.trim()
  if (preBundled) {
    cachedBundlePath = preBundled
    return preBundled
  }
  // 動的 import: bundler は重いので必要なときだけ読む
  const bundler = await import('@remotion/bundler').catch((e: unknown) => {
    throw new PipelineError('@remotion/bundler の読み込みに失敗', e)
  })
  const entry = path.resolve(process.cwd(), 'remotion/src/index.ts')
  const bundled = await bundler.bundle({
    entryPoint: entry,
    // 出力先は Next の build 出力に混ざらない一時ディレクトリ
    outDir: path.resolve(os.tmpdir(), `remotion-bundle-${process.pid}`),
    onProgress: () => undefined,
  })
  cachedBundlePath = bundled
  return bundled
}

async function renderWithLocalRemotion(
  inputProps: RemotionInputProps,
  outputLocation: string,
): Promise<void> {
  const renderer = await import('@remotion/renderer').catch((e: unknown) => {
    throw new PipelineError('@remotion/renderer の読み込みに失敗', e)
  })
  const serveUrl = await ensureRemotionBundle()
  const composition = await renderer.selectComposition({
    serveUrl,
    id: 'ShortVideoMain',
    inputProps: inputProps as unknown as Record<string, unknown>,
  })
  await renderer.renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    // CRF でファイルサイズを抑える (Supabase の 50MB アップロード上限対策)。
    crf: VIDEO_CRF,
    outputLocation,
    inputProps: inputProps as unknown as Record<string, unknown>,
    // Chrome を都度起動するコストを許容。production では事前ビルドキャッシュを使う。
    chromiumOptions: {},
  })
}

async function renderWithRemotionLambda(
  _inputProps: RemotionInputProps,
  _outputLocation: string,
): Promise<void> {
  // TODO(prod): @remotion/lambda の renderMediaOnLambda を呼び出す。
  // 必要な環境変数:
  //   - REMOTION_AWS_REGION
  //   - REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY
  //   - REMOTION_LAMBDA_FUNCTION_NAME
  //   - REMOTION_LAMBDA_SERVE_URL (S3 にアップロード済みのバンドル URL)
  // 戻り値の S3 オブジェクトをダウンロードして outputLocation に書き出す。
  throw new PipelineError(
    'REMOTION_PROVIDER=lambda は未実装です。@remotion/lambda の組み込みが必要です',
  )
}

/**
 * Remotion で最終 MP4 をレンダリングし、Supabase Storage にアップロードする。
 * 既に final_video_url がある場合はスキップ (idempotent)。
 */
export async function renderFinalVideo(videoId: string): Promise<void> {
  const video = await loadVideo(videoId)
  if (video.final_video_url) return // 既にレンダリング済み

  const scenes = await loadScenes(videoId)
  if (scenes.length === 0) {
    throw new PipelineError('シーンがありません。レンダリング対象がありません')
  }

  await updateVideoStatus(videoId, 'rendering')

  const inputProps = await buildRenderInputProps(video, scenes)

  // 一時ファイルに書き出してから Storage にアップロード。
  // Remotion のレンダラーは「ファイルパス」しか受け取らないため Buffer 直書きはできない。
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-render-'))
  const outputLocation = path.join(tmpDir, `${videoId}.mp4`)

  try {
    if (REMOTION_PROVIDER === 'lambda') {
      await renderWithRemotionLambda(inputProps, outputLocation)
    } else {
      await renderWithLocalRemotion(inputProps, outputLocation)
    }

    const mp4 = await fs.readFile(outputLocation)
    const uploaded = await uploadFinalVideo({
      userId: video.user_id,
      videoId,
      mp4Bytes: new Uint8Array(mp4),
    })
    // storage path を保存する（signed URL は有効期限があるため本体として保存しない）。
    // 読み取り時に signed-urls.ts の decorateVideoWithSignedUrls / resolveAssetUrl が署名する。
    // scenes.image_url / audio_url と同じ「path 保存・読み取り時に署名」方針に統一。
    await updateVideoStatus(videoId, 'ready', {
      final_video_url: uploaded.storagePath,
      error_message: null,
    })
  } finally {
    // 一時ディレクトリは best-effort で削除
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// State machine: runVideoPipeline
// ---------------------------------------------------------------------------

/**
 * 1 本の動画をエンドツーエンドで生成する。
 *
 * すでに進んでいるフェーズはスキップ (videos.status を見て resume)。
 * バックグラウンドジョブから呼ばれることを想定し、例外は外に投げず
 * failed ステータスに落としてからリターンする。
 */
/**
 * 生成ジョブの実行ロックを取得する。
 * compare-and-set で「draft → generating_script」に遷移できたジョブだけが処理を進める。
 * 既に generating_* / rendering / ready の場合は別ジョブが処理中（または完了済み）なので
 * false を返し、二重実行（= 二重課金）を防ぐ。
 *
 * 新規(POST /api/videos)・restart(failed→draft) いずれも draft から来るので draft を起点にする。
 */
async function acquireGenerationLock(videoId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('videos')
    .update({ status: 'generating_script' })
    .eq('id', videoId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (error) {
    throw new PipelineError(`生成ロックの取得に失敗しました: ${error.message}`, error)
  }
  return Boolean(data)
}

export async function runVideoPipeline(
  videoId: string,
  opts: PipelineRunOptions = {},
): Promise<void> {
  try {
    const video = await loadVideo(videoId)

    // 既に終了している場合は何もしない
    if (video.status === 'ready') return

    // 多重実行ロック: draft からのみ acquire。取れなければ別ジョブが処理中なので終了。
    // （プロセス再投入や enqueue リトライによる二重生成・二重課金を防ぐ）
    const acquired = await acquireGenerationLock(videoId)
    if (!acquired) {
      console.warn(`[pipeline] ${videoId} は既に処理中または完了済み。二重実行を回避します`)
      return
    }

    // generation_mode で分岐。
    // - 'remotion'      : 既存の Script → Images → Voice → Render フロー
    // - 'heygen_avatar' : Script → Voice(任意) → HeyGen レンダリング
    if (video.generation_mode === 'heygen_avatar') {
      await runHeyGenPipeline(video, opts)
      return
    }

    // script を必要としているか判定。
    // theme カラムは videos に無いため、ジョブ起動側で渡してもらう。
    // 未指定なら videos.title をテーマ代わりに使う (route が title=theme.slice(0,80) を入れる想定)。
    if (!video.script) {
      const theme = (opts.theme?.trim() || video.title?.trim() || '').trim()
      if (!theme) {
        throw new PipelineError('theme も videos.title も空のため script を生成できません')
      }
      await generateScript(videoId, theme, {
        sceneCount: opts.sceneCount,
        targetDurationSec: opts.targetDurationSec,
      })
    }

    // 画像 → 音声 → レンダリング を順に。各 step は idempotent。
    await generateSceneImages(videoId)
    await generateSceneAudio(videoId)
    await renderFinalVideo(videoId)
  } catch (err: unknown) {
    const message = err instanceof Error ? sanitizeProviderError(err) : 'unknown pipeline error'
    await markVideoFailed(videoId, message)
    // ジョブ実行コンテキストでは throw しても上流が拾えないため、ここで終了。
    return
  }
}

// ---------------------------------------------------------------------------
// HeyGen avatar pipeline
// ---------------------------------------------------------------------------

/**
 * HeyGen ダウンロード時の上限。HeyGen の出力は通常 数十MB だが、
 * 念のため 200MB を超えるレスポンスは「異常」として弾く。
 */
const HEYGEN_DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024

// ステータスポーリングはサーバー内ループではなく、クライアント駆動の単発チェック
// (checkAndFinalizeHeyGen) に分離したため、旧ポーリング設定 (interval/timeout) は廃止。

const HEYGEN_OUTPUT_DIMENSION = { width: 1080, height: 1920 } as const

/**
 * Supabase signed URL の `token` クエリパラメータから JWT exp を取り出して
 * 期限切れか判定する。デコード不能 / exp 不在のときは「期限切れ扱い」にして
 * 安全側に倒す (= 再生成する)。
 *
 * Node の Buffer を使った base64url デコード。失敗しても throw しない。
 */
function isSignedUrlExpired(signedUrl: string, skewMs = 60_000): boolean {
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
    // exp は秒単位、Date.now() は ms 単位。skew (= 60秒) のマージンを取る。
    return payload.exp * 1000 <= Date.now() + skewMs
  } catch {
    return true
  }
}

/**
 * Step A: HeyGen 用の voice 入力を用意する。
 *
 * voice_source ごとの分岐:
 *   - 'elevenlabs':
 *       videos.voice_url が有効な signed URL ならそれを再利用 (status 更新もしない)。
 *       無効 or 未設定なら ElevenLabs で合成 → Storage にアップロード → voice_url を永続化。
 *       このとき videos.status を 'generating_voice' に遷移させる。
 *   - 'heygen':
 *       HeyGen 内蔵 TTS を使うため ElevenLabs 合成は不要。
 *       generating_voice 状態には遷移しない (script → rendering 直行)。
 */
async function ensureHeyGenVoice(
  video: Video,
  scriptText: string,
): Promise<HeyGenVoiceInput> {
  if (video.voice_source === 'heygen') {
    if (!video.heygen_voice_id) {
      throw new PipelineError('voice_source=heygen には heygen_voice_id が必要です')
    }
    return {
      type: 'text',
      voiceId: video.heygen_voice_id,
      inputText: scriptText,
    }
  }

  if (video.voice_source !== 'elevenlabs') {
    throw new PipelineError(`未知の voice_source: ${String(video.voice_source)}`)
  }

  // ElevenLabs 経路: voice_url を再利用できるなら再合成しない
  if (video.voice_url && !isSignedUrlExpired(video.voice_url)) {
    return { type: 'audio', audioUrl: video.voice_url }
  }

  // 未生成 or 期限切れ → 合成してアップロード
  await updateVideoStatus(video.id, 'generating_voice')

  const narrationRes = await generateFullNarration([scriptText], {}, video.user_id)
  const uploaded = await uploadVideoVoice({
    userId: video.user_id,
    videoId: video.id,
    bytes: narrationRes.audioBytes,
    mimeType: narrationRes.mimeType,
  })

  // signedUrl を永続化 (final_video_url と同じ運用)。次回レジューム時に再利用する。
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('videos')
    .update({ voice_url: uploaded.signedUrl })
    .eq('id', video.id)
  if (error) {
    throw new PipelineError(`videos.voice_url の保存に失敗: ${error.message}`, error)
  }

  return { type: 'audio', audioUrl: uploaded.signedUrl }
}

/**
 * Step B: HeyGen 動画ジョブを投入する (または既存ジョブの id を返す)。
 *
 * videos.heygen_video_id が既にセットされていればジョブ再投入はせず、その id を返す。
 * 新規投入時は generated id を即座に DB に永続化してから返す
 * (ジョブが進行中にクラッシュしても再開できるように)。
 */
async function ensureHeyGenJob(
  video: Video,
  voice: HeyGenVoiceInput,
): Promise<string> {
  if (video.heygen_video_id) {
    return video.heygen_video_id
  }

  if (!video.heygen_avatar_id) {
    throw new PipelineError('HeyGen 動画には heygen_avatar_id の指定が必要です')
  }

  const { videoId: heygenVideoId } = await generateAvatarVideo({
    userId: video.user_id,
    avatarId: video.heygen_avatar_id,
    dimension: HEYGEN_OUTPUT_DIMENSION,
    voice,
  })

  // 後で再ポーリングできるよう video_id を即座に永続化。
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('videos')
    .update({ heygen_video_id: heygenVideoId })
    .eq('id', video.id)
  if (error) {
    throw new PipelineError(`heygen_video_id の保存に失敗: ${error.message}`, error)
  }
  return heygenVideoId
}

/**
 * Step C: HeyGen ジョブをポーリングし、完成 MP4 を取り込んで Storage に再アップロード、
 * videos.status を 'ready' に遷移させる。
 */
export type HeyGenCheckState = 'rendering' | 'ready' | 'failed'

/**
 * HeyGen ジョブの状態を「1回だけ」確認し、完了していれば MP4 をダウンロードして
 * Storage に保存し ready に遷移させる。未完了なら何もしない（rendering 継続）。
 *
 * Vercel タイムアウト対策: 旧 finalizeHeyGenOutput は完了まで最大15分ポーリングしていたが、
 * これを単発チェックに分離した。クライアントが status エンドポイントを数秒ごとに叩くたびに
 * この関数が呼ばれ、HeyGen 側が完了した時点で finalize される。
 *
 * 冪等: final_video_url が既にあれば ready 化のみ。完了検知時の download+upload は
 * uploadFinalVideo が upsert なので二重実行されても上書きで安全。
 */
export async function checkAndFinalizeHeyGen(
  videoId: string,
  expectedUserId?: string,
): Promise<HeyGenCheckState> {
  const video = await loadVideo(videoId)
  if (expectedUserId && video.user_id !== expectedUserId) {
    throw new PipelineError('動画の所有者が一致しません')
  }
  if (video.generation_mode !== 'heygen_avatar') {
    throw new PipelineError('HeyGen アバター動画ではありません')
  }
  // 既に完成
  if (video.final_video_url) {
    if (video.status !== 'ready') {
      await updateVideoStatus(videoId, 'ready', { error_message: null })
    }
    return 'ready'
  }
  // まだジョブ未投入（投入処理が走行中）
  if (!video.heygen_video_id) return 'rendering'

  try {
    const status = await getHeyGenVideoStatus(video.user_id, video.heygen_video_id)
    if (status.status === 'completed') {
      if (!status.videoUrl) {
        throw new PipelineError('HeyGen から動画 URL が返りませんでした')
      }
      const mp4Bytes = await downloadHeyGenVideo(status.videoUrl)
      const uploaded = await uploadFinalVideo({
        userId: video.user_id,
        videoId: video.id,
        mp4Bytes,
      })
      await updateVideoStatus(videoId, 'ready', {
        final_video_url: uploaded.storagePath,
        published_to: [],
        publish_status: 'unpublished',
        error_message: null,
      })
      return 'ready'
    }
    if (status.status === 'failed') {
      await markVideoFailed(videoId, status.errorMessage ?? 'HeyGen 動画生成に失敗しました')
      return 'failed'
    }
    // pending / processing / waiting → 継続
    return 'rendering'
  } catch (e) {
    // status 取得や download の一時エラーは failed にせず rendering を返して次回ポーリングに委ねる。
    console.error('[checkAndFinalizeHeyGen]', videoId, e instanceof Error ? e.message : 'unknown')
    return 'rendering'
  }
}

/**
 * HeyGen アバター動画パイプライン（オーケストレーター）。
 *
 * Remotion 経路と異なり scenes 行は作らない (連続ナレーション 1 本)。
 * フェーズ:
 *   generating_script → (generating_voice : voice_source='elevenlabs' のときのみ) → rendering → ready
 *
 * voice_source:
 *   - 'elevenlabs' : ElevenLabs で MP3 を生成し、署名付き URL を HeyGen に渡す
 *                    (videos.voice_url に永続化して再開時に再利用する)
 *   - 'heygen'     : HeyGen 内蔵 TTS を使う (heygen_voice_id 必須)
 *
 * 各ステップは idempotent:
 *   - script は videos.script があれば再生成しない
 *   - voice は videos.voice_url が有効ならそのまま使う
 *   - HeyGen ジョブは videos.heygen_video_id があれば再投入せず再ポーリングする
 *   - 最終 MP4 は videos.final_video_url があればスキップして ready 化のみ行う
 */
async function runHeyGenPipeline(
  video: Video,
  opts: PipelineRunOptions,
): Promise<void> {
  const videoId = video.id

  // 既に最終 MP4 が出ているケースの defensive guard
  // (restartFailedVideo + reentrant な resume を想定)
  if (video.final_video_url) {
    await updateVideoStatus(videoId, 'ready', { error_message: null })
    return
  }

  // 必須パラメータ事前検証
  if (!video.voice_source) {
    throw new PipelineError('HeyGen 動画には voice_source の指定が必要です')
  }
  if (!video.heygen_avatar_id) {
    throw new PipelineError('HeyGen 動画には heygen_avatar_id の指定が必要です')
  }

  // --- Step 1: script -------------------------------------------------
  const theme = (opts.theme?.trim() || video.title?.trim() || '').trim()
  if (!video.script && !theme) {
    throw new PipelineError('theme も videos.title も空のため script を生成できません')
  }
  const ensureOpts: EnsureScriptOptions = { mode: 'heygen_avatar' }
  if (typeof opts.sceneCount === 'number') ensureOpts.sceneCount = opts.sceneCount
  if (typeof opts.targetDurationSec === 'number') {
    ensureOpts.targetDurationSec = opts.targetDurationSec
  }
  const ensured = await ensureScript(videoId, video, theme, ensureOpts)
  let scriptText = ensured.script.trim()

  // HeyGen は連続ナレーション 1 本。新規生成時は scenes[].narration_text を結合した方が
  // 自然なナレーションになるので、scenes ドラフトがあれば優先する。
  if (ensured.scenes.length > 0) {
    const joined = ensured.scenes
      .map((s) => s.narration_text?.trim() ?? '')
      .filter((s) => s.length > 0)
      .join('\n\n')
    if (joined.length > 0) {
      scriptText = joined
    }
  }
  if (!scriptText) {
    throw new PipelineError('生成された script が空です')
  }

  // 最新の video 行を取得し直す (ensureScript が title / script を更新している可能性あり)
  const refreshed = await loadVideo(videoId)

  // --- Step 2: voice --------------------------------------------------
  const voice = await ensureHeyGenVoice(refreshed, scriptText)

  // --- Step 3: HeyGen ジョブ投入 (or 既存ジョブ id を回収) -----------
  await updateVideoStatus(videoId, 'rendering')
  // ensureHeyGenJob は最新の video を見たいので、voice_url 更新後の状態を再取得
  const refreshedForJob = await loadVideo(videoId)
  await ensureHeyGenJob(refreshedForJob, voice)

  // Step4 (完了ポーリング → ダウンロード → 保存 → ready) は分離した。
  // クライアントが status エンドポイントを叩くたびに checkAndFinalizeHeyGen が
  // HeyGen 側の完了を確認して finalize する（Vercel の長時間ポーリング制限を回避）。
  // ここでは heygen_video_id を保存して status=rendering のまま終える。
}

/**
 * HeyGen が返した公開 MP4 URL を fetch してバイト列を取り出す。
 *
 * セキュリティ / 安定性のための多層防御:
 *   - assertFetchableVideoUrl: https 限定 + ループバック / RFC1918 / リンクローカル拒否
 *   - redirect: 'manual'      : リダイレクト経由の SSRF 迂回を遮断
 *   - AbortSignal.timeout     : ボディダウンロードに 2 分の上限
 *   - Content-Type 検証       : video/* 以外は拒否（body 読む前に判定）
 *   - ストリーミングでサイズ加算  : 200MB 上限を超えた瞬間に reader.cancel() して
 *                                 メモリを確保せず early abort
 *   (publishers.ts:fetchVideoBytesSafe と同じパターン)
 */
async function downloadHeyGenVideo(videoUrl: string): Promise<Uint8Array> {
  assertFetchableVideoUrl(videoUrl)

  let res: Response
  try {
    res = await fetch(videoUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown fetch error'
    throw new PipelineError(`HeyGen 動画のダウンロードに失敗しました: ${message}`, e)
  }

  if (res.type === 'opaqueredirect') {
    throw new PipelineError('HeyGen 動画 URL がリダイレクトを返しました（許可されていません）')
  }
  if (!res.ok) {
    throw new PipelineError(`HeyGen 動画のダウンロードに失敗しました (HTTP ${res.status})`)
  }

  // Content-Type は body 読む前に判定
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('video/')) {
    throw new PipelineError(`HeyGen 動画の Content-Type が不正です: ${contentType || 'unknown'}`)
  }

  // Content-Length が事前に上限超えを宣言していたら即拒否 (body 読まない)
  const contentLengthHeader = res.headers.get('content-length')
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader)
    if (Number.isFinite(declared) && declared > HEYGEN_DOWNLOAD_MAX_BYTES) {
      throw new PipelineError(
        `HeyGen 動画のサイズが上限を超えています: ${declared} bytes`,
      )
    }
  }

  // body 不在のフォールバック (Node fetch では実質到達しない)
  if (!res.body) {
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) {
      throw new PipelineError('HeyGen 動画のレスポンスが空でした')
    }
    if (buf.byteLength > HEYGEN_DOWNLOAD_MAX_BYTES) {
      throw new PipelineError(
        `HeyGen 動画のサイズが上限を超えています: ${buf.byteLength} bytes`,
      )
    }
    return new Uint8Array(buf)
  }

  // ストリーミング: チャンク単位でサイズチェック → 超過したら abort
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > HEYGEN_DOWNLOAD_MAX_BYTES) {
        await reader.cancel('size limit exceeded').catch(() => undefined)
        throw new PipelineError(
          `HeyGen 動画のサイズが上限を超えています: ${received} bytes`,
        )
      }
      chunks.push(value)
    }
  } finally {
    try { reader.releaseLock() } catch { /* noop */ }
  }

  if (received === 0) {
    throw new PipelineError('HeyGen 動画のレスポンスが空でした')
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  return bytes
}

// ---------------------------------------------------------------------------
// 単一シーン再生成
// ---------------------------------------------------------------------------

/**
 * 1 シーンの画像だけを再生成する (ユーザーの「やり直し」ボタン用)。
 * 動画ステータスは変えない。
 */
export async function regenerateSceneImage(sceneId: string, expectedVideoId?: string): Promise<void> {
  const scene = await loadSceneById(sceneId, expectedVideoId)
  if (!scene.image_prompt) {
    throw new PipelineError('image_prompt が無いため再生成できません')
  }
  const video = await loadVideo(scene.video_id)
  const openaiKey = await fetchOpenAiKey(video.user_id)
  const out = await generateOneImage(
    {
      prompt: scene.image_prompt,
      userId: video.user_id,
      videoId: scene.video_id,
      sceneOrder: scene.order_index,
    },
    openaiKey,
  )
  // 画像生成中にシーンが削除されているケースの保護。
  // upload は完了するが DB の image_url 更新で 0 行ヒット → 課金は発生済みなので
  // ログだけ残す。
  if (!(await sceneExists(sceneId))) {
    console.warn(`[regenerateSceneImage] scene ${sceneId} は削除済み。生成結果は破棄します`)
    return
  }
  await updateSceneRow(scene.id, { image_url: out.storagePath })
  // 画像が変わると最終動画も再レンダリング対象。final_video_url をクリアする。
  await createAdminClient()
    .from('videos')
    .update({ final_video_url: null })
    .eq('id', scene.video_id)
    .throwOnError()
}

/**
 * シーンの本文 (caption_text / narration_text / image_prompt) を更新する。
 * narration_text が変わった場合は audio_url をクリア → 呼び出し側で再生成を発火する想定。
 * 画像プロンプトが変わった場合も image_url をクリアする。
 * いずれにせよ final_video_url はクリアして再レンダー対象にする。
 */
export async function updateSceneTexts(
  sceneId: string,
  patch: { caption_text?: string; narration_text?: string; image_prompt?: string },
  expectedVideoId?: string,
): Promise<{ narrationChanged: boolean; imageChanged: boolean }> {
  const scene = await loadSceneById(sceneId, expectedVideoId)
  const updates: Record<string, unknown> = {}
  let narrationChanged = false
  let imageChanged = false

  if (typeof patch.caption_text === 'string' && patch.caption_text !== scene.caption_text) {
    updates.caption_text = patch.caption_text.slice(0, 500)
  }
  if (typeof patch.narration_text === 'string' && patch.narration_text !== scene.narration_text) {
    updates.narration_text = patch.narration_text.slice(0, 1000)
    updates.audio_url = null // 旧音声を無効化
    narrationChanged = true
  }
  if (typeof patch.image_prompt === 'string' && patch.image_prompt !== scene.image_prompt) {
    updates.image_prompt = patch.image_prompt.slice(0, 1000)
    updates.image_url = null
    imageChanged = true
  }
  if (Object.keys(updates).length === 0) {
    return { narrationChanged, imageChanged }
  }
  await updateSceneRow(sceneId, updates)
  // 何かしら変わったら最終MP4も古くなるので無効化
  await createAdminClient()
    .from('videos')
    .update({ final_video_url: null })
    .eq('id', scene.video_id)
    .throwOnError()
  return { narrationChanged, imageChanged }
}

/**
 * 動画の全シーンの音声を作り直す。voice 変更時の挙動。
 *
 * 全シーンの audio_url を null クリア → generateSceneAudio() を再走 → final_video_url クリア。
 * 失敗時は markVideoFailed で 'failed' 状態に落とす。
 *
 * fire-and-forget で呼び出されることを想定。
 */
export async function regenerateAllSceneAudio(videoId: string, expectedUserId?: string): Promise<void> {
  try {
    const video = await loadVideo(videoId)
    // 防御層: 呼び出し元が userId を渡したら所有者照合（将来 user_id 検証が漏れても守る）
    if (expectedUserId && video.user_id !== expectedUserId) {
      throw new PipelineError('動画の所有者が一致しません')
    }
    if (video.generation_mode !== 'remotion') {
      throw new PipelineError('HeyGen アバター動画には対応していません')
    }
    const supabase = createAdminClient()
    // 全シーンの audio_url をクリア (idempotent な再生成のため)
    const { error: clearErr } = await supabase
      .from('scenes')
      .update({ audio_url: null })
      .eq('video_id', videoId)
    if (clearErr) {
      throw new PipelineError(`scenes.audio_url のクリアに失敗: ${clearErr.message}`, clearErr)
    }
    // 古い動画 MP4 もクリア
    await supabase
      .from('videos')
      .update({ final_video_url: null })
      .eq('id', videoId)

    await generateSceneAudio(videoId)

    // 音声が揃った直後の整合状態を 'ready' に戻す
    // (まだ動画 MP4 は無いので、UI 側で「動画を作り直す」ボタンが出る)
    await updateVideoStatus(videoId, 'ready', { error_message: null })
  } catch (err: unknown) {
    const message = err instanceof Error ? sanitizeProviderError(err) : 'unknown audio regen error'
    await markVideoFailed(videoId, message)
  }
}

/**
 * 1 シーンのメディア（画像 / 音声）再生成を video.status で追跡可能にするラッパー。
 *
 * 個別の regenerateSceneImage / regenerateSceneAudio は status を変えないため、
 * fire-and-forget で呼ぶと UI が完了を追えない（生成完了しても画面は空/古いまま）。
 * このラッパーは status を generating_images / generating_voice に遷移させてから
 * 生成し、完了で 'ready' に戻す。UI は既存のポーリング（non-terminal status を監視）で
 * 完了を検知して再取得できる。
 *
 * 失敗時は failed に落とす（restart で復帰可能）。
 */
export async function regenerateSceneTracked(
  videoId: string,
  sceneId: string,
  target: 'image' | 'audio' | 'both',
  expectedVideoId?: string,
): Promise<void> {
  try {
    if (target === 'image' || target === 'both') {
      await updateVideoStatus(videoId, 'generating_images')
      await regenerateSceneImage(sceneId, expectedVideoId)
    }
    if (target === 'audio' || target === 'both') {
      await updateVideoStatus(videoId, 'generating_voice')
      await regenerateSceneAudio(sceneId, expectedVideoId)
    }
    // 完了 → ready（final_video_url は regenerate 内でクリア済み = 要再レンダー）
    await updateVideoStatus(videoId, 'ready', { error_message: null })
  } catch (err: unknown) {
    const message = err instanceof Error ? sanitizeProviderError(err) : 'unknown scene regen error'
    await markVideoFailed(videoId, message)
  }
}

/**
 * failed 状態の動画を draft に戻して再投入する（idempotent な step が再走する）。
 *
 * compare-and-set で「failed → draft」のみ acquire 可能。
 * 連打や並行リクエストでも 1 つのジョブだけが「再開した動画」を取得し、
 * 残りは false を返す → 呼び出し側 (route) で enqueue をスキップする。
 *
 * @returns true なら state を acquire できた (= ジョブを enqueue してよい)
 *          false なら既に他のリクエストが acquire 済み or もう failed ではない
 */
export async function restartFailedVideo(videoId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data: locked, error } = await supabase
    .from('videos')
    .update({
      status: 'draft',
      error_message: null,
      // 再開時に経過時間カウントもリセット
      generation_started_at: new Date().toISOString(),
    })
    .eq('id', videoId)
    .eq('status', 'failed')
    .select('id')
    .maybeSingle()
  if (error) {
    throw new PipelineError(`restart の状態遷移に失敗しました: ${error.message}`, error)
  }
  // locked が null → 既に他のリクエストが draft に進めた、または failed じゃなくなった
  return Boolean(locked)
}

/**
 * 1 シーンの音声だけを再生成する。
 */
export async function regenerateSceneAudio(sceneId: string, expectedVideoId?: string): Promise<void> {
  const scene = await loadSceneById(sceneId, expectedVideoId)
  if (!scene.narration_text) {
    throw new PipelineError('narration_text が無いため再生成できません')
  }
  const video = await loadVideo(scene.video_id)
  const voiceOpts: ElevenLabsVoiceOptions = {
    voiceId: video.elevenlabs_voice_id ?? DEFAULT_VOICE_ID,
  }
  const res = await generateSceneNarration(scene.narration_text, voiceOpts, video.user_id)
  const uploaded = await uploadSceneAudio({
    userId: video.user_id,
    videoId: scene.video_id,
    sceneOrder: scene.order_index,
    audioBytes: res.audioBytes,
    contentType: res.mimeType,
  })
  // 音声生成中にシーンが削除されているケースの保護。
  // upload は完了するが、scene 行に書く必要がないので早期 return。
  if (!(await sceneExists(sceneId))) {
    console.warn(`[regenerateSceneAudio] scene ${sceneId} は削除済み。生成結果は破棄します`)
    return
  }
  const corrected = Math.max(
    SCENE_DURATION_MIN_SEC,
    Math.min(SCENE_DURATION_MAX_SEC, res.durationEstimateSec + SCENE_TAIL_GAP_SEC),
  )
  await updateSceneRow(scene.id, {
    audio_url: uploaded.storagePath,
    duration: Math.round(corrected * 10) / 10,
  })
  await createAdminClient()
    .from('videos')
    .update({ final_video_url: null })
    .eq('id', scene.video_id)
    .throwOnError()
}
