import 'server-only'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase-admin'
import { decryptSecret } from '@/lib/crypto'
import { MissingApiKeyError } from '@/lib/ai/api-keys'
import type { Scene, Video, VideoStatus } from '@/types/database'
import { generateVideoScript } from '@/lib/video/script'
import { generateSceneNarration } from '@/lib/video/elevenlabs'
import {
  getSignedUrl,
  uploadFinalVideo,
  uploadSceneAudio,
  uploadSceneImage,
} from '@/lib/video/storage'

/**
 * 動画生成パイプラインのオーケストレーター。
 *
 * フェーズ:
 *   draft
 *     → generating_script   (script.ts で台本生成、scenes 行を挿入)
 *     → generating_images   (各シーンの画像を gpt-image-1 で生成)
 *     → generating_voice    (各シーンの音声を ElevenLabs で生成)
 *     → rendering           (Remotion で MP4 レンダリング)
 *     → ready               (完成)
 *
 * いずれの段階でも uncatchable error は failed に遷移し、
 * videos.error_message にメッセージを書き込む。
 *
 * 各 step は idempotent:
 *   - 画像生成は image_url が空のシーンのみ対象
 *   - 音声生成は audio_url が空のシーンのみ対象
 *   - レンダーは final_video_url が空の場合のみ実行
 */

const IMAGE_MODEL = 'gpt-image-1'
const IMAGE_SIZE = '1024x1792' as const // 9:16 縦長 (Remotion 1080x1920 に近い比率)
const IMAGE_TIMEOUT_MS = 120_000

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

async function loadSceneById(sceneId: string): Promise<Scene> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('scenes')
    .select('*')
    .eq('id', sceneId)
    .maybeSingle()
  if (error) {
    throw new PipelineError(`scene の取得に失敗しました: ${error.message}`, error)
  }
  if (!data) {
    throw new PipelineError(`scene が見つかりません: ${sceneId}`)
  }
  return data as Scene
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

/**
 * テーマから台本を生成し、videos.script と scenes 行を埋める。
 * scenes がすでに存在する場合はスキップ (idempotent)。
 */
export async function generateScript(
  videoId: string,
  theme: string,
  opts: { sceneCount?: number | null; targetDurationSec?: number | null } = {},
): Promise<void> {
  const video = await loadVideo(videoId)
  const existingScenes = await loadScenes(videoId)
  if (existingScenes.length > 0 && video.script) {
    return // 既に生成済み
  }

  await updateVideoStatus(videoId, 'generating_script')

  const scriptOpts: { theme: string; sceneCount?: number; targetDurationSec?: number } = { theme }
  if (typeof opts.sceneCount === 'number') scriptOpts.sceneCount = opts.sceneCount
  if (typeof opts.targetDurationSec === 'number') {
    scriptOpts.targetDurationSec = opts.targetDurationSec
  }

  const draft = await generateVideoScript(scriptOpts, { userId: video.user_id })

  const supabase = createAdminClient()
  // タイトル / 台本を反映 (videos.title が空の場合のみ更新)
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

  // 既存 scenes をクリアして再生成。
  if (existingScenes.length > 0) {
    const { error: delErr } = await supabase.from('scenes').delete().eq('video_id', videoId)
    if (delErr) {
      throw new PipelineError(`既存 scenes の削除に失敗: ${delErr.message}`, delErr)
    }
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
  const client = new OpenAI({ apiKey: openaiKey, timeout: IMAGE_TIMEOUT_MS, maxRetries: 1 })

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

  const results = await Promise.allSettled(
    todo.map(async (scene) => {
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
    }),
  )

  const failures = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
  if (failures.length > 0) {
    const summary = failures
      .map((f, i) => `[${i}] ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`)
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

  const results = await Promise.allSettled(
    todo.map(async (scene) => {
      const res = await generateSceneNarration(scene.narration_text as string, {}, video.user_id)
      const uploaded = await uploadSceneAudio({
        userId: video.user_id,
        videoId,
        sceneOrder: scene.order_index,
        audioBytes: res.audioBytes,
        contentType: res.mimeType,
      })
      // duration は narration の実尺で補正 (最低 2 秒、最大 15 秒)
      const corrected = Math.max(2, Math.min(15, res.durationEstimateSec))
      await updateSceneRow(scene.id, {
        audio_url: uploaded.storagePath,
        duration: Math.round(corrected * 10) / 10,
      })
      return uploaded
    }),
  )

  const failures = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
  if (failures.length > 0) {
    const summary = failures
      .map((f, i) => `[${i}] ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`)
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
    // 公開・プレビュー双方で fetch されるため signed URL を保存する。
    // storagePath だけだと video タグも publish 経路も https URL が必要なため動かない。
    await updateVideoStatus(videoId, 'ready', {
      final_video_url: uploaded.signedUrl,
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
export async function runVideoPipeline(
  videoId: string,
  opts: PipelineRunOptions = {},
): Promise<void> {
  try {
    const video = await loadVideo(videoId)

    // 既に終了している場合は何もしない
    if (video.status === 'ready') return

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
    const message = err instanceof Error ? err.message : 'unknown pipeline error'
    await markVideoFailed(videoId, message)
    // ジョブ実行コンテキストでは throw しても上流が拾えないため、ここで終了。
    return
  }
}

// ---------------------------------------------------------------------------
// 単一シーン再生成
// ---------------------------------------------------------------------------

/**
 * 1 シーンの画像だけを再生成する (ユーザーの「やり直し」ボタン用)。
 * 動画ステータスは変えない。
 */
export async function regenerateSceneImage(sceneId: string): Promise<void> {
  const scene = await loadSceneById(sceneId)
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
  await updateSceneRow(scene.id, { image_url: out.storagePath })
  // 画像が変わると最終動画も再レンダリング対象。final_video_url をクリアする。
  await createAdminClient()
    .from('videos')
    .update({ final_video_url: null })
    .eq('id', scene.video_id)
    .throwOnError()
}

/**
 * 1 シーンの音声だけを再生成する。
 */
export async function regenerateSceneAudio(sceneId: string): Promise<void> {
  const scene = await loadSceneById(sceneId)
  if (!scene.narration_text) {
    throw new PipelineError('narration_text が無いため再生成できません')
  }
  const video = await loadVideo(scene.video_id)
  const res = await generateSceneNarration(scene.narration_text, {}, video.user_id)
  const uploaded = await uploadSceneAudio({
    userId: video.user_id,
    videoId: scene.video_id,
    sceneOrder: scene.order_index,
    audioBytes: res.audioBytes,
    contentType: res.mimeType,
  })
  const corrected = Math.max(2, Math.min(15, res.durationEstimateSec))
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
