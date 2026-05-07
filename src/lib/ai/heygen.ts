/**
 * HeyGen API クライアント
 * - アバター動画生成（V2 API）
 * - 動画生成は非同期：start → poll で完成を待つ
 * - 完成した動画はHeyGen側で署名付きURLとして返るため、永続化したい場合は別途Supabase Storageへ
 */

const API_BASE = 'https://api.heygen.com'

function apiKey(): string {
  const key = process.env.HEYGEN_API_KEY
  if (!key) throw new Error('HEYGEN_API_KEY not configured')
  return key
}

// ────────────────────────────────────────────
// Voices
// ────────────────────────────────────────────

export interface HeygenVoice {
  voice_id: string
  language: string
  gender: 'male' | 'female' | string
  name: string
  preview_audio?: string
  support_pause?: boolean
  emotion_support?: boolean
}

export async function listVoices(language?: string): Promise<HeygenVoice[]> {
  const res = await fetch(`${API_BASE}/v2/voices`, {
    headers: { 'X-Api-Key': apiKey() },
  })
  if (!res.ok) {
    throw new Error(`HeyGen voices fetch failed: ${res.status}`)
  }
  const json = await res.json() as { data?: { voices?: HeygenVoice[] } }
  const voices = json.data?.voices ?? []
  return language ? voices.filter(v => v.language === language) : voices
}

// ────────────────────────────────────────────
// Avatars (オプション、UI からの選択用)
// ────────────────────────────────────────────

export interface HeygenLook {
  look_id: string
  preview_image_url?: string
  preview_video_url?: string
}

export interface HeygenAvatar {
  avatar_id: string
  avatar_name: string
  gender?: string
  preview_image_url?: string
  preview_video_url?: string
  looks?: HeygenLook[]
}

export async function listAvatars(): Promise<HeygenAvatar[]> {
  // v2/avatars はカスタムアバターのみ。ストックアバター（Alexa等）は
  // v1/avatar.list が返す場合があるため両方試みてマージする
  const [v2Res, v1Res] = await Promise.allSettled([
    fetch(`${API_BASE}/v2/avatars`, { headers: { 'X-Api-Key': apiKey() } }),
    fetch(`${API_BASE}/v1/avatar.list`, { headers: { 'X-Api-Key': apiKey() } }),
  ])

  const avatars: HeygenAvatar[] = []

  if (v2Res.status === 'fulfilled' && v2Res.value.ok) {
    const json = await v2Res.value.json() as { data?: { avatars?: HeygenAvatar[] } }
    console.log('[heygen] v2/avatars raw:', JSON.stringify(json).slice(0, 500))
    avatars.push(...(json.data?.avatars ?? []))
  }

  if (v1Res.status === 'fulfilled' && v1Res.value.ok) {
    const json = await v1Res.value.json() as {
      data?: {
        avatars?: Array<{ avatar_id: string; avatar_name: string; gender?: string; preview_image_url?: string }>
      }
    }
    console.log('[heygen] v1/avatar.list raw:', JSON.stringify(json).slice(0, 500))
    const v1Avatars = json.data?.avatars ?? []
    // v2 と重複しないものを追加
    const existingIds = new Set(avatars.map(a => a.avatar_id))
    for (const a of v1Avatars) {
      if (!existingIds.has(a.avatar_id)) avatars.push(a)
    }
  }

  if (avatars.length === 0) {
    throw new Error('アバターが見つかりませんでした。HeyGen APIキーとプランを確認してください')
  }

  return avatars
}

// ────────────────────────────────────────────
// Video generation
// ────────────────────────────────────────────

export interface GenerateVideoOptions {
  text: string
  /** base avatar ID。lookIdだけで動くstock avatarの場合は省略可 */
  avatarId?: string
  /** Look ID（衣装・背景）。HeyGenのURLの?avatarId=xxx はこちらに入れる */
  lookId?: string
  /** HeyGen Voice ID（audioUrl未指定時に必須） */
  voiceId?: string
  /** ElevenLabs等で事前生成した音声URL。指定するとvoiceIdより優先 */
  audioUrl?: string
  /** デフォルト 1080×1920（縦・TikTok向け） */
  width?: number
  height?: number
  /** 字幕の自動焼き込み（デフォルトtrue） */
  caption?: boolean
  /** アバターのスタイル: normal / closeUp / circle */
  avatarStyle?: 'normal' | 'closeUp' | 'circle'
  /** 背景指定（colorコード or 画像URL） */
  background?:
    | { type: 'color'; value: string }
    | { type: 'image'; url: string }
}

export async function startVideoGeneration(opts: GenerateVideoOptions): Promise<string> {
  const {
    text, avatarId, lookId, voiceId, audioUrl,
    width = 1080, height = 1920,
    caption = true, avatarStyle = 'normal',
    background,
  } = opts

  if (!avatarId && !lookId) {
    throw new Error('avatarId または lookId が必要です')
  }
  if (!audioUrl && !voiceId) {
    throw new Error('voiceId か audioUrl のどちらかが必要です')
  }

  const voice = audioUrl
    ? { type: 'audio', audio_url: audioUrl }
    : { type: 'text', input_text: text, voice_id: voiceId }

  // stock/public avatar は look_id のみで動く場合がある
  const character: Record<string, unknown> = {
    type: 'avatar',
    avatar_style: avatarStyle,
    ...(avatarId ? { avatar_id: avatarId } : {}),
    ...(lookId ? { look_id: lookId } : {}),
  }

  console.log('[heygen] character payload:', JSON.stringify(character))

  const body: Record<string, unknown> = {
    video_inputs: [
      {
        character,
        voice,
        ...(background ? { background } : {}),
      },
    ],
    dimension: { width, height },
    caption,
  }

  const res = await fetch(`${API_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`HeyGen generate failed (${res.status}): ${errText.slice(0, 300)}`)
  }

  const json = await res.json() as { data?: { video_id?: string }; error?: { message?: string } }
  if (!json.data?.video_id) {
    throw new Error(`HeyGen generate: no video_id in response`)
  }
  return json.data.video_id
}

// ────────────────────────────────────────────
// Status & polling
// ────────────────────────────────────────────

export type HeygenStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'waiting'

export interface VideoStatus {
  status: HeygenStatus
  video_url?: string
  thumbnail_url?: string
  duration?: number
  error?: { code?: number; message?: string }
}

export async function getVideoStatus(videoId: string): Promise<VideoStatus> {
  const res = await fetch(`${API_BASE}/v1/video_status.get?video_id=${videoId}`, {
    headers: { 'X-Api-Key': apiKey() },
  })
  if (!res.ok) throw new Error(`HeyGen status failed: ${res.status}`)
  const json = await res.json() as { data?: VideoStatus; error?: { message?: string } }
  if (!json.data) throw new Error('HeyGen status: empty response')
  return json.data
}

export interface PollOptions {
  /** 最大ポーリング回数（デフォルト 60） */
  maxAttempts?: number
  /** ポーリング間隔ms（デフォルト 5000） */
  intervalMs?: number
  onProgress?: (attempt: number, status: HeygenStatus) => void
}

export async function pollUntilComplete(videoId: string, opts: PollOptions = {}): Promise<VideoStatus> {
  const { maxAttempts = 60, intervalMs = 5000, onProgress } = opts

  for (let i = 0; i < maxAttempts; i++) {
    const status = await getVideoStatus(videoId)
    onProgress?.(i, status.status)

    if (status.status === 'completed') return status
    if (status.status === 'failed') {
      throw new Error(`HeyGen video failed: ${status.error?.message ?? 'unknown'}`)
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }

  throw new Error(`HeyGen video timed out after ${maxAttempts} attempts`)
}
