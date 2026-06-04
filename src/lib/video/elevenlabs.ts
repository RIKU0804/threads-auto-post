// ElevenLabs text-to-speech adapter for the AI video pipeline.
// 各シーンの narration_text を音声 (MP3) に変換して返す。
// 音声ファイルの Supabase Storage 保存・URL 解決は呼び出し側の責務。
//
// API key 戦略:
//   `src/lib/ai/api-keys.ts` の OpenAI/OpenRouter と同じく、ユーザー毎に
//   `user_api_keys.elevenlabs_key` カラムへ暗号化保存する想定。
//   現時点ではカラム未追加のため、フォールバックとしてサーバー側の
//   `process.env.ELEVENLABS_API_KEY` を使用する。
//   `elevenlabs_key` カラムを追加するマイグレーションは別途必要。

import 'server-only'
import { createAdminClient } from '@/lib/supabase-admin'
import { decryptSecret } from '@/lib/crypto'

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1'
const REQUEST_TIMEOUT_MS = 60_000

// 429 / 5xx を受けたときのリトライ設定
//   - 429: Retry-After ヘッダがあればそれに従う (上限あり)。なければ指数バックオフ
//   - 5xx: 指数バックオフのみ
//   - 同期エラー (auth / validation) はリトライしない
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1_500
const MAX_BACKOFF_MS = 15_000
// Retry-After は外部 API 言いなりなので暴走防止の上限を入れる
const MAX_RETRY_AFTER_MS = 30_000

// 日本語対応の多言語ボイス (Rachel) を既定値として採用。
// ユーザーが ElevenLabsVoiceOptions.voiceId で上書き可能。
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

// 最新フラッグシップ eleven_v3 を既定モデルに採用。
// - 表現力・多言語品質ともに v2 より大幅向上（日本語ナレーションでもイントネーションが自然）
// - voice_settings (stability / similarity_boost / style) は引き続き有効
// - アカウントによって未開放の場合は ElevenLabsVoiceOptions.modelId で `eleven_multilingual_v2` 等にフォールバック可
const DEFAULT_MODEL_ID = 'eleven_v3'

// mp3_44100_128 を採用 (MP3 / 44.1kHz / 128kbps)。
// - Remotion / FFmpeg 双方で扱いやすく、品質と容量のバランスが良い。
// - 128kbps == 16 KB/sec なので尺の概算が容易。
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128'
const DEFAULT_BITRATE_KBPS = 128

const MAX_NARRATION_CHARS = 5_000

export interface ElevenLabsVoiceOptions {
  /** ElevenLabs voice id。未指定なら日本語対応の既定ボイスを使用。 */
  voiceId?: string
  /** モデル ID。既定は最新の eleven_v3。プラン未開放時は eleven_multilingual_v2 等にフォールバック可。 */
  modelId?: string
  /** 0.0–1.0。低いほど抑揚が増す。 */
  stability?: number
  /** 0.0–1.0。元の声への忠実度。 */
  similarityBoost?: number
  /** 0.0–1.0。v2 系モデルのスタイル強度。 */
  style?: number
  /**
   * 読み上げ速度。0.7–1.2 の範囲。1.0 が標準。
   * eleven_v3 / 一部 multilingual モデルでのみ有効。
   * 範囲外は API 側で無視される。
   */
  speed?: number
}

export interface SceneAudioResult {
  /** MP3 のバイナリ。 */
  audioBytes: Uint8Array
  mimeType: 'audio/mpeg'
  /**
   * 推定再生時間 (秒)。
   * 128kbps CBR を前提に audioBytes.byteLength / (128_000 / 8) で算出する近似値。
   * ElevenLabs は本文中で尺を返さないため、Remotion 側で正確な尺が必要なら
   * ffprobe 等で再計測することを推奨。
   */
  durationEstimateSec: number
}

export class ElevenLabsAuthError extends Error {
  constructor(message = 'ElevenLabs API キーが無効です') {
    super(message)
    this.name = 'ElevenLabsAuthError'
  }
}

export class ElevenLabsQuotaError extends Error {
  /** Retry-After ヘッダ (秒) があれば格納。 */
  public readonly retryAfterSec: number | null
  constructor(message: string, retryAfterSec: number | null = null) {
    super(message)
    this.name = 'ElevenLabsQuotaError'
    this.retryAfterSec = retryAfterSec
  }
}

export class ElevenLabsApiError extends Error {
  public readonly status: number
  public readonly bodySnippet: string
  constructor(status: number, bodySnippet: string) {
    super(`ElevenLabs API error (HTTP ${status}): ${bodySnippet}`)
    this.name = 'ElevenLabsApiError'
    this.status = status
    this.bodySnippet = bodySnippet
  }
}

export class MissingElevenLabsKeyError extends Error {
  constructor() {
    super('ElevenLabs の API キーが設定されていません。「設定」ページから登録してください。')
    this.name = 'MissingElevenLabsKeyError'
  }
}

/**
 * 指定ユーザーの ElevenLabs API キーを取得する。
 *
 * BYOK 強制: `user_api_keys.elevenlabs_key` のみを参照する。
 * サーバー側 `ELEVENLABS_API_KEY` 環境変数フォールバックは廃止 (コストはユーザー負担)。
 *
 * バックグラウンドジョブ (pipeline.ts) から呼ばれるため、セッション cookie
 * に依存せず admin client + userId 明示で取得する。userId 必須。
 */
async function fetchElevenLabsKey(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('user_api_keys')
      .select('elevenlabs_key')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      // DB の一時エラーを「キー未登録」と取り違えると誤った案内になるのでログを残す。
      console.error('[elevenlabs] key fetch DB error', error.message)
      return null
    }
    if (data) {
      const raw = (data as { elevenlabs_key?: string | null }).elevenlabs_key
      if (typeof raw === 'string') {
        const decrypted = decryptSecret(raw)?.trim()
        if (decrypted) return decrypted
      }
    }
  } catch (e) {
    // DB 取得失敗時は null を返す (env フォールバックは廃止)。原因はログに残す。
    console.error('[elevenlabs] key fetch failed', e instanceof Error ? e.message : 'unknown')
  }
  return null
}

export async function requireElevenLabsKey(userId: string): Promise<string> {
  const key = await fetchElevenLabsKey(userId)
  if (!key) throw new MissingElevenLabsKeyError()
  return key
}

interface VoiceSettings {
  stability: number
  similarity_boost: number
  style: number
  use_speaker_boost: boolean
  /** 0.7–1.2。eleven_v3 等で対応 (未対応モデルでは無視される) */
  speed: number
}

// SNS 短尺動画向けに「抑揚強め・表現力高め・テンポ良し」のデフォルト。
// 既定の ElevenLabs サーバーデフォルト (stability 0.5 / style 0 / speed 1.0) では
// 平坦・冷静・標準速度の読み上げになり、視聴者の引き込みが弱く、最初の数秒で離脱されるため
// 意図的に振っている。
//   - stability  低め → イントネーションが豊かになる代わりに安定性は下がる
//   - style      高め → そのボイスのキャラクター性が強く出る
//   - similarity_boost → 元の声に忠実 (低くしすぎると別人化する)
//   - use_speaker_boost → 高域の明瞭度を上げて SNS スピーカーで聞き取りやすく
//   - speed 1.15 → SNS 短尺動画のテンポに合わせて気持ち早口に
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.35,
  similarity_boost: 0.75,
  style: 0.6,
  use_speaker_boost: true,
  speed: 1.15,
}

function clampSpeed(n: number): number {
  if (Number.isNaN(n)) return 1.0
  if (n < 0.7) return 0.7
  if (n > 1.2) return 1.2
  return n
}

function buildVoiceSettings(opts: ElevenLabsVoiceOptions): VoiceSettings {
  return {
    stability: typeof opts.stability === 'number'
      ? clamp01(opts.stability)
      : DEFAULT_VOICE_SETTINGS.stability,
    similarity_boost: typeof opts.similarityBoost === 'number'
      ? clamp01(opts.similarityBoost)
      : DEFAULT_VOICE_SETTINGS.similarity_boost,
    style: typeof opts.style === 'number'
      ? clamp01(opts.style)
      : DEFAULT_VOICE_SETTINGS.style,
    use_speaker_boost: DEFAULT_VOICE_SETTINGS.use_speaker_boost,
    speed: typeof opts.speed === 'number'
      ? clampSpeed(opts.speed)
      : DEFAULT_VOICE_SETTINGS.speed,
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null
  const asNumber = Number(headerValue)
  if (Number.isFinite(asNumber) && asNumber >= 0) return Math.floor(asNumber)
  const asDate = Date.parse(headerValue)
  if (!Number.isNaN(asDate)) {
    const diffSec = Math.floor((asDate - Date.now()) / 1000)
    return diffSec >= 0 ? diffSec : 0
  }
  return null
}

function estimateDurationSec(byteLength: number): number {
  // 128kbps CBR → 1 秒あたり 128_000 / 8 = 16_000 byte
  // with-timestamps が使えなかったときのフォールバック推定。
  const bytesPerSec = (DEFAULT_BITRATE_KBPS * 1000) / 8
  return Math.max(0, byteLength / bytesPerSec)
}

/**
 * with-timestamps レスポンスの alignment から実再生尺（秒）を取り出す。
 * character_end_times_seconds の最後の値が音声全体の終了時刻 = 実尺。
 * 取れなければ null（呼び出し側が byte 推定にフォールバック）。
 */
function extractDurationFromAlignment(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null
  const alignment = (raw as { alignment?: unknown }).alignment
  if (!alignment || typeof alignment !== 'object') return null
  const ends = (alignment as { character_end_times_seconds?: unknown }).character_end_times_seconds
  if (!Array.isArray(ends) || ends.length === 0) return null
  const last = ends[ends.length - 1]
  return typeof last === 'number' && Number.isFinite(last) && last > 0 ? last : null
}

interface TtsRequestBody {
  text: string
  model_id: string
  voice_settings: VoiceSettings
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * 指数バックオフの待機時間を返す。最大 MAX_BACKOFF_MS でキャップ。
 *   attempt=0 → 1500ms, attempt=1 → 3000ms, attempt=2 → 6000ms ...
 */
function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * Math.pow(2, attempt))
}

/**
 * 1 回ぶんの TTS リクエストを発行する。リトライしない。
 * リトライ判定は呼び出し側の callTts で行う。
 */
async function callTtsOnce(
  text: string,
  voiceId: string,
  modelId: string,
  voiceSettings: VoiceSettings,
  apiKey: string,
): Promise<SceneAudioResult> {
  const body: TtsRequestBody = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings,
  }
  // with-timestamps エンドポイント: 音声 + 文字ごとのタイムスタンプを JSON で返す。
  // 末尾タイムスタンプ = 実再生尺。byte 長推定だと Remotion のシーン尺がズレて
  // 音声がシーン境界で切れる/末尾が無音になるため、実尺を使う。
  const url = new URL(`${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`)
  url.searchParams.set('output_format', DEFAULT_OUTPUT_FORMAT)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new ElevenLabsApiError(0, 'request timed out')
    }
    const message = e instanceof Error ? e.message : 'unknown fetch error'
    throw new ElevenLabsApiError(0, message)
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    const snippet = bodyText.slice(0, 500)
    if (res.status === 401 || res.status === 403) {
      throw new ElevenLabsAuthError()
    }
    if (res.status === 402 || res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
      throw new ElevenLabsQuotaError(
        res.status === 402
          ? 'ElevenLabs の利用枠を超えています (HTTP 402)'
          : 'ElevenLabs のレート制限に達しました (HTTP 429)',
        retryAfter,
      )
    }
    throw new ElevenLabsApiError(res.status, snippet)
  }

  // with-timestamps は JSON ({ audio_base64, alignment }) を返す
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ElevenLabsApiError(res.status, 'with-timestamps 応答の JSON パースに失敗')
  }
  const audioB64 = (json as { audio_base64?: unknown }).audio_base64
  if (typeof audioB64 !== 'string' || audioB64.length === 0) {
    throw new ElevenLabsApiError(res.status, 'audio_base64 が空です')
  }
  const audioBytes = new Uint8Array(Buffer.from(audioB64, 'base64'))
  if (audioBytes.byteLength === 0) {
    throw new ElevenLabsApiError(res.status, 'empty audio response')
  }

  // 実尺を alignment から取得。取れなければ byte 推定にフォールバック。
  const realDuration = extractDurationFromAlignment(json)

  return {
    audioBytes,
    mimeType: 'audio/mpeg',
    durationEstimateSec: realDuration ?? estimateDurationSec(audioBytes.byteLength),
  }
}

/**
 * TTS を呼ぶ。429 (rate limit) / 5xx / ネットワークエラーは
 * Retry-After + 指数バックオフでリトライする。
 * Auth/Validation エラーは即座に throw。
 */
async function callTts(
  text: string,
  opts: ElevenLabsVoiceOptions,
  userId: string,
): Promise<SceneAudioResult> {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new Error('ナレーションテキストが空です')
  }
  if (trimmed.length > MAX_NARRATION_CHARS) {
    throw new Error(`ナレーションテキストが長すぎます (最大 ${MAX_NARRATION_CHARS} 文字)`)
  }

  const apiKey = await requireElevenLabsKey(userId)
  const voiceId = opts.voiceId?.trim() || DEFAULT_VOICE_ID
  const modelId = opts.modelId?.trim() || DEFAULT_MODEL_ID
  const voiceSettings = buildVoiceSettings(opts)

  let lastError: unknown = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callTtsOnce(trimmed, voiceId, modelId, voiceSettings, apiKey)
    } catch (e: unknown) {
      lastError = e
      // Auth エラーは即座に bail (キーが間違ってる)
      if (e instanceof ElevenLabsAuthError) throw e

      // 402 (Quota Exceeded) はリトライしても無駄
      if (e instanceof ElevenLabsQuotaError && /HTTP 402/.test(e.message)) throw e

      // これ以上リトライしない
      if (attempt >= MAX_RETRIES) break

      // 429 (rate limit) は Retry-After を優先、無ければバックオフ
      if (e instanceof ElevenLabsQuotaError) {
        const retryAfterMs = e.retryAfterSec != null
          ? Math.min(e.retryAfterSec * 1000, MAX_RETRY_AFTER_MS)
          : backoffMs(attempt)
        await sleep(retryAfterMs)
        continue
      }

      // ElevenLabsApiError (5xx, timeout, network) は指数バックオフ
      if (e instanceof ElevenLabsApiError) {
        // status=0 (network/timeout) と 5xx だけリトライ。4xx は無駄。
        const status = e.status
        if (status === 0 || (status >= 500 && status < 600)) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw e
      }

      // 予期しないエラーはリトライせず即 throw
      throw e
    }
  }

  // ループを抜けたらリトライ尽きた
  throw lastError instanceof Error ? lastError : new Error('unknown ElevenLabs error')
}

/**
 * 1 シーン分のナレーションを MP3 で生成する。
 * 失敗時は ElevenLabsAuthError / ElevenLabsQuotaError / ElevenLabsApiError を投げる。
 */
export async function generateSceneNarration(
  narrationText: string,
  opts: ElevenLabsVoiceOptions = {},
  userId: string,
): Promise<SceneAudioResult> {
  return callTts(narrationText, opts, userId)
}

/**
 * 動画全体の連結ナレーションを 1 ファイルで生成する。
 *
 * Remotion のタイムライン上では基本的にシーン毎の音声を使うため、
 * このヘルパーは「連結トラックも欲しい」場合のための補助。
 *
 * 実装方針:
 *   ElevenLabs 側で `\n\n` 区切りを 1 回の TTS リクエストとして送ると、
 *   発話間に自然なポーズが入った 1 本の音声ファイルが返る。
 *   サーバー側で MP3 を物理的に結合する処理は行わない (FFmpeg 等の責務)。
 */
export async function generateFullNarration(
  narrationsInOrder: string[],
  opts: ElevenLabsVoiceOptions = {},
  userId: string,
): Promise<SceneAudioResult> {
  const cleaned = narrationsInOrder.map(s => s.trim()).filter(s => s.length > 0)
  if (cleaned.length === 0) {
    throw new Error('連結対象のナレーションがありません')
  }
  const merged = cleaned.join('\n\n')
  return callTts(merged, opts, userId)
}
