import { CART_RESPAWNS, type RunResult } from '@/lib/shared/game'

export type Phase =
  | 'LOADING'
  | 'MENU'
  | 'SIGN_PHASE'
  | 'GATE_PHASE'
  | 'LEVEL_COMPLETE'
  | 'BOARDING'
  | 'CART'
  | 'FALL'
  | 'RESULT'
export type Tier = 'low' | 'medium' | 'high'
export type QualitySetting = 'auto' | Tier
export type Overlay = 'none' | 'leaderboard' | 'settings'

/** On-foot phases of the runner. */
export const RUNNER_PHASES: readonly Phase[] = ['SIGN_PHASE', 'GATE_PHASE', 'LEVEL_COMPLETE']
/** Every phase of a live run, on foot or in the cart. */
export const RUNNING_PHASES: readonly Phase[] = [...RUNNER_PHASES, 'BOARDING', 'CART']

export interface UIState {
  phase: Phase
  overlay: Overlay
  loadingProgress: number
  loadingLabel: string
  level: number
  /** Gates already passed in the current round. */
  stepIndex: number
  stepCount: number
  stress: number
  hint: string
  /** Short banner such as "Level 3", shown when a new round begins. */
  banner: string
  blackout: boolean
  /** True while riding the cart (levels 6+). */
  cart: boolean
  /** Fog bank thickness, 0..1. */
  mist: number
  /** -1..1, how close the cart is to sliding off the left/right edge. */
  edge: number
  /** Coaster respawns left in the current run. */
  respawns: number
  tier: Tier
  qualitySetting: QualitySetting
  fps: number
  inTelegram: boolean
  guest: boolean
  groupLaunch: boolean
  playerName: string
  result: (RunResult & { reason: string }) | null
  error: string | null
  busy: boolean
}

type Listener = () => void

export function createStore(initial: UIState) {
  let state = initial
  const listeners = new Set<Listener>()
  return {
    get: () => state,
    set(patch: Partial<UIState>) {
      let changed = false
      for (const key in patch) {
        if (!Object.is(state[key as keyof UIState], patch[key as keyof UIState])) {
          changed = true
          break
        }
      }
      if (!changed) return
      state = { ...state, ...patch }
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type GameStore = ReturnType<typeof createStore>

export const initialUIState: UIState = {
  phase: 'LOADING',
  overlay: 'none',
  loadingProgress: 0,
  loadingLabel: 'Preparing',
  level: 1,
  stepIndex: 0,
  stepCount: 0,
  stress: 0,
  hint: '',
  banner: '',
  blackout: false,
  cart: false,
  mist: 0,
  edge: 0,
  respawns: CART_RESPAWNS,
  tier: 'medium',
  qualitySetting: 'auto',
  fps: 60,
  inTelegram: false,
  guest: true,
  groupLaunch: false,
  playerName: '',
  result: null,
  error: null,
  busy: false,
}
