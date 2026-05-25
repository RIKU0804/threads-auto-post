// HeyGen v2 API adapter for the AI video pipeline.
// Avatar / voice の取得と、アバター動画生成 + ステータスポーリングを提供する。
//
// API key 戦略:
//   `user_api_keys.heygen_key` に AES-256-GCM (crypto.ts) で暗号化保存される BYOK 鍵を使用する。
//   ElevenLabs と同じく env フォールバックは設けない (コストはユーザー負担で完結させる)。
//
// Docs:
// - Avatars list:   GET  https://api.heygen.com/v2/avatars
// - Voices list:    GET  https://api.heygen.com/v2/voices
// - Generate video: POST https://api.heygen.com/v2/video/generate
// - Status:         GET  https://api.heygen.com/v1/video_status.get?video_id=...
// 認証: HTTP ヘッダ `X-Api-Key: <plaintext>`

import 'server-only'
import { createAdminClient } from '@/lib/supabase-admin'
import { decryptSecret } from '@/lib/crypto'

const HEYGEN_API_BASE = 'https://api.heygen.com'
const REQUEST_TIMEOUT_MS = 30_000

// ポーリングの既定値。HeyGen の動画生成は通常 30 秒〜数分。
// 念のため 15 分のハードタイムアウトを設ける (失敗時は throw)。
const DEFAULT_POLL_INTERVAL_MS = 10_000
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60 * 1000

// 縦動画の既定解像度 (Threads / TikTok の 9:16)。
const DEFAULT_WIDTH = 1080
const DEFAULT_HEIGHT = 1920

// 背景未指定時は白でフラットに塗る (アバターを浮かせるための最低限のフォールバック)。
const DEFAULT_BACKGROUND_COLOR = '#ffffff'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MissingHeyGenKeyError extends Error {
  constructor() {
    super('HeyGen の API キーが設定されていません。「設定」ページから登録してください。')
    this.name = 'MissingHeyGenKeyError'
  }
}

export class HeyGenAuthError extends Error {
  constructor(message = 'HeyGen API キーが無効です') {
    super(message)
    this.name = 'HeyGenAuthError'
  }
}

export class HeyGenApiError extends Error {
  public readonly status: number
  constructor(status: number, message: string) {
    super(`HeyGen API error (HTTP ${status}): ${message}`)
    this.name = 'HeyGenApiError'
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// API key fetch (BYOK strict)
// ---------------------------------------------------------------------------

/**
 * 指定ユーザーの HeyGen API キーを取得する。
 *
 * BYOK 強制: `user_api_keys.heygen_key` のみを参照する。env フォールバックなし。
 * バックグラウンドジョブから呼ばれるため admin client + userId 明示で取得する。
 */
async function fetchHeyGenKey(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('user_api_keys')
      .select('heygen_key')
      .eq('user_id', userId)
      .maybeSingle()
    if (!error && data) {
      const raw = (data as { heygen_key?: string | null }).heygen_key
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

export async function requireHeyGenKey(userId: string): Promise<string> {
  const key = await fetchHeyGenKey(userId)
  if (!key) throw new MissingHeyGenKeyError()
  return key
}

// ---------------------------------------------------------------------------
// Low-level fetch helper
// ---------------------------------------------------------------------------

interface HeyGenRequestOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  query?: Record<string, string>
}

async function heygenRequest<T>(
  path: string,
  apiKey: string,
  opts: HeyGenRequestOptions = {},
): Promise<T> {
  const method = opts.method ?? 'GET'

  const url = new URL(`${HEYGEN_API_BASE}${path}`)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, v)
    }
  }

  const headers: Record<string, string> = {
    'X-Api-Key': apiKey,
    Accept: 'application/json',
  }
  let body: string | undefined
  if (method === 'POST' && opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      console.error('[heygen]', method, path, 'request timed out')
      throw new HeyGenApiError(0, 'request timed out')
    }
    const message = e instanceof Error ? e.message : 'unknown fetch error'
    console.error('[heygen]', method, path, 'fetch error')
    throw new HeyGenApiError(0, message)
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    // 機密情報 (api key / audio_url 等) は出力しない。status と path のみ。
    console.error('[heygen]', method, path, res.status)
    if (res.status === 401 || res.status === 403) {
      throw new HeyGenAuthError()
    }
    const snippet = errText.slice(0, 500)
    throw new HeyGenApiError(res.status, snippet || res.statusText)
  }

  const json = (await res.json().catch(() => null)) as T | null
  if (json === null) {
    throw new HeyGenApiError(res.status, 'invalid JSON response')
  }
  return json
}

// HeyGen は基本的に { code/error, message, data } の envelope を返す。
interface HeyGenEnvelope<T> {
  code?: number | string | null
  error?: { code?: string; message?: string } | string | null
  message?: string | null
  data?: T | null
}

function unwrap<T>(env: HeyGenEnvelope<T>, path: string): T {
  // code === 100 が success、それ以外は失敗 (HeyGen 仕様)。
  // 一部エンドポイントは code を返さず data だけのケースもあるため、
  // data が存在する限りは寛容に通す。
  if (env.error) {
    const msg =
      typeof env.error === 'string'
        ? env.error
        : env.error?.message || env.error?.code || 'unknown error'
    console.error('[heygen]', 'envelope error', path)
    throw new HeyGenApiError(0, msg)
  }
  if (env.data === null || env.data === undefined) {
    throw new HeyGenApiError(0, env.message ?? 'empty data in HeyGen response')
  }
  return env.data
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

export interface HeyGenAvatar {
  avatar_id: string
  avatar_name: string
  gender?: string
  preview_image_url?: string
  preview_video_url?: string
}

interface RawAvatar {
  avatar_id?: string
  avatar_name?: string
  gender?: string
  preview_image_url?: string
  preview_video_url?: string
}

export async function listAvatars(userId: string): Promise<HeyGenAvatar[]> {
  const apiKey = await requireHeyGenKey(userId)
  const env = await heygenRequest<HeyGenEnvelope<{ avatars?: RawAvatar[] }>>(
    '/v2/avatars',
    apiKey,
    { method: 'GET' },
  )
  const data = unwrap(env, '/v2/avatars')
  const list = data.avatars ?? []
  return list
    .filter((a): a is RawAvatar & { avatar_id: string; avatar_name: string } =>
      typeof a.avatar_id === 'string' && typeof a.avatar_name === 'string',
    )
    .map(a => ({
      avatar_id: a.avatar_id,
      avatar_name: a.avatar_name,
      gender: a.gender,
      preview_image_url: a.preview_image_url,
      preview_video_url: a.preview_video_url,
    }))
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

export interface HeyGenVoice {
  voice_id: string
  name: string
  language?: string
  gender?: string
  preview_audio?: string
}

interface RawVoice {
  voice_id?: string
  name?: string
  language?: string
  gender?: string
  preview_audio?: string
}

export async function listVoices(userId: string): Promise<HeyGenVoice[]> {
  const apiKey = await requireHeyGenKey(userId)
  const env = await heygenRequest<HeyGenEnvelope<{ voices?: RawVoice[] }>>(
    '/v2/voices',
    apiKey,
    { method: 'GET' },
  )
  const data = unwrap(env, '/v2/voices')
  const list = data.voices ?? []
  return list
    .filter((v): v is RawVoice & { voice_id: string; name: string } =>
      typeof v.voice_id === 'string' && typeof v.name === 'string',
    )
    .map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      language: v.language,
      gender: v.gender,
      preview_audio: v.preview_audio,
    }))
}

// ---------------------------------------------------------------------------
// Generate avatar video
// ---------------------------------------------------------------------------

export type HeyGenVoiceInput =
  | { type: 'audio'; audioUrl: string }
  | { type: 'text'; voiceId: string; inputText: string }

export interface HeyGenGenerateInput {
  userId: string
  avatarId: string
  /** デフォルト 1080 × 1920 (9:16)。 */
  dimension?: { width: number; height: number }
  voice: HeyGenVoiceInput
  /** 背景。未指定なら白の単色。 */
  background?: { type: 'color'; value: string }
  /** true でクレジット消費せずに動作確認可能 (開発時推奨)。 */
  test?: boolean
}

interface VideoInputCharacter {
  type: 'avatar'
  avatar_id: string
  avatar_style: 'normal'
}

type VideoInputVoice =
  | { type: 'audio'; audio_url: string }
  | { type: 'text'; voice_id: string; input_text: string }

interface VideoInputBackground {
  type: 'color'
  value: string
}

interface VideoInput {
  character: VideoInputCharacter
  voice: VideoInputVoice
  background?: VideoInputBackground
}

interface GenerateRequestBody {
  video_inputs: VideoInput[]
  dimension: { width: number; height: number }
  test: boolean
}

function buildVoicePayload(voice: HeyGenVoiceInput): VideoInputVoice {
  if (voice.type === 'audio') {
    const url = voice.audioUrl?.trim()
    if (!url) throw new Error('HeyGen voice.audioUrl が空です')
    return { type: 'audio', audio_url: url }
  }
  const voiceId = voice.voiceId?.trim()
  const text = voice.inputText?.trim()
  if (!voiceId) throw new Error('HeyGen voice.voiceId が空です')
  if (!text) throw new Error('HeyGen voice.inputText が空です')
  return { type: 'text', voice_id: voiceId, input_text: text }
}

export async function generateAvatarVideo(
  input: HeyGenGenerateInput,
): Promise<{ videoId: string }> {
  const avatarId = input.avatarId?.trim()
  if (!avatarId) throw new Error('HeyGen avatarId が空です')

  const apiKey = await requireHeyGenKey(input.userId)
  const dimension = {
    width: input.dimension?.width ?? DEFAULT_WIDTH,
    height: input.dimension?.height ?? DEFAULT_HEIGHT,
  }

  const videoInput: VideoInput = {
    character: {
      type: 'avatar',
      avatar_id: avatarId,
      avatar_style: 'normal',
    },
    voice: buildVoicePayload(input.voice),
  }
  if (input.background) {
    videoInput.background = {
      type: 'color',
      value: input.background.value || DEFAULT_BACKGROUND_COLOR,
    }
  }

  const body: GenerateRequestBody = {
    video_inputs: [videoInput],
    dimension,
    test: input.test ?? false,
  }

  const env = await heygenRequest<HeyGenEnvelope<{ video_id?: string }>>(
    '/v2/video/generate',
    apiKey,
    { method: 'POST', body: body as unknown as Record<string, unknown> },
  )
  const data = unwrap(env, '/v2/video/generate')
  const videoId = data.video_id?.trim()
  if (!videoId) {
    throw new HeyGenApiError(0, 'video_id missing in HeyGen response')
  }
  return { videoId }
}

// ---------------------------------------------------------------------------
// Status / polling
// ---------------------------------------------------------------------------

export type HeyGenStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'waiting'

export interface HeyGenStatusResult {
  status: HeyGenStatus
  videoUrl?: string
  thumbnailUrl?: string
  durationSec?: number
  errorMessage?: string
}

interface RawStatusData {
  status?: string
  video_url?: string
  thumbnail_url?: string
  duration?: number | string
  error?: string | { message?: string } | null
}

function normalizeStatus(raw: string | undefined): HeyGenStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'completed':
    case 'success':
      return 'completed'
    case 'failed':
    case 'error':
      return 'failed'
    case 'processing':
      return 'processing'
    case 'waiting':
      return 'waiting'
    case 'pending':
    default:
      return 'pending'
  }
}

function extractErrorMessage(err: RawStatusData['error']): string | undefined {
  if (!err) return undefined
  if (typeof err === 'string') return err
  if (typeof err === 'object' && typeof err.message === 'string') return err.message
  return undefined
}

export async function getVideoStatus(
  userId: string,
  videoId: string,
): Promise<HeyGenStatusResult> {
  const id = videoId?.trim()
  if (!id) throw new Error('HeyGen videoId が空です')
  const apiKey = await requireHeyGenKey(userId)

  const env = await heygenRequest<HeyGenEnvelope<RawStatusData>>(
    '/v1/video_status.get',
    apiKey,
    { method: 'GET', query: { video_id: id } },
  )
  const data = unwrap(env, '/v1/video_status.get')

  const durationNum =
    typeof data.duration === 'number'
      ? data.duration
      : typeof data.duration === 'string'
        ? Number(data.duration)
        : undefined

  return {
    status: normalizeStatus(data.status),
    videoUrl: data.video_url || undefined,
    thumbnailUrl: data.thumbnail_url || undefined,
    durationSec: Number.isFinite(durationNum) ? durationNum : undefined,
    errorMessage: extractErrorMessage(data.error),
  }
}

export interface PollUntilCompleteOptions {
  intervalMs?: number
  timeoutMs?: number
}

/**
 * 動画完成まで一定間隔でポーリングする。
 * - completed: そのまま返す
 * - failed: HeyGenApiError を投げる
 * - timeout: HeyGenApiError を投げる
 */
export async function pollUntilComplete(
  userId: string,
  videoId: string,
  opts: PollUntilCompleteOptions = {},
): Promise<HeyGenStatusResult> {
  const intervalMs = Math.max(1000, opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  const timeoutMs = Math.max(intervalMs, opts.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS)
  const deadline = Date.now() + timeoutMs

  while (true) {
    const result = await getVideoStatus(userId, videoId)
    if (result.status === 'completed') return result
    if (result.status === 'failed') {
      throw new HeyGenApiError(
        0,
        `HeyGen video generation failed: ${result.errorMessage ?? 'unknown reason'}`,
      )
    }
    if (Date.now() >= deadline) {
      throw new HeyGenApiError(
        0,
        `HeyGen polling timed out after ${Math.floor(timeoutMs / 1000)}s (last status: ${result.status})`,
      )
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
