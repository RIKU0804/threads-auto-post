import type { GenerationMode, VideoStatus, VoiceSource } from '@/types/database'

/** 動画生成の平均所要時間の見積もり (進捗バーの滑らか化に使用) */
export const ESTIMATED_TOTAL_MS = 3 * 60 * 1000

/** GET /api/videos/[id]/status のレスポンス */
export interface StatusResponse {
  status: VideoStatus
  step: string
  sceneProgress?: { completed: number; total: number }
  error?: string
}

/** 残り時間を「○秒 / ○分」表記にする */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'もう少し'
  const sec = Math.ceil(ms / 1000)
  if (sec < 60) return `${sec}秒`
  const min = Math.ceil(sec / 60)
  return `${min}分`
}

/**
 * 離散ステップ + 経過時間から、連続的な進捗 (0..1) を出す。
 * ステップが進めばその下限まで一気に飛び、ステップ内では経過時間で滑らかに進む。
 * HeyGen モードはシーン分割した画像生成が無いので breakpoint を変える。
 */
export function computeContinuousProgress(
  status: VideoStatus,
  info: StatusResponse | null,
  elapsedMs: number,
  mode: GenerationMode,
  voiceSource: VoiceSource | null,
): number {
  const elapsedFrac = Math.min(1, elapsedMs / ESTIMATED_TOTAL_MS)

  if (mode === 'heygen_avatar') {
    // HeyGen: script 0-25 / voice 25-45 (elevenlabs のみ) / rendering 45-95 / ready 100
    switch (status) {
      case 'draft':
      case 'generating_script':
        return Math.min(0.25, 0.05 + elapsedFrac * 0.2)
      case 'generating_voice':
        // HeyGen 内蔵ボイス時はここを通らないが、念のため
        return Math.min(0.45, 0.25 + elapsedFrac * 0.2)
      case 'generating_images':
        // HeyGen ではここに来ない想定だが、来たら voice と同じ帯で扱う
        return voiceSource === 'elevenlabs' ? 0.45 : 0.25
      case 'rendering':
        return Math.min(0.95, 0.45 + elapsedFrac * 0.5)
      case 'ready':
        return 1
      case 'failed':
        return 0
    }
  }

  switch (status) {
    case 'draft':
    case 'generating_script':
      return Math.min(0.18, 0.05 + elapsedFrac * 0.13)
    case 'generating_images': {
      const base = 0.2
      const span = 0.4
      if (info?.sceneProgress && info.sceneProgress.total > 0) {
        return base + (info.sceneProgress.completed / info.sceneProgress.total) * span
      }
      return Math.min(base + span - 0.05, base + elapsedFrac * span)
    }
    case 'generating_voice': {
      const base = 0.6
      const span = 0.2
      if (info?.sceneProgress && info.sceneProgress.total > 0) {
        return base + (info.sceneProgress.completed / info.sceneProgress.total) * span
      }
      return Math.min(base + span - 0.02, base + elapsedFrac * span)
    }
    case 'rendering':
      return Math.min(0.97, 0.85 + elapsedFrac * 0.12)
    case 'ready':
      return 1
    case 'failed':
      return 0
  }
}
