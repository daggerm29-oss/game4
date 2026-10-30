export function LoadingScreen({ progress, label, error }: { progress: number; label: string; error?: string | null }) {
  const pct = Math.round(progress * 100)
  return (
    <div className="safe-pad absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-background">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.4em] text-muted-foreground">Floor 88 / Unfinished</p>
        <p className="text-6xl font-extrabold uppercase leading-none tracking-tight text-foreground">Skywalk</p>
        <p className="text-sm uppercase tracking-[0.25em] text-primary">Memory survival</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <div
          className="h-2 w-full overflow-hidden rounded-sm bg-secondary"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Loading"
        >
          <div className="hazard-stripes h-full transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between font-mono text-xs uppercase tracking-widest text-muted-foreground">
          <span>{error ? 'Error' : label}</span>
          <span>{pct}%</span>
        </div>
        {error && (
          <p role="alert" className="text-center text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
