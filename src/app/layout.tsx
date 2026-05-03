import type { Metadata } from 'next'
import { ColorSchemeScript, MantineProvider, createTheme } from '@mantine/core'
import './globals.css'

export const metadata: Metadata = {
  title: 'AutoPost — Threads自動投稿',
  description: 'Threads自動投稿管理システム',
}

const theme = createTheme({
  primaryColor: 'violet',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  defaultRadius: 'md',
  components: {
    Button: {
      defaultProps: { radius: 'md' },
    },
    TextInput: {
      defaultProps: { radius: 'md' },
    },
    Select: {
      defaultProps: { radius: 'md' },
    },
    Textarea: {
      defaultProps: { radius: 'md' },
    },
    PasswordInput: {
      defaultProps: { radius: 'md' },
    },
    Card: {
      defaultProps: { radius: 'md', withBorder: true },
    },
  },
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <MantineProvider theme={theme}>
          {children}
        </MantineProvider>
      </body>
    </html>
  )
}
