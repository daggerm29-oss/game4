import { ChevronsLeftRight, Heart } from 'lucide-react'
import { CART_RESPAWNS } from '@/lib/shared/game'
import type { Game } from '@/lib/game/game'
import type { UIState } from '@/lib/game/store'
import { cn } from '@/lib/utils'
import { Minimap } from './minimap'

export function Hud({ state, game }: { state: UIState; game: Game }) {
  const edge = Math.abs(state.edge)
  const edgeSide = state.edge < 0 ? 'left' : 'right'
  return (
    <>
      {state.cart && state.mist > 0.02 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            opacity: Math.min(0.92, state.mist * 0.95),
            background:
              'radial-gradient(ellipse at 50% 60%, rgba(150,160,172,0.75) 0%, rgba(118,128,140,0.92) 55%, rgba(80,88,100,0.97) 100%)',
          }}
        />
      )}

      {state.cart && edge > 0.55 && (
        <div
          aria-hidden
          className={cn('pointer-events-none absolute inset-y-0 z-[6] w-1/4', edgeSide === 'left' ? 'left-0' : 'right-0')}
          style={{
            opacity: Math.min(1, (edge - 0.55) / 0.4),
            background: `linear-gradient(to ${edgeSide === 'left' ? 'right' : 'left'}, rgba(220,38,38,0.55), transparent)`,
          }}
        />
      )}

      <div className="safe-pad pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Level</span>
              <span className="text-4xl font-extrabold leading-none tabular-nums">{state.level}</span>
            </div>
            {state.cart && (
              <div className="flex items-center gap-1" aria-label={`${state.respawns} of ${CART_RESPAWNS} respawns left`}>
                {Array.from({ length: CART_RESPAWNS }, (_, i) => (
                  <Heart
                    key={i}
                    aria-hidden
                    className={cn(
                      'size-4',
                      i < state.respawns ? 'fill-danger text-danger' : 'fill-transparent text-foreground/30',
                    )}
                  />
                ))}
              </div>
            )}
          </div>
          {state.stepCount > 0 && (
            <ol
              className="flex items-center gap-1.5"
              aria-label={`${state.stepCount - state.stepIndex} ${state.cart ? 'forks' : 'gates'} left`}
            >
              {Array.from({ length: state.stepCount }, (_, i) => (
                <li
                  key={i}
                  className={cn(
                    state.cart ? 'h-2.5 w-1.5 -skew-x-12 rounded-[1px]' : 'size-2.5 rounded-full',
                    i < state.stepIndex ? 'bg-primary' : i === state.stepIndex ? 'bg-foreground' : 'bg-foreground/25',
                  )}
                />
              ))}
            </ol>
          )}
        </div>

        <div className="flex min-h-8 justify-center pt-1" aria-live="polite">
          {state.blackout ? (
            <span className="rounded-sm bg-danger/90 px-3 py-1 text-sm font-bold uppercase tracking-[0.3em] text-white">
              Power failure
            </span>
          ) : state.banner ? (
            <span className="animate-in fade-in zoom-in-95 rounded-sm bg-background/60 px-4 py-1 text-xl font-extrabold uppercase tracking-[0.25em] backdrop-blur duration-300">
              {state.banner}
            </span>
          ) : state.cart && edge > 0.7 ? (
            <span className="animate-pulse rounded-sm bg-danger/90 px-3 py-1 text-sm font-bold uppercase tracking-[0.3em] text-white">
              {edgeSide === 'left' ? 'Slide right' : 'Slide left'}
            </span>
          ) : null}
        </div>
      </div>

      <div className="safe-pad pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 pb-4">
        {state.hint && (
          <span className="flex max-w-[90vw] items-center gap-2 rounded-full bg-background/60 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-foreground/90 backdrop-blur animate-pulse sm:text-sm">
            <ChevronsLeftRight className="size-5 shrink-0" aria-hidden />
            {state.hint}
          </span>
        )}
      </div>
      {state.cart && (
        <div className="safe-pad pointer-events-none absolute bottom-0 left-0 z-10 pb-4 pl-4">
          <Minimap game={game} mist={state.mist} />
        </div>
      )}
    </>
  )
}
