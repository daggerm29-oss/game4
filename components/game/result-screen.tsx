import type { UIState } from '@/lib/game/store'

const REASONS: Record<string, string> = {
  wrong_door: 'Wrong door. The floor gave way.',
  wall: 'You ran into the wall and went over the edge.',
  timeout: 'You hesitated. The wind did not.',
  implausible: 'Too fast to be human. The tower noticed.',
  forfeit: 'You let go.',
  wrong_track: 'Wrong track. The rails ended in the fog.',
  derailed: 'The cart left the rails. It was a long way down.',
}

function formatTime(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

interface Props {
  state: UIState
  onRetry: () => void
  onLeaderboard: () => void
  onMenu: () => void
}

export function ResultScreen({ state, onRetry, onLeaderboard, onMenu }: Props) {
  const result = state.result
  if (!result) return null
  return (
    <div className="safe-pad absolute inset-0 z-20 flex flex-col items-center justify-center gap-8 bg-background/75 text-center backdrop-blur-sm animate-in fade-in duration-700">
      <div className="flex flex-col items-center gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.4em] text-danger">Signal lost</p>
        <p className="text-7xl font-extrabold uppercase leading-none tracking-tight">You fell</p>
        <p className="max-w-xs text-lg text-muted-foreground">{REASONS[result.reason] ?? REASONS.wrong_door}</p>
      </div>

      <dl className="grid w-full max-w-sm grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
        <Stat label="Level" value={String(result.level)} />
        <Stat label="Time" value={formatTime(result.timeMs)} />
        <Stat label="Best" value={String(result.bestLevel)} />
      </dl>

      <div className="flex flex-col items-center gap-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {result.postedToGroup && <p>Result posted to your group</p>}
        {!result.ranked && <p>Guest runs are not ranked. Play inside Telegram to compete.</p>}
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={state.busy}
          className="h-16 rounded-md bg-primary text-2xl font-bold uppercase tracking-widest text-primary-foreground transition active:scale-[0.98] disabled:opacity-60"
        >
          {state.busy ? 'Climbing' : 'Retry'}
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onLeaderboard}
            className="h-12 flex-1 rounded-md border border-border bg-card/80 text-base font-semibold uppercase tracking-widest transition active:scale-[0.98]"
          >
            Leaderboard
          </button>
          <button
            type="button"
            onClick={onMenu}
            className="h-12 flex-1 rounded-md border border-border bg-card/80 text-base font-semibold uppercase tracking-widest transition active:scale-[0.98]"
          >
            Menu
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-card px-3 py-4">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-bold tabular-nums">{value}</dd>
    </div>
  )
}
