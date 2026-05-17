'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, AlertCircle, X as XIcon } from 'lucide-react'
import { cx } from '@/lib/utils'

type ToastKind = 'success' | 'error' | 'info'

interface ToastAction {
  label: string
  href: string
}

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

interface ToastContextValue {
  show: (t: { kind: ToastKind; message: string; action?: ToastAction; durationMs?: number }) => void
  success: (message: string) => void
  error: (message: string, action?: ToastAction) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  const show = useCallback<ToastContextValue['show']>(({ kind, message, action, durationMs }) => {
    const id = nextId++
    // 同時表示は最大3件（古いものから破棄）
    setItems(prev => [...prev, { id, kind, message, action }].slice(-3))
    const ttl = durationMs ?? (kind === 'error' ? 7000 : 3500)
    setTimeout(() => remove(id), ttl)
  }, [remove])

  const success = useCallback((message: string) => show({ kind: 'success', message }), [show])
  const error = useCallback(
    (message: string, action?: ToastAction) => {
      // API キー未設定エラーは自動で「設定を開く」導線を付ける
      const autoAction = !action && /API\s?キー.*設定|設定.*API\s?キー/.test(message)
        ? { label: '設定を開く →', href: '/dashboard/settings' }
        : action
      show({ kind: 'error', message, action: autoAction })
    },
    [show],
  )

  return (
    <ToastContext.Provider value={{ show, success, error }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[4.5rem] z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map(t => {
          const Icon = t.kind === 'success' ? CheckCircle : AlertCircle
          return (
            <div
              key={t.id}
              role="status"
              aria-live="polite"
              className={cx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg px-4 py-3 text-sm shadow-lg ring-1',
                t.kind === 'success' && 'bg-green-600 text-white ring-green-700',
                t.kind === 'error' && 'bg-white text-red-600 ring-red-200',
                t.kind === 'info' && 'bg-slate-800 text-white ring-slate-700',
              )}
            >
              <Icon className="mt-px h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="leading-snug">{t.message}</p>
                {t.action && (
                  <Link
                    href={t.action.href}
                    onClick={() => remove(t.id)}
                    className="mt-1 inline-block font-semibold underline underline-offset-2"
                  >
                    {t.action.label}
                  </Link>
                )}
              </div>
              <button
                onClick={() => remove(t.id)}
                aria-label="閉じる"
                className="shrink-0 opacity-60 transition hover:opacity-100"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
