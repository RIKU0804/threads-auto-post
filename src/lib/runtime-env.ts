/**
 * ランタイム環境の判定ヘルパー。
 *
 * 動画パイプライン (Remotion + Chromium 1.5GB) は Vercel Functions の
 * サイズ・タイムアウト制限に収まらないため、ローカル開発でしか動かせない。
 * クライアント・サーバー両側で「今 Vercel 上か / ローカル開発中か」を判定し
 * UI ガード + API ガードに使う。
 *
 * 判定の優先順位:
 *   1. process.env.VIDEO_RENDERING_ENABLED=1   → 強制有効（自前ワーカー等を運用する場合の脱出ハッチ）
 *   2. process.env.VERCEL=1                    → Vercel 環境 → 無効
 *   3. NEXT_PUBLIC_VERCEL_ENV in [production, preview] → 同上（クライアント側）
 *   4. それ以外                                  → ローカル扱い → 有効
 *
 * NEXT_PUBLIC_VERCEL_ENV は Vercel ビルドで自動注入される
 * (https://vercel.com/docs/projects/environment-variables/system-environment-variables)
 */

export type VideoRuntimeMode = 'enabled' | 'disabled-on-vercel'

/** 動画生成モード。runtime-env は types/database に依存しないよう局所定義する。 */
export type VideoGenerationMode = 'remotion' | 'heygen_avatar'

interface VideoCapability {
  /** 動画生成パイプラインを実行できるか */
  enabled: boolean
  /** 無効化の理由（UI 表示用） */
  reason: VideoRuntimeMode
  /** UI に出すメッセージ */
  message: string
}

const LOCAL_VIDEO_MESSAGE =
  'この動画生成（Remotion・画像+ナレーション合成）は Chromium を必要とするため、ローカル環境（npm run dev）でのみ実行できます。HeyGen アバター動画はクラウドレンダリングのため Vercel でも生成できます。'

export function isVercelRuntime(): boolean {
  // 強制有効フラグ
  if (process.env.VIDEO_RENDERING_ENABLED === '1') return false

  // サーバー側 (VERCEL は Vercel 上で自動的に "1")
  if (process.env.VERCEL === '1') return true

  // クライアント側 (NEXT_PUBLIC_VERCEL_ENV は production / preview / development のいずれか)
  const publicEnv = process.env.NEXT_PUBLIC_VERCEL_ENV
  if (publicEnv === 'production' || publicEnv === 'preview') return true

  return false
}

/**
 * 動画生成が現在の環境で実行可能かを返す。
 *
 * - HeyGen アバター(heygen_avatar): HeyGen のクラウドでレンダリングし、完了確認は
 *   クライアント駆動の単発チェックに分離済みなので Vercel でも実行可能。
 * - Remotion(remotion / 未指定): Chromium 1.5GB が必要で Vercel Functions に乗らないため
 *   ローカル開発限定（VIDEO_RENDERING_ENABLED=1 で強制有効化可）。
 */
export function videoCapability(mode?: VideoGenerationMode): VideoCapability {
  // HeyGen はクラウドレンダ + ポーリング分離済み → どの環境でも実行可
  if (mode === 'heygen_avatar') {
    return { enabled: true, reason: 'enabled', message: '' }
  }
  if (isVercelRuntime()) {
    return {
      enabled: false,
      reason: 'disabled-on-vercel',
      message: LOCAL_VIDEO_MESSAGE,
    }
  }
  return {
    enabled: true,
    reason: 'enabled',
    message: '',
  }
}
