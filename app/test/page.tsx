import type { Metadata } from 'next'
import { GameLoader } from '@/components/game/game-loader'

export const metadata: Metadata = {
  title: 'Skywalk – Test mode',
  robots: { index: false, follow: false },
}

export default function TestPage() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-background">
      <h1 className="sr-only">Skywalk test mode: skip levels and test coaster respawns</h1>
      <GameLoader testMode />
    </main>
  )
}
