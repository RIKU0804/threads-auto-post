import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SNS AutoPost — マルチSNS自動投稿',
  description: 'SNS自動投稿管理システム（Threads / Instagram / X 対応）',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
