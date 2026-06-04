'use client'

import { useEffect, useRef } from 'react'

/**
 * モーダル/ダイアログのアクセシビリティ要件を満たす共通フック。
 *
 * - Esc キーで onClose を呼ぶ
 * - 開いた瞬間に最初のフォーカス可能要素へフォーカスを移す
 * - モーダル内にフォーカスをトラップ (Tab/Shift+Tab がモーダル外に出ない)
 * - 開いている間 body のスクロールをロック (背面スクロール連鎖を防ぐ)
 * - 閉じたあと、開く前にフォーカスしていた要素へフォーカスを戻す
 *
 * 戻り値の ref をモーダル本体 (背景ではなくダイアログ部分) に付ける:
 *   const modalRef = useModalA11y(open, onClose)
 *   <div ref={modalRef} role="dialog" aria-modal="true">...</div>
 *
 * 注意: スクリーンリーダーが「ダイアログ」と認識するには
 * 利用側で `role="dialog" aria-modal="true" aria-labelledby` を必ず付けること。
 */
export function useModalA11y<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // onClose を ref に保持して effect の依存から外す。
  // 親が毎レンダーで新しい onClose を渡しても、effect が再実行されて
  // 初期フォーカスが飛んだり focus 復元が誤発火するのを防ぐ。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    // 開く前のフォーカスを覚えて、閉じたあと戻す
    prevFocusRef.current = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null

    // 初期フォーカス: モーダル内の最初のフォーカス可能要素
    const node = ref.current
    if (node) {
      const focusable = getFocusable(node)
      if (focusable.length > 0) {
        focusable[0].focus()
      } else {
        // 何もフォーカス可能なものが無いときはコンテナ自体に tabindex=-1 でフォーカスを当てる
        if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
        node.focus()
      }
    }

    // body スクロールロック (復元用に元の値を保持)
    const prevBodyOverflow = typeof document !== 'undefined' ? document.body.style.overflow : ''
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden'
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab') {
        const container = ref.current
        if (!container) return
        const focusable = getFocusable(container)
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey) {
          if (active === first || !container.contains(active)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (active === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      // body スクロールを復元
      if (typeof document !== 'undefined') {
        document.body.style.overflow = prevBodyOverflow
      }
      // 閉じた後、可能なら元のフォーカスへ戻す。
      // この cleanup は open=false への遷移時のみ走る (依存配列が [open] だけなので、
      // onClose の identity 変化では再実行されない)。
      const prev = prevFocusRef.current
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus()
      }
    }
  }, [open])

  return ref
}

/**
 * モーダル内のフォーカス可能要素を取得する。
 * disabled, tabindex=-1 は除外。表示中のもののみ。
 */
function getFocusable(container: HTMLElement): HTMLElement[] {
  const SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  return Array.from(container.querySelectorAll<HTMLElement>(SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === container,
  )
}
