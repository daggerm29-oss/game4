'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Game } from '@/lib/game/game'
import { RUNNING_PHASES, type UIState, initialUIState } from '@/lib/game/store'
import { telegram } from '@/lib/game/telegram'
import { Hud } from './hud'
import { LeaderboardScreen } from './leaderboard-screen'
import { LoadingScreen } from './loading-screen'
import { MenuScreen } from './menu-screen'
import { ResultScreen } from './result-screen'
import { SettingsScreen } from './settings-screen'
import { TestPanel } from './test-panel'

const noopSubscribe = () => () => {}
const getInitial = () => initialUIState

function useGameState(game: Game | null): UIState {
  return useSyncExternalStore(
    game ? game.store.subscribe : noopSubscribe,
    game ? game.store.get : getInitial,
    getInitial,
  )
}

export function GameRoot({ testMode = false }: { testMode?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [muted, setMuted] = useState(false)
  const state = useGameState(game)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const instance = new Game()
    setGame(instance)
    void instance.boot(container)
    return () => instance.destroy()
  }, [])

  const inRun = RUNNING_PHASES.includes(state.phase)

  // Telegram BackButton: closes overlays, or leaves the current run.
  useEffect(() => {
    if (!game) return
    if (state.overlay !== 'none') return telegram.backButton(() => game.store.set({ overlay: 'none' }))
    if (inRun || state.phase === 'RESULT') return telegram.backButton(() => game.quitToMenu())
    return telegram.backButton(null)
  }, [game, state.overlay, state.phase, inRun])

  const openOverlay = (overlay: UIState['overlay']) => game?.store.set({ overlay })

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0 touch-none" aria-hidden />

      {state.tier === 'low' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{
            opacity: 0.55 + state.stress * 0.45,
            background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.85) 100%)',
          }}
        />
      )}

      {game && inRun && <Hud state={state} game={game} />}

      {game && state.phase === 'MENU' && state.overlay === 'none' && (
        <MenuScreen
          state={state}
          muted={muted}
          onPlay={() => void game.startRun()}
          onLeaderboard={() => openOverlay('leaderboard')}
          onSettings={() => openOverlay('settings')}
          onToggleMute={() => {
            game.setMuted(!muted)
            setMuted(!muted)
          }}
        />
      )}

      {game && state.phase === 'RESULT' && state.overlay === 'none' && (
        <ResultScreen
          state={state}
          onRetry={() => void game.startRun()}
          onLeaderboard={() => openOverlay('leaderboard')}
          onMenu={() => game.quitToMenu()}
        />
      )}

      {game && state.overlay === 'leaderboard' && (
        <LeaderboardScreen groupLaunch={state.groupLaunch} onClose={() => openOverlay('none')} />
      )}
      {game && state.overlay === 'settings' && (
        <SettingsScreen state={state} onSelect={(value) => game.setQuality(value)} onClose={() => openOverlay('none')} />
      )}

      {game && testMode && state.phase !== 'LOADING' && <TestPanel game={game} state={state} />}

      {state.phase === 'LOADING' && (
        <LoadingScreen progress={state.loadingProgress} label={state.loadingLabel} error={state.error} />
      )}
    </div>
  )
}
