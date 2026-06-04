'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useModalA11y } from '@/lib/hooks/use-modal-a11y'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}

interface PendingState {
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>(resolve => setPending({ opts, resolve }))
  }, [])

  const close = useCallback((result: boolean) => {
    // resolve は setState updater の外で呼ぶ（updater は StrictMode/並行レンダーで
    // 複数回実行されうるため、中で副作用を起こすと resolve が二重に呼ばれる）。
    setPending(prev => {
      if (prev) prev.resolve(result)
      return null
    })
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialogView opts={pending.opts} onClose={close} />
      )}
    </ConfirmContext.Provider>
  )
}

/**
 * 確認ダイアログ本体。useModalA11y を使うため、pending が存在するときだけ
 * マウントされる独立コンポーネントに分離する（フックは条件付きで呼べないため）。
 */
function ConfirmDialogView({
  opts,
  onClose,
}: {
  opts: ConfirmOptions
  onClose: (result: boolean) => void
}) {
  // Esc / フォーカストラップ / スクロールロックを共通フックで担保
  const modalRef = useModalA11y<HTMLDivElement>(true, () => onClose(false))

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => onClose(false)} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={opts.title ? 'confirm-title' : undefined}
        className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl ring-1 ring-black/5"
      >
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            opts.destructive ? 'bg-red-50' : 'bg-[#E9F7F9]'
          }`}>
            <AlertTriangle className={`h-4 w-4 ${opts.destructive ? 'text-red-500' : 'text-[#00A3BF]'}`} />
          </div>
          <div className="flex-1">
            {opts.title && (
              <p id="confirm-title" className="text-sm font-semibold text-gray-900">{opts.title}</p>
            )}
            <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{opts.message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => onClose(false)}
            className="rounded-md px-3.5 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
          >
            {opts.cancelLabel ?? 'キャンセル'}
          </button>
          <button
            onClick={() => onClose(true)}
            className={`rounded-md px-3.5 py-2 text-sm font-semibold text-white transition ${
              opts.destructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[#00A3BF] hover:bg-[#008CA8]'
            }`}
          >
            {opts.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
