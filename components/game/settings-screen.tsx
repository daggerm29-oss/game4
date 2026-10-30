'use client'

import { X } from 'lucide-react'
import type { QualitySetting, UIState } from '@/lib/game/store'
import { cn } from '@/lib/utils'

const OPTIONS: { value: QualitySetting; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'Benchmarks your device and adapts resolution live' },
  { value: 'low', label: 'Low', description: 'No post effects, smaller city, 30 fps target' },
  { value: 'medium', label: 'Medium', description: 'Bloom, grain, traffic lights' },
  { value: 'high', label: 'High', description: 'Full city, depth of field, MSAA' },
]

export function SettingsScreen({
  state,
  onSelect,
  onClose,
}: {
  state: UIState
  onSelect: (value: QualitySetting) => void
  onClose: () => void
}) {
  return (
    <div className="safe-pad absolute inset-0 z-30 flex flex-col gap-4 bg-background/95 backdrop-blur animate-in fade-in duration-200">
      <header className="flex items-center justify-between">
        <h2 className="text-3xl font-extrabold uppercase tracking-tight">Graphics</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="flex size-11 items-center justify-center rounded-md border border-border bg-card"
        >
          <X className="size-5" />
        </button>
      </header>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Quality">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={state.qualitySetting === option.value}
            onClick={() => onSelect(option.value)}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-md border px-4 py-3 text-left transition',
              state.qualitySetting === option.value ? 'border-primary bg-primary/10' : 'border-border bg-card',
            )}
          >
            <span className="text-xl font-bold uppercase tracking-wider">{option.label}</span>
            <span className="text-sm text-muted-foreground">{option.description}</span>
          </button>
        ))}
      </div>
      <p className="mt-auto font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Active tier {state.tier} / {state.fps} fps
      </p>
    </div>
  )
}
