'use client'

import { Terminal, AlertTriangle } from 'lucide-react'

/**
 * 動画生成がローカル限定であることを示すバナー。
 * Vercel 環境 (NEXT_PUBLIC_VERCEL_ENV in [production, preview]) で表示する。
 *
 * クライアント側で判定する必要があるので、サーバー側ヘルパー (lib/runtime-env.ts) と
 * 同じロジックを最低限ここで再実装する（NEXT_PUBLIC_ プレフィックスでバンドルに含まれる値のみ参照）。
 */
function isVercelClient(): boolean {
  if (process.env.NEXT_PUBLIC_VIDEO_RENDERING_ENABLED === '1') return false
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV
  return env === 'production' || env === 'preview'
}

interface LocalOnlyBannerProps {
  /** "block" だと作成系の警告強め, "info" だと閲覧時の控えめ表示 */
  variant?: 'block' | 'info'
}

export function LocalOnlyBanner({ variant = 'info' }: LocalOnlyBannerProps) {
  if (!isVercelClient()) return null

  const isBlock = variant === 'block'
  const Icon = isBlock ? AlertTriangle : Terminal

  return (
    <div
      className={
        isBlock
          ? 'mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900'
          : 'mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900'
      }
      role={isBlock ? 'alert' : undefined}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-semibold">動画生成はローカル環境限定です</p>
        <p className="mt-1 text-xs leading-relaxed opacity-90">
          Vercel 上では Chromium レンダリング (約 1.5GB / 数分) を実行できないため、
          動画作成・再生成は <span className="font-mono">npm run dev</span> で起動したローカル環境でのみ動作します。
          {isBlock && (
            <>
              <br />
              ローカルで生成した動画は同じ DB に保存されるので、TikTok / YouTube への
              投稿（このページの「公開」ボタン）は Vercel からでも動作します。
            </>
          )}
        </p>
      </div>
    </div>
  )
}
