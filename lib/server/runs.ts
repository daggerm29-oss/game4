import 'server-only'
import {
  type AnswerResponse,
  type BaseFace,
  type CartPlan,
  type FailReason,
  type GatePassInput,
  type GateStep,
  type RoundDTO,
  type RoundLayout,
  type RoundModifiers,
  type RunResult,
  CART_RESPAWNS,
  START_RUNUP,
  isCartLevel,
} from '@/lib/shared/game'
import { HttpError, type Player } from './auth'
import { randomId, safeEqual, sign } from './crypto'
import { bestLevel, recordBest } from './leaderboard'
import { redis } from './redis'
import { generateRound } from './rounds'
import { postResultToGroup } from './telegram-api'

const RUN_TTL_SEC = 60 * 60 * 3
/** Client clock may be at most this much ahead of the deterministic run schedule. */
const CLIENT_SLACK = 0.96
/** Server wall clock tolerance: network jitter and frame hitches compress arrival gaps. */
const SERVER_SLACK = 0.8
const SERVER_GRACE_MS = 1500

interface StoredRound {
  roundId: string
  level: number
  issuedAt: number
  sequence: BaseFace[]
  steps: GateStep[]
  layout: RoundLayout
  displayMs: number
  modifiers: RoundModifiers
  cart: CartPlan | null
  /** Expected run time (ms since run start) at which this round's start line is reached. */
  startMs: number
  stepIndex: number
  lastClientMs: number
}

interface RunState {
  runId: string
  playerId: string
  name: string
  guest: boolean
  chatId: number | null
  level: number
  startedAt: number
  clearedAt: number
  status: 'alive' | 'dead'
  round: StoredRound | null
  next: StoredRound | null
  nextDelivered: boolean
  final: RunResult | null
  /** Coaster respawns left; older stored runs may lack it. */
  respawnsLeft?: number
  /** Started past level 1 from the test page: never ranked or posted. */
  test?: boolean
}

const RESPAWN_REASONS: readonly FailReason[] = ['wrong_track', 'derailed']

const runKey = (runId: string) => `run:${runId}`

async function loadRun(runId: string, player: Player): Promise<RunState> {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(runId)) throw new HttpError(400, 'Bad run id')
  const run = await redis().get<RunState>(runKey(runId))
  if (!run) throw new HttpError(404, 'Run expired, start again')
  if (run.playerId !== player.id) throw new HttpError(403, 'Not your run')
  return run
}

async function saveRun(run: RunState) {
  await redis().set(runKey(run.runId), run, { ex: RUN_TTL_SEC })
}

function roundToken(runId: string, roundId: string, level: number, issuedAt: number) {
  return sign(`round:${runId}:${roundId}:${level}:${issuedAt}`)
}

function createRound(level: number, startMs: number, cartIntro = isCartLevel(level) && !isCartLevel(level - 1)): StoredRound {
  // The first cart level of a run (and every respawn) opens with the boarding station and lift hill.
  const generated = generateRound(level, cartIntro)
  return {
    roundId: randomId(9),
    level,
    issuedAt: Date.now(),
    sequence: generated.sequence,
    steps: generated.steps,
    layout: generated.layout,
    displayMs: generated.displayMs,
    modifiers: { decoys: generated.decoys, fakeSign: generated.fakeSign, blackouts: generated.blackouts },
    cart: generated.cart ?? null,
    startMs,
    stepIndex: 0,
    lastClientMs: startMs,
  }
}

function toDTO(run: RunState, round: StoredRound): RoundDTO {
  return {
    roundId: round.roundId,
    token: roundToken(run.runId, round.roundId, round.level, round.issuedAt),
    level: round.level,
    sequence: round.sequence,
    displayMs: round.displayMs,
    layout: round.layout,
    steps: round.steps,
    modifiers: round.modifiers,
    cart: round.cart ?? null,
  }
}

/** Run-clock time (ms) at which a gate is reached if the runner never slows down. */
function gateDueMs(round: StoredRound, step: number) {
  const { speed, firstGateAt, gateGap } = round.layout
  return round.startMs + ((firstGateAt + step * gateGap) / speed) * 1000
}

export async function startRun(player: Player, chatId: number | null, startLevel = 1) {
  const now = Date.now()
  const run: RunState = {
    runId: randomId(15),
    playerId: player.id,
    name: player.name,
    guest: player.guest,
    chatId: player.guest ? null : chatId,
    level: startLevel,
    startedAt: now,
    clearedAt: now,
    status: 'alive',
    round: null,
    next: null,
    nextDelivered: false,
    final: null,
    respawnsLeft: CART_RESPAWNS,
    test: startLevel > 1,
  }
  if (run.test) run.chatId = null
  const first = createRound(startLevel, 0)
  first.startMs = (START_RUNUP / first.layout.speed) * 1000
  first.lastClientMs = first.startMs
  run.round = first
  await saveRun(run)
  return { run, round: toDTO(run, first) }
}

/** Recovery path: re-sends the active round (e.g. after a dropped response). */
export async function currentRound(player: Player, runId: string): Promise<RoundDTO> {
  const run = await loadRun(runId, player)
  if (run.status !== 'alive' || !run.round) throw new HttpError(409, 'Run is over')
  return toDTO(run, run.round)
}

async function finishRun(run: RunState): Promise<RunResult> {
  run.status = 'dead'
  const timeMs = run.clearedAt - run.startedAt
  let ranked = false
  let best = run.level
  if (!run.guest && !run.test) {
    await recordBest(run.playerId, run.name, run.chatId, run.level, timeMs)
    best = Math.max(await bestLevel(run.playerId), run.level)
    ranked = true
  }
  const postedToGroup = run.chatId !== null ? await postResultToGroup(run.chatId, run.name, run.level, timeMs) : false
  run.final = { level: run.level, levelsCleared: run.level - 1, timeMs, bestLevel: best, postedToGroup, ranked }
  run.round = null
  run.next = null
  return run.final
}

export async function submitGate(player: Player, input: GatePassInput): Promise<AnswerResponse> {
  const run = await loadRun(input.runId, player)
  if (run.status === 'dead') throw new HttpError(409, 'Run is over')
  const round = run.round
  if (!round || round.roundId !== input.roundId) throw new HttpError(409, 'Unknown round')
  const expectedToken = roundToken(run.runId, round.roundId, round.level, round.issuedAt)
  if (!safeEqual(expectedToken, input.token)) throw new HttpError(403, 'Invalid round token')
  if (input.step !== round.stepIndex) throw new HttpError(409, 'Out of order gate')

  const now = Date.now()
  const step = round.steps[round.stepIndex]
  const due = gateDueMs(round, round.stepIndex)

  let reason: FailReason | null = null
  if (input.lane === -2) reason = 'forfeit'
  else if (input.lane === -1) reason = round.cart ? 'derailed' : 'wall'
  else if (
    input.clientMs < due * CLIENT_SLACK ||
    input.clientMs < round.lastClientMs ||
    now - run.startedAt < due * SERVER_SLACK - SERVER_GRACE_MS
  ) {
    reason = 'implausible'
  } else if (round.cart) {
    if (input.lane !== 0 && input.lane !== 1) reason = 'derailed'
    else if (input.lane !== round.cart.correct[round.stepIndex]) reason = 'wrong_track'
  } else if (!Number.isInteger(input.lane) || input.lane < 0 || input.lane >= step.faces.length) reason = 'wall'
  else if (step.faces[input.lane] !== round.sequence[round.stepIndex]) reason = 'wrong_door'

  if (reason) {
    const respawnsLeft = run.respawnsLeft ?? CART_RESPAWNS
    if (round.cart && respawnsLeft > 0 && RESPAWN_REASONS.includes(reason)) {
      // Checkpoint: the same level restarts from its station. The fall freezes the client clock at the death time.
      run.respawnsLeft = respawnsLeft - 1
      const retry = createRound(round.level, Math.max(round.lastClientMs, input.clientMs), true)
      run.round = retry
      run.next = null
      run.nextDelivered = false
      await saveRun(run)
      return { result: 'respawn', reason, respawnsLeft: run.respawnsLeft, round: toDTO(run, retry) }
    }
    const final = await finishRun(run)
    await saveRun(run)
    return { result: 'wrong', reason, final }
  }

  round.stepIndex += 1
  round.lastClientMs = input.clientMs

  // Pre-generate the following round on the first gate, so the endless track can be built well ahead.
  let next: RoundDTO | undefined
  if (!run.next) {
    run.next = createRound(round.level + 1, round.startMs + (round.layout.length / round.layout.speed) * 1000)
    run.nextDelivered = false
  }
  if (!run.nextDelivered) {
    next = toDTO(run, run.next)
    run.nextDelivered = true
  }

  if (round.stepIndex < round.steps.length) {
    await saveRun(run)
    return { result: 'correct', roundComplete: false, next }
  }

  run.level = round.level + 1
  run.clearedAt = now
  const upcoming = run.next
  // The next round's start line comes after this round's exit run; anchor it to the actual pass time.
  upcoming.startMs = Math.max(upcoming.startMs, input.clientMs + (round.layout.exitRun / round.layout.speed) * 1000)
  upcoming.lastClientMs = upcoming.startMs
  run.round = upcoming
  run.next = null
  run.nextDelivered = false
  if (!run.guest && !run.test) await recordBest(run.playerId, run.name, run.chatId, run.level, run.clearedAt - run.startedAt)
  await saveRun(run)
  return { result: 'correct', roundComplete: true, nextLevel: run.level, next }
}
