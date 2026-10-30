'use client'

import dynamic from 'next/dynamic'
import { LoadingScreen } from './loading-screen'

// Three.js and the game engine are client-only and heavy, so they load after first paint.
const GameRoot = dynamic(() => import('./game-root').then((m) => m.GameRoot), {
  ssr: false,
  loading: () => <LoadingScreen progress={0.02} label="Loading engine" />,
})

export function GameLoader({ testMode = false }: { testMode?: boolean }) {
  return <GameRoot testMode={testMode} />
}
