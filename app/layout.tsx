import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'

const display = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-display',
})
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono-face' })

export const metadata: Metadata = {
  title: 'Skywalk - Memory Survival',
  description:
    'A Telegram Mini App memory survival game. Memorize the faces, walk the steel beam, pick the right doors, or fall.',
  generator: 'v0.app',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#07090d',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${mono.variable} bg-background`}>
      <body className="antialiased">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
