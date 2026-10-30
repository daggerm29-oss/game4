export const BASE_FACES = ['smile', 'frown', 'flat', 'angry'] as const
export type BaseFace = (typeof BASE_FACES)[number]

export const DECOY_FACES = ['smirk', 'worried', 'meh', 'grumpy'] as const
export type DecoyFace = (typeof DECOY_FACES)[number]

export type Face = BaseFace | DecoyFace

export const DECOY_OF: Record<BaseFace, DecoyFace> = {
  smile: 'smirk',
  frown: 'worried',
  flat: 'meh',
  angry: 'grumpy',
}

export const FACE_EMOJI: Record<Face, string> = {
  smile: '😁',
  frown: '☹️',
  flat: '😐',
  angry: '😠',
  smirk: '🙂',
  worried: '😟',
  meh: '😑',
  grumpy: '😤',
}

export interface GateStep {
  /** Face above each doorway lane, left to right, after any swap. */
  faces: Face[]
  /** Lane layout shown before the doorways swap, when this gate shuffles as it approaches. */
  preSwap: Face[] | null
}

/** @deprecated kept as an alias so older imports keep compiling. */
export type DoorStep = GateStep

export interface Blackout {
  /** Gate index the blackout is tied to; it starts as that gate approaches. */
  step: number
  durationMs: number
}

export interface RoundModifiers {
  decoys: boolean
  fakeSign: BaseFace[] | null
  blackouts: Blackout[]
}

export interface RoundLayout {
  /** Constant run speed for this level, meters per second. */
  speed: number
  /** Distance from the round start to the sign. The sign is lit until the runner passes it. */
  signAt: number
  /** Distance from the round start to the first gate. */
  firstGateAt: number
  /** Distance between consecutive gates. */
  gateGap: number
  /** Distance from the last gate to the start of the next round. */
  exitRun: number
  /** Total length of the round segment. */
  length: number
}

/** Cart (coaster) round plan. The client builds the whole track deterministically from `seed`. */
export interface CartPlan {
  seed: number
  /** Real branch at each fork: 0 = left, 1 = right. */
  correct: number[]
  /** Fork indexes hidden behind a fog bank. */
  fog: number[]
  /** Crosswind gust strength, 0..1. */
  wind: number
  /** First cart round: starts with the station, lift hill and the first big drop. */
  intro: boolean
}

export interface RoundDTO {
  roundId: string
  token: string
  level: number
  sequence: BaseFace[]
  displayMs: number
  layout: RoundLayout
  steps: GateStep[]
  modifiers: RoundModifiers
  /** Present for cart levels (level >= CART_START_LEVEL); steps then map 1:1 to forks. */
  cart: CartPlan | null
}

export interface RunStartResponse {
  runId: string
  guest: boolean
  groupLaunch: boolean
  player: { name: string }
  round: RoundDTO
  /** Coaster respawns left in this run. */
  respawns: number
}

export interface RunResult {
  level: number
  levelsCleared: number
  timeMs: number
  bestLevel: number
  postedToGroup: boolean
  ranked: boolean
}

export type FailReason = 'wrong_door' | 'wall' | 'implausible' | 'forfeit' | 'timeout' | 'wrong_track' | 'derailed'

export type AnswerResponse =
  | {
      result: 'correct'
      roundComplete: boolean
      /** Present when roundComplete is true. */
      nextLevel?: number
      /** The upcoming round, delivered on the first gate of each round so the track can be built ahead. */
      next?: RoundDTO
    }
  | { result: 'wrong'; reason: FailReason; final: RunResult }
  | {
      /** Died on the coaster with respawns left: restart the same level from its station checkpoint. */
      result: 'respawn'
      reason: FailReason
      respawnsLeft: number
      round: RoundDTO
    }

export interface GatePassInput {
  runId: string
  roundId: string
  token: string
  step: number
  /** Lane index the runner was in when crossing the gate plane; -1 = hit the wall, -2 = forfeit. */
  lane: number
  /** Client run clock (ms since the run began) at the moment the gate plane was crossed. */
  clientMs: number
}

export interface LeaderboardEntry {
  rank: number
  name: string
  level: number
  timeMs: number
  isMe: boolean
}

export interface LeaderboardResponse {
  scope: 'global' | 'group'
  entries: LeaderboardEntry[]
  me: LeaderboardEntry | null
}

export const HARD_MODE_LEVEL = 5

/** Run-up from the start platform to the first round when a run begins. */
export const START_RUNUP = 14
/** Lateral half width of the steerable deck and gates. */
export const TRACK_HALF = 2.4

export function sequenceLength(level: number) {
  return Math.min(3 + Math.floor((level - 1) * 0.6), 10)
}

export function displayTimeMs(level: number) {
  const perFace = Math.max(420, 950 - (level - 1) * 45)
  return sequenceLength(level) * perFace + 500
}

export function runnerSpeed(level: number) {
  return Math.min(15, 7.5 + (level - 1) * 0.45)
}

/** Seconds between gates at run speed. Starts around 2.3 s and shrinks with level. */
export function gateGapSeconds(level: number) {
  return Math.max(1.45, 2.3 - (level - 1) * 0.07)
}

export function doorCount(level: number) {
  return level >= HARD_MODE_LEVEL ? 3 : 2
}

export function roundLayout(level: number, gateCount: number): RoundLayout {
  const speed = runnerSpeed(level)
  const signAt = (speed * displayTimeMs(level)) / 1000
  const firstGateAt = signAt + speed * 1.9
  const gateGap = speed * gateGapSeconds(level)
  const exitRun = speed * 1.2
  const length = firstGateAt + (gateCount - 1) * gateGap + exitRun
  return { speed, signAt, firstGateAt, gateGap, exitRun, length }
}

// ---------- Cart / coaster levels ----------

export const CART_START_LEVEL = HARD_MODE_LEVEL + 1
/** Path sample spacing for the coaster, meters. Cart layout distances are multiples of it. */
export const CART_STEP = 0.5
/** Distance from a fork back to where the plank starts widening into the split. */
export const CART_PRE_FORK = 9

export const isCartLevel = (level: number) => level >= CART_START_LEVEL

/** Respawns per run once the player is on the coaster (after clearing level 5). */
export const CART_RESPAWNS = 3

/** Highest level offered by the /test page level picker. */
export const TEST_MAX_LEVEL = 20

export function cartSpeed(level: number) {
  return Math.min(19, 10 + (level - CART_START_LEVEL) * 0.8)
}

export function cartForkCount(level: number) {
  return Math.min(9, 3 + Math.floor((level - CART_START_LEVEL) * 0.7))
}

/** Seconds between forks; shrinks with level so the map has to be read faster. */
export function cartForkGapSeconds(level: number) {
  return Math.max(3, 5 - (level - CART_START_LEVEL) * 0.22)
}

const onStep = (v: number) => Math.round(v / CART_STEP) * CART_STEP

export function cartLayout(level: number, forks: number, intro: boolean): RoundLayout {
  const speed = cartSpeed(level)
  // The intro holds the station, the lift hill and the first drop before the first fork.
  const firstGateAt = onStep(intro ? 110 : Math.max(30, speed * 3.4))
  const gateGap = onStep(speed * cartForkGapSeconds(level))
  const exitRun = onStep(Math.max(26, speed * 2))
  const length = firstGateAt + (forks - 1) * gateGap + exitRun
  return { speed, signAt: 0, firstGateAt, gateGap, exitRun, length }
}

export function laneCenter(lane: number, lanes: number) {
  const width = (TRACK_HALF * 2) / lanes
  return -TRACK_HALF + width * (lane + 0.5)
}

/** Width of the open doorway in a lane; the rest of the lane is wall/frame. */
export function doorwayWidth(lanes: number) {
  return (TRACK_HALF * 2) / lanes - (lanes === 3 ? 0.42 : 0.55)
}
