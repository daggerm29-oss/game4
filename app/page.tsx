import { GameLoader } from '@/components/game/game-loader'

export default function Page() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-background">
      <h1 className="sr-only">Skywalk, a memory survival game</h1>
      <GameLoader />
    </main>
  )
}
