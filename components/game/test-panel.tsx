'use client'

import { ChevronDown, ChevronUp, FlaskConical, SkipForward, Zap } from 'lucide-react'
import { useState } from 'react'
import type { Game } from '@/lib/game/game'
import { RUNNING_PHASES, type UIState } from '@/lib/game/store'
import { CART_START_LEVEL, TEST_MAX_LEVEL } from '@/lib/shared/game'
import { cn } from '@/lib/utils'

const LEVELS = Array.from({ length: TEST_MAX_LEVEL }, (_, i) => i + 1)

export function TestPanel({ game, state }: { game: Game; state: UIState }) {
  const [open, setOpen] = useState(true)
  const inRun = RUNNING_PHASES.includes(state.phase)

  const jumpTo = (level: number) => {
    if (inRun || state.phase === 'FALL' || state.phase === 'RESULT') game.quitToMenu()
    void game.startRun(level)
  }

  return (
    <aside
      aria-label="Test controls"
      className="absolute right-2 top-2 z-30 w-64 rounded-md border border-border bg-background/85 text-foreground shadow-lg backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-bold uppercase tracking-[0.2em]"
      >
        <span className="flex items-center gap-2">
          <FlaskConical className="size-4" aria-hidden />
          Test mode
        </span>
        {open ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-3 pb-3 pt-2">
          <dl className="grid grid-cols-3 gap-1 text-center font-mono text-[10px] uppercase text-muted-foreground">
            <div className="rounded-sm bg-foreground/5 py-1">
              <dt>Level</dt>
              <dd className="text-sm font-bold text-foreground">{state.level}</dd>
            </div>
            <div className="rounded-sm bg-foreground/5 py-1">
              <dt>Respawns</dt>
              <dd className="text-sm font-bold text-foreground">{state.respawns}</dd>
            </div>
            <div className="rounded-sm bg-foreground/5 py-1">
              <dt>Phase</dt>
              <dd className="truncate px-1 text-[10px] font-bold text-foreground">{state.phase}</dd>
            </div>
          </dl>

          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Start at level</p>
            <div className="grid grid-cols-5 gap-1">
              {LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  disabled={state.busy}
                  onClick={() => jumpTo(level)}
                  className={cn(
                    'rounded-sm py-1 text-xs font-bold tabular-nums transition-colors disabled:opacity-50',
                    level >= CART_START_LEVEL
                      ? 'bg-primary/20 hover:bg-primary/40'
                      : 'bg-foreground/10 hover:bg-foreground/20',
                    inRun && state.level === level && 'ring-2 ring-primary',
                  )}
                  aria-label={`Start at level ${level}${level >= CART_START_LEVEL ? ', coaster' : ''}`}
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">Highlighted levels are coaster levels (respawns active).</p>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={state.busy || !inRun || state.level >= TEST_MAX_LEVEL}
              onClick={() => jumpTo(state.level + 1)}
              className="flex items-center justify-center gap-1.5 rounded-sm bg-foreground px-2 py-1.5 text-xs font-bold text-background disabled:opacity-40"
            >
              <SkipForward className="size-3.5" aria-hidden />
              Skip level
            </button>
            <button
              type="button"
              disabled={state.phase !== 'CART'}
              onClick={() => game.testDerail()}
              className="flex items-center justify-center gap-1.5 rounded-sm bg-danger px-2 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            >
              <Zap className="size-3.5" aria-hidden />
              Derail now
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Skip restarts the run at the next level with 3 respawns. Derail now crashes the cart to test checkpoints.
            Test runs are never ranked.
          </p>
        </div>
      )}
    </aside>
  )
}
