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
    if (!error && data) {
      const raw = (data as { elevenlabs_key?: string | null }).elevenlabs_key
      if (typeof raw === 'string') {
        const decrypted = decryptSecret(raw)?.trim()
        if (decrypted) return decrypted
      }
    }
  } catch {
    // DB 取得失敗時は null を返す (env フォールバックは廃止)。
  }
  return null
}

async function requireElevenLabsKey(userId: string): Promise<string> {
  const key = await fetchElevenLabsKey(userId)
  if (!key) throw new MissingElevenLabsKeyError()
  return key
}

interface VoiceSettings {
  stability?: number
  similarity_boost?: number
  style?: number
}

function buildVoiceSettings(opts: ElevenLabsVoiceOptions): VoiceSettings | undefined {
  const settings: VoiceSettings = {}
  if (typeof opts.stability === 'number') settings.stability = clamp01(opts.stability)
  if (typeof opts.similarityBoost === 'number') settings.similarity_boost = clamp01(opts.similarityBoost)
  if (typeof opts.style === 'number') settings.style = clamp01(opts.style)
  return Object.keys(settings).length > 0 ? settings : undefined
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
  const bytesPerSec = (DEFAULT_BITRATE_KBPS * 1000) / 8
  return Math.max(0, byteLength / bytesPerSec)
}

interface TtsRequestBody {
  text: string
  model_id: string
  voice_settings?: VoiceSettings
}

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

  const body: TtsRequestBody = {
    text: trimmed,
    model_id: modelId,
  }
  const voiceSettings = buildVoiceSettings(opts)
  if (voiceSettings) body.voice_settings = voiceSettings

  const url = new URL(`${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`)
  url.searchParams.set('output_format', DEFAULT_OUTPUT_FORMAT)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
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

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('audio/mpeg')) {
    const bodyText = await res.text().catch(() => '')
    throw new ElevenLabsApiError(res.status, `unexpected content-type: ${contentType} body=${bodyText.slice(0, 200)}`)
  }

  const arrayBuf = await res.arrayBuffer()
  const audioBytes = new Uint8Array(arrayBuf)
  if (audioBytes.byteLength === 0) {
    throw new ElevenLabsApiError(res.status, 'empty audio response')
  }

  return {
    audioBytes,
    mimeType: 'audio/mpeg',
    durationEstimateSec: estimateDurationSec(audioBytes.byteLength),
  }
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
