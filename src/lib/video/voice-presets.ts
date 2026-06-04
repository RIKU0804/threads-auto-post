/**
 * ElevenLabs voice プリセット定義。
 *
 * voice ID は ElevenLabs の Voice Library に登録済みのものを使用。
 * eleven_v3 / eleven_multilingual_v2 の両方で動くものを選定している。
 *
 * UI とパイプラインの両方から import される共通モジュール。
 */

export interface VoicePreset {
  /** ElevenLabs の voice_id */
  id: string
  /** UI 表示名 (日本語) */
  label: string
  /** UI に出す短い説明 */
  description: string
  /** 「男性 / 女性」程度の補足ラベル */
  tag: '男性' | '女性'
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    label: 'Rachel（落ち着いた女性）',
    description: '安定感のある女性ナレーション。情報系・解説系の鉄板',
    tag: '女性',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    label: 'Bella（親しみやすい女性）',
    description: 'SNSフレンドリーで身近な語り口。共感型の投稿向け',
    tag: '女性',
  },
  {
    id: 'cgSgspJ2msm6clMCkdW9',
    label: 'Jessica（カジュアル女性）',
    description: '若く軽快なトーン。TikTok や Shorts のテンポと相性◎',
    tag: '女性',
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    label: 'Adam（力強い男性）',
    description: '訓説・ビジネス系の重厚なナレーション。信頼感重視',
    tag: '男性',
  },
  {
    id: 'IKne3meq5aSn9XLyUdCD',
    label: 'Charlie（活気ある男性）',
    description: '若々しくエネルギッシュ。バズ型・推進力のあるコンテンツ向け',
    tag: '男性',
  },
  {
    id: 'bIHbv24MWmeRgasZH58o',
    label: 'Will（知的な男性）',
    description: '落ち着いた知的トーン。プロ目線・専門系コンテンツ向け',
    tag: '男性',
  },
]

/** Pipeline / API のフォールバック既定 voice (videos.elevenlabs_voice_id が NULL のとき) */
export const DEFAULT_VOICE_ID = VOICE_PRESETS[0].id

/** voice_id がプリセットに存在するか検証 (API バリデーション用) */
export function isValidVoiceId(id: string): boolean {
  return VOICE_PRESETS.some(v => v.id === id)
}

/** voice_id からプリセットを引く (UI 表示名 lookup 用) */
export function findVoicePreset(id: string | null | undefined): VoicePreset | undefined {
  if (!id) return undefined
  return VOICE_PRESETS.find(v => v.id === id)
}
