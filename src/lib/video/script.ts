import 'server-only'
import { createAdminClient } from '@/lib/supabase-admin'
import { decryptSecret } from '@/lib/crypto'
import { MissingApiKeyError } from '@/lib/ai/api-keys'
import { sanitizeProviderHttpError } from '@/lib/ai/sanitize-error'

/**
 * AI ショート動画スクリプト生成モジュール。
 *
 * 入力テーマ → 構造化されたシーン配列を生成する。
 * 下流の画像生成（gpt-image-2）と ElevenLabs（音声）に橋渡しする中間表現。
 *
 * モデル: google/gemini-3.5-flash (OpenRouter経由・高速・低コスト)
 *   - text.ts と同じ経路で統一
 *   - strict json_schema は gemini 側で未サポートのため json_object モードを使い、
 *     応答は既存の手動バリデータ (validateScriptResponse) で正規化する
 *
 * 重要な分離原則:
 *   - 画像 = イラストのみ。文字テロップは絶対に画像に含めない（Remotion 側で重ねる）
 *   - caption_text = Remotion で表示するテロップ
 *   - narration_text = ElevenLabs に渡す TTS 原稿
 *   - image_prompt   = 画像生成に渡すイラスト指示（英語推奨、no-text 指示込み）
 */

const OPENROUTER_MODEL = 'google/gemini-3.5-flash'
const REQUEST_TIMEOUT_MS = 60_000
const MIN_SCENES = 3
const DEFAULT_SCENE_COUNT_MIN = 5
const DEFAULT_SCENE_COUNT_MAX = 8
const DEFAULT_TARGET_DURATION_SEC = 40
// 日本語ナレーションは 5 字/秒 ≒ 1 秒あたり 5 文字、を経験的基準として採用
// （ElevenLabs 日本語 voice の自然読み速度に近い）
const JP_CHARS_PER_SECOND = 5
// ElevenLabs の読み上げ速度 (elevenlabs.ts の DEFAULT_VOICE_SETTINGS.speed と一致させる)。
// speed 1.15 だと同じ尺でより多く読めるため、文字数→秒の換算に反映しないと尺がズレる。
const SPEED_FACTOR = 1.15
// 実効読み上げ速度 (字/秒)
const EFFECTIVE_CHARS_PER_SEC = JP_CHARS_PER_SECOND * SPEED_FACTOR
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
  /** OpenRouter API キーを取得するための Supabase ユーザー ID */
  userId: string
}

export class ScriptGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'ScriptGenerationError'
  }
}

/**
 * 指定 userId の OpenRouter API キーを admin client 経由で取得する。
 * ジョブ実行などセッション cookie が無い文脈で呼ばれる前提。
 */
async function fetchOpenRouterKeyForUser(userId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('openrouter_key')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new ScriptGenerationError(
      `OpenRouter API キーの取得に失敗しました: ${error.message}`,
      error,
    )
  }

  const decrypted = decryptSecret(data?.openrouter_key ?? null)?.trim() || null
  if (!decrypted) {
    throw new MissingApiKeyError('openrouter')
  }
  return decrypted
}

interface SystemPromptParams {
  targetDurationSec: number
  sceneCountMin: number
  sceneCountMax: number
  /** 1 シーンあたりの目標ナレーション文字数 (尺厳守の要) */
  perSceneChars: number
  /** 全シーン合計ナレーション文字数の上限 */
  totalCharBudget: number
}

function buildSystemPrompt({
  targetDurationSec,
  sceneCountMin,
  sceneCountMax,
  perSceneChars,
  totalCharBudget,
}: SystemPromptParams): string {
  return `あなたは TikTok・Instagram Reels 向けショート動画の構成作家です。
日本人視聴者を対象に、テーマから動画台本を JSON で生成します。

【絶対ルール】
1. 出力は scenes 配列に分割する。最低 ${MIN_SCENES} シーン、目安 ${sceneCountMin}〜${sceneCountMax} シーン。
2. 各シーンには 3 つの独立したテキスト要素がある。役割を混同しないこと:
   - caption_text: Remotion でオーバーレイ表示するテロップ。画面に大きく出す1行のキャッチ。改行は絶対に入れない（1行で読み切れる長さにする）。理想 8〜16字、最大 22字。装飾記号・絵文字・句読点（、。）は使わず、体言止めや短い問いかけにする。
   - narration_text: ElevenLabs が読み上げる TTS 原稿。自然な話し言葉。句読点（、。）で TTS が自然に間を取れるよう配置する。記号・括弧・絵文字は使わない。【尺厳守】1シーンあたり日本語 ${perSceneChars}字程度、最大でも ${perSceneChars + 10}字。長く書きすぎると動画が目安尺を大幅に超えてしまうので必ず守る。
   - image_prompt: 画像生成に渡す英語の画像生成プロンプト。イラストのみ。
3. 【最重要】image_prompt には絶対に文字・テキスト・キャプション・ロゴ・タイポグラフィ要素を含めない。必ず英語で書き、末尾に "Illustration only. No text, no letters, no captions, no logos, no typography, no watermarks." を必ず明記する。スタイル指定（flat illustration, soft colors など）は OK。
4. duration（秒）は narration_text の長さに比例。読み上げは約 ${EFFECTIVE_CHARS_PER_SEC.toFixed(1)} 文字/秒で算出し、${SCENE_MIN_DURATION}〜${SCENE_MAX_DURATION} 秒に収める。
5. 【最重要・尺厳守】全シーンの narration_text の合計文字数は ${totalCharBudget}字以内に必ず収める。これが動画全体の長さ（目安 ${targetDurationSec}秒）を決める最重要の制約。各シーンを短く保ち、合計が超えそうならシーン数を減らすか各シーンをさらに短くする。
6. script フィールドには動画全体の台本を markdown で要約（レビュー用）。caption と narration の流れがわかる形にする。
7. title は視聴者がスクロールを止めたくなる短く強いフック。最大80字。

【作劇ルール】
- 1 シーン目で必ずフックを作る（逆説・数字・問いかけ等）
- 中盤で具体例 / 体験談 / リストを展開
- 最終シーンで明確な結論や次のアクションを提示
- caption_text と narration_text は意味的に対応させつつ、テロップは要約、ナレーションは肉付け、という役割分担を保つ

【出力フォーマット】
必ず以下の JSON 形式のみを返す。説明文・コードフェンス・前置きは一切不要。
{
  "title": "string",
  "script": "string (markdown可)",
  "scenes": [
    {
      "caption_text": "string (1行・改行なし・最大22字)",
      "narration_text": "string (尺厳守。1シーン短く)",
      "image_prompt": "string (英語、文字なし指示込み)",
      "duration": 5.0
    }
  ]
}`
}

function buildUserPrompt(theme: string, targetDurationSec: number, sceneCountMin: number, sceneCountMax: number): string {
  return `テーマ: ${theme}

目安総尺: 約 ${targetDurationSec} 秒
目安シーン数: ${sceneCountMin}〜${sceneCountMax}

このテーマで日本語ショート動画スクリプトを 1 本生成してください。
指定した JSON 形式のみを返してください。`
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
 * モデルが code fence や説明文を混ぜることがあるため、最も外側の {...} を堅牢に抽出する。
 * JSON が破損していた場合は null を返す。
 */
function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // 直接 JSON.parse できる場合（json_object モードでは通常こちら）
  try {
    return JSON.parse(trimmed)
  } catch {
    // 続けて括弧抽出を試みる
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * ナレーションを最大文字数に収まるよう切り詰める（尺の暴走を止める後段クランプ）。
 * プロンプトで文字数を指示しても AI が無視して長文化することがあるため、ここで確実に制限する。
 * 文の途中で切れて不自然にならないよう、上限以内の最後の句点（。！？）までで切る。
 * 句点が無ければ上限文字でハードカット。
 */
function clampNarration(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const head = trimmed.slice(0, maxChars)
  // 上限以内の最後の文末記号を探す
  const lastSentenceEnd = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
  )
  if (lastSentenceEnd >= Math.floor(maxChars * 0.5)) {
    // 半分以上の位置に句点があればそこで切る（短くなりすぎない）
    return head.slice(0, lastSentenceEnd + 1)
  }
  return head
}

/**
 * OpenRouter 応答を VideoScriptDraft に検証・正規化する。
 * Zod が無いプロジェクトのため、明示的な手動バリデーションで型と制約を確認する。
 * maxCharsPerScene: ナレーション 1 シーンの最大文字数（尺クランプ用）。
 */
function validateScriptResponse(
  parsed: unknown,
  rawText: string,
  maxCharsPerScene: number,
): VideoScriptDraft {
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
    // duration が文字列で返ることがあるため number への昇格を許容
    const durationNum = typeof s.duration === 'number'
      ? s.duration
      : typeof s.duration === 'string'
      ? Number(s.duration)
      : NaN
    if (!Number.isFinite(durationNum)) {
      throw new ScriptGenerationError(
        `scene[${index}].duration が不正です: ${snippet(rawText)}`,
      )
    }

    // 尺クランプ: ナレーションを最大文字数で切り詰めてから尺を計算する。
    const narration = clampNarration(s.narration_text, maxCharsPerScene)

    // ナレーション長から再推定し、モデルの値とのズレが大きい場合は補正値で上書き。
    // speed 1.15 で読まれる実尺に近づけるため EFFECTIVE_CHARS_PER_SEC を使う。
    const estimatedDuration = Math.max(
      SCENE_MIN_DURATION,
      Math.min(SCENE_MAX_DURATION, narration.length / EFFECTIVE_CHARS_PER_SEC),
    )
    const modelDuration = Math.max(
      SCENE_MIN_DURATION,
      Math.min(SCENE_MAX_DURATION, durationNum),
    )
    // クランプでナレーションを切った場合はモデルの duration を信用せず推定値を使う
    const duration = (narration.length < s.narration_text.trim().length ||
      Math.abs(modelDuration - estimatedDuration) > 3)
      ? estimatedDuration
      : modelDuration

    return {
      caption_text: s.caption_text.trim(),
      narration_text: narration,
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
 * @throws {MissingApiKeyError} ユーザーが OpenRouter API キーを未登録の場合
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

  // 尺厳守のための文字数バジェット計算。
  // 全体: targetDurationSec 秒ぶんの文字数 (speed 1.15 を考慮)
  // 1シーン: それをシーン数で割る (タイトル/間ぶんを差し引いて 90% で安全マージン)
  const totalCharBudget = Math.round(targetDurationSec * EFFECTIVE_CHARS_PER_SEC * 0.9)
  const sceneCountForCalc = opts.sceneCount ?? Math.round((DEFAULT_SCENE_COUNT_MIN + DEFAULT_SCENE_COUNT_MAX) / 2)
  const perSceneChars = Math.max(15, Math.round(totalCharBudget / sceneCountForCalc))

  const apiKey = await fetchOpenRouterKeyForUser(ctx.userId)

  const systemPrompt = buildSystemPrompt({
    targetDurationSec,
    sceneCountMin,
    sceneCountMax,
    perSceneChars,
    totalCharBudget,
  })
  const userPrompt = buildUserPrompt(theme, targetDurationSec, sceneCountMin, sceneCountMax)

  let rawContent: string
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://sns-auto-post.vercel.app',
        'X-Title': 'SNS Auto Post',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0.8,
        // 台本(複数シーンの JSON)は長いので十分な枠を明示。
        // gemini-3.5 系の思考トークン消費を抑えて応答を速く（出力からは除外）。
        max_tokens: 8192,
        reasoning: { effort: 'low', exclude: true },
        // gemini は strict json_schema 未サポートのため json_object を使う
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[OpenRouter script]', sanitizeProviderHttpError(res.status, errText))
      throw new ScriptGenerationError(`OpenRouter 呼び出しに失敗しました (HTTP ${res.status})`)
    }

    const json = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    rawContent = json.choices?.[0]?.message?.content ?? ''
    if (!rawContent) {
      throw new ScriptGenerationError('OpenRouter 応答が空です')
    }
  } catch (err) {
    if (err instanceof ScriptGenerationError || err instanceof MissingApiKeyError) {
      throw err
    }
    const message = err instanceof Error ? err.message : 'unknown'
    throw new ScriptGenerationError(`OpenRouter 呼び出しに失敗しました: ${message}`, err)
  }

  const parsed = extractJsonObject(rawContent)
  if (parsed === null) {
    throw new ScriptGenerationError(
      `OpenRouter 応答 JSON のパースに失敗しました: ${snippet(rawContent)}`,
    )
  }

  // maxCharsPerScene はプロンプト指示 (perSceneChars) に少し余裕を持たせた上限。
  // AI の自然なブレは許容しつつ、暴走的な長文だけ確実に切る。
  return validateScriptResponse(parsed, rawContent, perSceneChars + 15)
}
