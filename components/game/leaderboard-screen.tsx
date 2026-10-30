'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import useSWR from 'swr'
import { api } from '@/lib/game/api'
import type { LeaderboardEntry } from '@/lib/shared/game'
import { cn } from '@/lib/utils'

function formatTime(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

export function LeaderboardScreen({ groupLaunch, onClose }: { groupLaunch: boolean; onClose: () => void }) {
  const [scope, setScope] = useState<'global' | 'group'>(groupLaunch ? 'group' : 'global')
  const { data, error, isLoading } = useSWR(['leaderboard', scope], () => api.leaderboard(scope), {
    revalidateOnFocus: false,
  })

  return (
    <div className="safe-pad absolute inset-0 z-30 flex flex-col gap-4 bg-background/95 backdrop-blur animate-in fade-in duration-200">
      <header className="flex items-center justify-between">
        <h2 className="text-3xl font-extrabold uppercase tracking-tight">Survivors</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close leaderboard"
          className="flex size-11 items-center justify-center rounded-md border border-border bg-card"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="grid grid-cols-2 gap-1 rounded-md bg-secondary p-1" role="tablist" aria-label="Leaderboard scope">
        {(['group', 'global'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={scope === s}
            disabled={s === 'group' && !groupLaunch}
            onClick={() => setScope(s)}
            className={cn(
              'h-10 rounded-sm text-sm font-semibold uppercase tracking-widest transition disabled:opacity-35',
              scope === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
            )}
          >
            {s === 'group' ? 'This group' : 'Global'}
          </button>
        ))}
      </div>

      <div data-scrollable className="flex-1 overflow-y-auto overscroll-contain" style={{ touchAction: 'pan-y' }}>
        {isLoading && <p className="py-10 text-center font-mono text-sm text-muted-foreground">Loading</p>}
        {error && (
          <p role="alert" className="py-10 text-center text-sm text-danger">
            {error instanceof Error ? error.message : 'Could not load the leaderboard'}
          </p>
        )}
        {data && data.entries.length === 0 && (
          <p className="py-10 text-center text-muted-foreground">Nobody has survived yet. Be the first.</p>
        )}
        {data && data.entries.length > 0 && (
          <ol className="flex flex-col gap-1">
            {data.entries.map((entry) => (
              <Row key={`${entry.rank}-${entry.name}`} entry={entry} />
            ))}
          </ol>
        )}
        {data?.me && !data.entries.some((e) => e.isMe) && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Your best</p>
            <ol>
              <Row entry={data.me} />
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-3',
        entry.isMe ? 'border-primary/60 bg-primary/10' : 'border-border bg-card',
      )}
    >
      <span className={cn('w-8 font-mono text-lg tabular-nums', entry.rank <= 3 ? 'text-primary' : 'text-muted-foreground')}>
        {entry.rank}
      </span>
      <span className="flex-1 truncate text-lg font-semibold">{entry.name}</span>
      <span className="text-right">
        <span className="block text-xl font-bold leading-none">L{entry.level}</span>
        <span className="font-mono text-xs text-muted-foreground">{formatTime(entry.timeMs)}</span>
      </span>
    </li>
  )
}
