// TikTok publish status polling helper
//
// Direct Post 投稿は非同期: video/init で publish_id を取得 → status/fetch でポーリング。
// このモジュールは cron / 個別 status エンドポイントから呼び出す想定。

import 'server-only'
import {
  getTikTokPublishStatus,
  TikTokAuthError,
  type TikTokCredentials,
} from './tiktok'

export type TikTokPublishState =
  | 'in_progress'
  | 'complete'
  | 'failed'
  | 'unknown'

export interface TikTokStatusResult {
  /** 正規化済みの状態。判定ロジックは TikTok 側 status 文字列をマップしたもの */
  state: TikTokPublishState
  /** TikTok API の生 status 文字列 */
  rawStatus: string
  /** 失敗時の理由（あれば） */
  failReason?: string
  /** 公開完了時に TikTok が返す公開済み投稿 ID（取得できないケースもある） */
  publiclyAvailablePostId?: string
}

/** TikTok の status 文字列を正規化する */
function normalizeStatus(raw: string): TikTokPublishState {
  switch (raw) {
    case 'PUBLISH_COMPLETE':
    case 'SEND_TO_USER_INBOX':
      // SEND_TO_USER_INBOX = ユーザーの inbox に届けて編集待ち。
      // SaaS から見ると「TikTok 側の処理は完了」扱いで良い。
      return 'complete'
    case 'FAILED':
      return 'failed'
    case 'PROCESSING_UPLOAD':
    case 'PROCESSING_DOWNLOAD':
    case 'PROCESSING_VIDEO':
      return 'in_progress'
    default:
      return 'unknown'
  }
}

/**
 * publishId に対する公開ステータスを取得する。
 * 認証エラー時は呼び出し側で refresh→再試行を行う前提で TikTokAuthError をそのまま投げる。
 */
export async function checkTikTokPublishStatus(
  cred: TikTokCredentials,
  publishId: string,
): Promise<TikTokStatusResult> {
  if (!publishId) {
    throw new Error('publishId が空です')
  }

  const status = await getTikTokPublishStatus(cred, publishId)
  return {
    state: normalizeStatus(status.status),
    rawStatus: status.status,
    failReason: status.failReason,
    publiclyAvailablePostId: status.publiclyAvailablePostId?.[0],
  }
}

export { TikTokAuthError }
