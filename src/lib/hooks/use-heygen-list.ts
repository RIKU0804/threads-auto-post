'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * HeyGen API リストフェッチ用の共通ロード状態。
 * `code` はサーバ側で返ってきた識別子 (MISSING_HEYGEN_KEY / HEYGEN_AUTH 等) を保持し、
 * UI 側で特別扱いするテキストの分岐に使う。`message` は人間向けの fallback。
 */
export type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T[] }
  | { status: 'error'; code?: string; message: string }

interface UseHeygenListOptions {
  /** 例: '/api/heygen/avatars' */
  url: string
  /** レスポンスから配列を取り出すキー */
  dataKey: 'avatars' | 'voices'
  /** HeyGen モードを選んだ後だけ true にする */
  enabled: boolean
  /** ユーザー向けのデフォルトエラーメッセージ */
  defaultErrorMessage: string
}

interface UseHeygenListResult<T> {
  state: LoadState<T>
  refetch: () => void
}

/**
 * HeyGen のアバター / ボイス一覧を取得するフック。
 *
 * - `enabled=false` のあいだは fetch しない（idle 相当）
 * - `enabled=true` への遷移で初回ロードを開始
 * - `refetch()` で error 状態から再試行できる（"再試行" ボタン用）
 * - AbortController でアンマウント・連続再試行時のレースを抑止
 *
 * 内部の `fetchTrigger` カウンタが fetch の実行回数を駆動する:
 *   - enabled の依存変化と refetch() のどちらも、カウンタ更新で表現される
 *   - これにより effect 本体での sync な setState を避けられる
 */
export function useHeygenList<T>({
  url,
  dataKey,
  enabled,
  defaultErrorMessage,
}: UseHeygenListOptions): UseHeygenListResult<T> {
  const [state, setState] = useState<LoadState<T>>(() =>
    enabled ? { status: 'loading' } : { status: 'idle' },
  )
  // 初期 enabled=true なら 1 から、そうでなければ 0 から。
  // 「false → true」を初回トリガにするため、enabled が true でない限りカウンタを進めない。
  const [fetchTrigger, setFetchTrigger] = useState<number>(() => (enabled ? 1 : 0))

  // enabled が true になったら、まだ 0 なら 1 にする（state も idle なら loading に同期）。
  // props -> 内部状態の典型的なミラーリング。
  useEffect(() => {
    if (!enabled) return
    setFetchTrigger((v) => (v === 0 ? 1 : v))
    setState((prev) => (prev.status === 'idle' ? { status: 'loading' } : prev))
  }, [enabled])

  // fetchTrigger>0 のときだけ実行。 trigger が変わるたびに fetch が再走する。
  // effect 内の setState は .then() / .catch() の中（非同期コールバック）でのみ発生する。
  useEffect(() => {
    if (fetchTrigger === 0) return
    const ctrl = new AbortController()
    let stillLoading = true
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const data = (await res.json()) as
          | Record<string, T[]>
          | { error: string; code?: string }
        stillLoading = false
        if (!res.ok || 'error' in data) {
          const code =
            'code' in data && typeof data.code === 'string'
              ? data.code
              : res.status === 400
                ? 'MISSING_HEYGEN_KEY'
                : res.status === 401
                  ? 'HEYGEN_AUTH'
                  : undefined
          setState({ status: 'error', code, message: defaultErrorMessage })
          return
        }
        const arr = (data[dataKey] as T[] | undefined) ?? []
        setState({ status: 'success', data: arr })
      })
      .catch((err: unknown) => {
        stillLoading = false
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState({ status: 'error', message: defaultErrorMessage })
      })
    return () => {
      // アンマウントや再走時、レスポンスが返る前なら abort
      if (stillLoading) ctrl.abort()
    }
  }, [fetchTrigger, url, dataKey, defaultErrorMessage])

  const refetch = useCallback(() => {
    // refetch ボタンから呼ばれる。即座に "loading" 状態を反映するために state も更新。
    setState({ status: 'loading' })
    setFetchTrigger((v) => v + 1)
  }, [])

  return { state, refetch }
}
