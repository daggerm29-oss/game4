'use client'

import { Settings, Trophy, Volume2, VolumeX } from 'lucide-react'
import type { UIState } from '@/lib/game/store'
import { FACE_EMOJI } from '@/lib/shared/game'

interface Props {
  state: UIState
  muted: boolean
  onPlay: () => void
  onLeaderboard: () => void
  onSettings: () => void
  onToggleMute: () => void
}

export function MenuScreen({ state, muted, onPlay, onLeaderboard, onSettings, onToggleMute }: Props) {
  return (
    <div className="safe-pad absolute inset-0 z-20 flex flex-col justify-between bg-gradient-to-b from-background/80 via-transparent to-background/95">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-muted-foreground">Floor 88 / Unfinished</p>
          <p className="text-5xl font-extrabold uppercase leading-[0.9] tracking-tight">Skywalk</p>
          <p className="mt-1 text-sm uppercase tracking-[0.25em] text-primary">Memory survival</p>
        </div>
        <div className="flex gap-2">
          <IconButton label={muted ? 'Unmute sound' : 'Mute sound'} onClick={onToggleMute}>
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </IconButton>
          <IconButton label="Graphics settings" onClick={onSettings}>
            <Settings className="size-5" />
          </IconButton>
        </div>
      </header>

      <section className="flex flex-col gap-5">
        <ol className="flex flex-col gap-2 text-base leading-snug text-foreground/90">
          <li className="flex gap-3">
            <span className="font-mono text-primary">01</span>
            <span>Memorize the faces on the sign before it goes dark.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-primary">02</span>
            <span>You never stop running. Swipe into the doorway showing the next face.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-primary">03</span>
            <span>Wrong door, the floor opens. Hit the wall, you go over the edge. Every level brings new faces.</span>
          </li>
        </ol>

        <p className="text-2xl tracking-[0.3em]" aria-label="Faces: grin, frown, flat, angry">
          {FACE_EMOJI.smile} {FACE_EMOJI.frown} {FACE_EMOJI.flat} {FACE_EMOJI.angry}
        </p>

        {state.error && (
          <p role="alert" className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.groupLaunch && (
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Launched from a group: your result will be posted there
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onPlay}
            disabled={state.busy}
            className="flex h-16 flex-1 items-center justify-center rounded-md bg-primary text-2xl font-bold uppercase tracking-widest text-primary-foreground transition active:scale-[0.98] disabled:opacity-60"
          >
            {state.busy ? 'Climbing' : 'Play'}
          </button>
          <button
            type="button"
            onClick={onLeaderboard}
            aria-label="Leaderboard"
            className="flex h-16 w-16 items-center justify-center rounded-md border border-border bg-card/80 text-foreground backdrop-blur transition active:scale-[0.98]"
          >
            <Trophy className="size-6" />
          </button>
        </div>
        <p className="text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {state.inTelegram ? 'Telegram' : 'Browser preview, guest mode'} / quality {state.tier}
        </p>
      </section>
    </div>
  )
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-md border border-border bg-card/70 text-foreground backdrop-blur transition active:scale-95"
    >
      {children}
    </button>
  )
}
