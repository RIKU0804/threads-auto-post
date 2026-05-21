import 'server-only'
import { runVideoPipeline, type PipelineRunOptions } from '@/lib/video/pipeline'

/**
 * 動画パイプラインのジョブ起動アダプタ。
 *
 * 目的: ルートハンドラやサーバーアクションを「ジョブの起動」だけに薄く保ち、
 * 実体のバックエンド (setImmediate / Trigger.dev / Inngest / SQS など) を
 * env で差し替えられるようにする。
 *
 * バックエンド選択:
 *   1. process.env.TRIGGER_PUBLIC_API_KEY が設定されている  → Trigger.dev (TODO)
 *   2. それ以外                                              → 既定: setImmediate
 *
 * 【重要】既定の setImmediate 実装は dev/PoC 専用。
 * Vercel の Functions は 60s/300s でレスポンス後に終了するため、
 * 数分かかる Remotion レンダリングは途中で打ち切られる。
 * 本番では必ず Trigger.dev / Inngest / 外部 Worker を構成すること。
 */

interface JobBackend {
  name: 'inline' | 'trigger-dev'
  enqueue(videoId: string, opts: PipelineRunOptions): Promise<void>
}

function selectBackend(): JobBackend {
  if (process.env.TRIGGER_PUBLIC_API_KEY) {
    return triggerDevBackend
  }
  return inlineBackend
}

// ---------------------------------------------------------------------------
// 既定: inline (setImmediate)
// ---------------------------------------------------------------------------

const inlineBackend: JobBackend = {
  name: 'inline',
  async enqueue(videoId: string, opts: PipelineRunOptions): Promise<void> {
    // setImmediate でイベントループの次のティックに逃がす。
    // 例外を catch して swallow しないと unhandledRejection でプロセスが落ちる。
    setImmediate(() => {
      runVideoPipeline(videoId, opts).catch((err: unknown) => {
        // structured logger が無い環境では best-effort で stderr へ書く。
        // パイプライン本体は内部で failed に落とすため、ここに来るのは「failed への書き込み自体が失敗した」場合のみ。
        process.stderr.write(
          `[video-pipeline] fatal in inline backend for ${videoId}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        )
      })
    })
  },
}

// ---------------------------------------------------------------------------
// Trigger.dev (TODO: 本番統合)
// ---------------------------------------------------------------------------

const triggerDevBackend: JobBackend = {
  name: 'trigger-dev',
  async enqueue(videoId: string, opts: PipelineRunOptions): Promise<void> {
    // TODO(prod): Trigger.dev SDK を統合する。
    //
    // 想定実装 (SDK 未インストール / 環境変数のみで stub):
    //
    //   import { tasks } from '@trigger.dev/sdk/v3'
    //   await tasks.trigger('run-video-pipeline', { videoId, ...opts })
    //
    // それまでは inline backend にフォールバック。
    process.stderr.write(
      `[video-pipeline] TRIGGER_PUBLIC_API_KEY is set but Trigger.dev integration is not yet implemented. Falling back to inline. videoId=${videoId}\n`,
    )
    await inlineBackend.enqueue(videoId, opts)
  },
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 指定 videoId のパイプライン処理をジョブキューに投入する。
 *
 * 呼び出し側 (API ルート / Server Action) はこの関数を await して
 * 即座にレスポンスを返す。実際のパイプラインはバックエンドで非同期に走る。
 *
 * 【本番要件】
 *  - inline backend は数分かかる Remotion レンダリングを完走できない。
 *  - 本番では TRIGGER_PUBLIC_API_KEY (または同等) を設定して
 *    Trigger.dev / Inngest / 外部 Worker に処理を委譲すること。
 */
export async function enqueueVideoPipeline(
  videoId: string,
  opts: PipelineRunOptions = {},
): Promise<void> {
  if (!videoId || videoId.trim().length === 0) {
    throw new Error('videoId が空です')
  }
  const backend = selectBackend()
  await backend.enqueue(videoId, opts)
}
