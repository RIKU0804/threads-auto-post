import 'server-only'
import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase-admin'
import { decryptSecret } from '@/lib/crypto'
import { MissingApiKeyError } from '@/lib/ai/api-keys'

/**
 * AI ショート動画スクリプト生成モジュール。
 *
 * 入力テーマ → 構造化されたシーン配列を生成する。
 * 下流の gpt-image-1（イラスト）と ElevenLabs（音声）に橋渡しする中間表現。
 *
 * 重要な分離原則:
 *   - 画像 = イラストのみ。文字テロップは絶対に画像に含めない（Remotion 側で重ねる）
 *   - caption_text = Remotion で表示するテロップ
 *   - narration_text = ElevenLabs に渡す TTS 原稿
 *   - image_prompt   = gpt-image-1 に渡すイラスト指示（英語推奨、no-text 指示込み）
 */

const OPENAI_MODEL = 'gpt-4o-mini'
const REQUEST_TIMEOUT_MS = 60_000
const MIN_SCENES = 3
const DEFAULT_SCENE_COUNT_MIN = 5
const DEFAULT_SCENE_COUNT_MAX = 8
const DEFAULT_TARGET_DURATION_SEC = 40
// 日本語ナレーションは 5 字/秒 ≒ 1 秒あたり 5 文字、を経験的基準として採用
// （ElevenLabs 日本語 voice の自然読み速度に近い）
const JP_CHARS_PER_SECOND = 5
const SCENE_MIN_DURATION = 2
const SCENE_MAX_DURATION = 15

export interface SceneDraft {
  /** テロップ（短い・1〜2行・読みやすい日本語）。Remotion がオーバーレイ表示する。 */
  caption_text: string
  /** ナレーション原稿（自然な話し言葉、TTS 最適化）。ElevenLabs に渡す。 */
  narration_text: string
  /** 画像生成プロンプト（English 推奨）。文字要素を含めない指示が必須。 */
  image_prompt: string
  /** 推奨シーン尺（秒）。narration_text の長さから推定。 */
  duration: number
}

export interface VideoScriptDraft {
  /** 動画タイトル */
  title: string
  /** 全体台本（レビュー用、markdown 可） */
  script: string
  /** シーン配列、最低 3 シーン */
  scenes: SceneDraft[]
}

export interface GenerateScriptOptions {
  /** ユーザー入力テーマ（日本語） */
  theme: string
  /** 目安総尺（秒）。デフォルト 40 秒 */
  targetDurationSec?: number
  /** 目安シーン数。デフォルト 5〜8 */
  sceneCount?: number
}

export interface GenerateScriptContext {
  /** OpenAI API キーを取得するための Supabase ユーザー ID */
  userId: string
}

export class ScriptGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'ScriptGenerationError'
  }
}

/**
 * 指定 userId の OpenAI API キーを admin client 経由で取得する。
 * ジョブ実行などセッション cookie が無い文脈で呼ばれる前提。
 */
async function fetchOpenAiKeyForUser(userId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('openai_key')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new ScriptGenerationError(
      `OpenAI API キーの取得に失敗しました: ${error.message}`,
      error,
    )
  }

  const decrypted = decryptSecret(data?.openai_key ?? null)?.trim() || null
  if (!decrypted) {
    throw new MissingApiKeyError('openai')
  }
  return decrypted
}

/**
 * OpenAI structured output 用の JSON Schema。
 * `additionalProperties: false` + 全フィールドを required にすることで
 * strict mode を有効化し、応答の決定性を担保する。
 */
const VIDEO_SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'script', 'scenes'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    script: { type: 'string', minLength: 1 },
    scenes: {
      type: 'array',
      minItems: MIN_SCENES,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caption_text', 'narration_text', 'image_prompt', 'duration'],
        properties: {
          caption_text: { type: 'string', minLength: 1, maxLength: 60 },
          narration_text: { type: 'string', minLength: 1, maxLength: 400 },
          image_prompt: { type: 'string', minLength: 1, maxLength: 800 },
          duration: { type: 'number', minimum: SCENE_MIN_DURATION, maximum: SCENE_MAX_DURATION },
        },
      },
    },
  },
} as const

interface SystemPromptParams {
  targetDurationSec: number
  sceneCountMin: number
  sceneCountMax: number
}

function buildSystemPrompt({
  targetDurationSec,
  sceneCountMin,
  sceneCountMax,
}: SystemPromptParams): string {
  return `あなたは TikTok・Instagram Reels 向けショート動画の構成作家です。
日本人視聴者を対象に、テーマから動画台本を JSON で生成します。

【絶対ルール】
1. 出力は scenes 配列に分割する。最低 ${MIN_SCENES} シーン、目安 ${sceneCountMin}〜${sceneCountMax} シーン。
2. 各シーンには 3 つの独立したテキスト要素がある。役割を混同しないこと:
   - caption_text: Remotion でオーバーレイ表示するテロップ。短く、1〜2行、視覚的に読みやすい日本語。装飾記号や絵文字は最小限。最大40字程度。
   - narration_text: ElevenLabs が読み上げる TTS 原稿。自然な話し言葉。句読点（、。）で TTS が自然に間を取れるよう配置する。記号・括弧・絵文字は使わない。1シーンあたり日本語30〜200字目安。
   - image_prompt: gpt-image-1 に渡す英語の画像生成プロンプト。イラストのみ。
3. 【最重要】image_prompt には絶対に文字・テキスト・キャプション・ロゴ・タイポグラフィ要素を含めない。必ず英語で書き、末尾に "Illustration only. No text, no letters, no captions, no logos, no typography, no watermarks." を必ず明記する。スタイル指定（flat illustration, soft colors など）は OK。
4. duration（秒）は narration_text の長さに比例。日本語は約 ${JP_CHARS_PER_SECOND} 文字/秒で読まれる想定で算出し、${SCENE_MIN_DURATION}〜${SCENE_MAX_DURATION} 秒に収める。
5. 全シーンの duration 合計は目安 ${targetDurationSec} 秒前後。
6. script フィールドには動画全体の台本を markdown で要約（レビュー用）。caption と narration の流れがわかる形にする。
7. title は視聴者がスクロールを止めたくなる短く強いフック。

【作劇ルール】
- 1 シーン目で必ずフックを作る（逆説・数字・問いかけ等）
- 中盤で具体例 / 体験談 / リストを展開
- 最終シーンで明確な結論や次のアクションを提示
- caption_text と narration_text は意味的に対応させつつ、テロップは要約、ナレーションは肉付け、という役割分担を保つ`
}

function buildUserPrompt(theme: string, targetDurationSec: number, sceneCountMin: number, sceneCountMax: number): string {
  return `テーマ: ${theme}

目安総尺: 約 ${targetDurationSec} 秒
目安シーン数: ${sceneCountMin}〜${sceneCountMax}

このテーマで日本語ショート動画スクリプトを 1 本生成してください。
JSON Schema に従って構造化された出力のみを返してください。`
}

interface RawScene {
  caption_text: unknown
  narration_text: unknown
  image_prompt: unknown
  duration: unknown
}

interface RawScript {
  title: unknown
  script: unknown
  scenes: unknown
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function snippet(raw: string, len = 400): string {
  return raw.length > len ? `${raw.slice(0, len)}…(${raw.length} chars total)` : raw
}

/**
 * OpenAI 応答を VideoScriptDraft に検証・正規化する。
 * Zod が無いプロジェクトのため、明示的な手動バリデーションで型と制約を確認する。
 */
function validateScriptResponse(parsed: unknown, rawText: string): VideoScriptDraft {
  if (!isObject(parsed)) {
    throw new ScriptGenerationError(
      `AI 応答がオブジェクトではありません: ${snippet(rawText)}`,
    )
  }

  const raw = parsed as unknown as RawScript

  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
    throw new ScriptGenerationError(
      `AI 応答の title が不正です: ${snippet(rawText)}`,
    )
  }
  if (typeof raw.script !== 'string' || raw.script.trim().length === 0) {
    throw new ScriptGenerationError(
      `AI 応答の script が不正です: ${snippet(rawText)}`,
    )
  }
  if (!Array.isArray(raw.scenes) || raw.scenes.length < MIN_SCENES) {
    throw new ScriptGenerationError(
      `AI 応答の scenes が ${MIN_SCENES} 件未満、または配列ではありません: ${snippet(rawText)}`,
    )
  }

  const scenes: SceneDraft[] = raw.scenes.map((sceneUnknown, index) => {
    if (!isObject(sceneUnknown)) {
      throw new ScriptGenerationError(
        `scene[${index}] がオブジェクトではありません: ${snippet(rawText)}`,
      )
    }
    const s = sceneUnknown as unknown as RawScene

    if (typeof s.caption_text !== 'string' || s.caption_text.trim().length === 0) {
      throw new ScriptGenerationError(
        `scene[${index}].caption_text が不正です: ${snippet(rawText)}`,
      )
    }
    if (typeof s.narration_text !== 'string' || s.narration_text.trim().length === 0) {
      throw new ScriptGenerationError(
        `scene[${index}].narration_text が不正です: ${snippet(rawText)}`,
      )
    }
    if (typeof s.image_prompt !== 'string' || s.image_prompt.trim().length === 0) {
      throw new ScriptGenerationError(
        `scene[${index}].image_prompt が不正です: ${snippet(rawText)}`,
      )
    }
    if (typeof s.duration !== 'number' || !Number.isFinite(s.duration)) {
      throw new ScriptGenerationError(
        `scene[${index}].duration が不正です: ${snippet(rawText)}`,
      )
    }

    // ナレーション長から再推定し、モデルの値とのズレが大きい場合は補正値で上書き
    const estimatedDuration = Math.max(
      SCENE_MIN_DURATION,
      Math.min(SCENE_MAX_DURATION, s.narration_text.trim().length / JP_CHARS_PER_SECOND),
    )
    const modelDuration = Math.max(
      SCENE_MIN_DURATION,
      Math.min(SCENE_MAX_DURATION, s.duration),
    )
    const duration = Math.abs(modelDuration - estimatedDuration) > 3
      ? estimatedDuration
      : modelDuration

    return {
      caption_text: s.caption_text.trim(),
      narration_text: s.narration_text.trim(),
      image_prompt: s.image_prompt.trim(),
      duration: Math.round(duration * 10) / 10,
    }
  })

  return {
    title: raw.title.trim(),
    script: raw.script.trim(),
    scenes,
  }
}

/**
 * テーマからショート動画スクリプトを生成する。
 *
 * @throws {MissingApiKeyError} ユーザーが OpenAI API キーを未登録の場合
 * @throws {ScriptGenerationError} 生成 / パース / バリデーション失敗時
 */
export async function generateVideoScript(
  opts: GenerateScriptOptions,
  ctx: GenerateScriptContext,
): Promise<VideoScriptDraft> {
  const theme = opts.theme?.trim()
  if (!theme) {
    throw new ScriptGenerationError('theme が空です')
  }
  if (!ctx.userId) {
    throw new ScriptGenerationError('ctx.userId が必要です')
  }

  const targetDurationSec = opts.targetDurationSec ?? DEFAULT_TARGET_DURATION_SEC
  const sceneCountMin = opts.sceneCount ?? DEFAULT_SCENE_COUNT_MIN
  const sceneCountMax = opts.sceneCount ?? DEFAULT_SCENE_COUNT_MAX

  const apiKey = await fetchOpenAiKeyForUser(ctx.userId)

  const client = new OpenAI({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  })

  const systemPrompt = buildSystemPrompt({
    targetDurationSec,
    sceneCountMin,
    sceneCountMax,
  })
  const userPrompt = buildUserPrompt(theme, targetDurationSec, sceneCountMin, sceneCountMax)

  let rawContent: string
  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.8,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'video_script_draft',
          strict: true,
          schema: VIDEO_SCRIPT_SCHEMA,
        },
      },
    })

    rawContent = completion.choices[0]?.message?.content ?? ''
    if (!rawContent) {
      throw new ScriptGenerationError('OpenAI 応答が空です')
    }
  } catch (err) {
    if (err instanceof ScriptGenerationError || err instanceof MissingApiKeyError) {
      throw err
    }
    const message = err instanceof Error ? err.message : 'unknown'
    throw new ScriptGenerationError(`OpenAI 呼び出しに失敗しました: ${message}`, err)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch (err) {
    throw new ScriptGenerationError(
      `OpenAI 応答 JSON のパースに失敗しました: ${snippet(rawContent)}`,
      err,
    )
  }

  return validateScriptResponse(parsed, rawContent)
}
