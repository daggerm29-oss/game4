import 'server-only'
import {
  BASE_FACES,
  type BaseFace,
  type Blackout,
  CART_START_LEVEL,
  type CartPlan,
  DECOY_OF,
  cartForkCount,
  cartLayout,
  isCartLevel,
  type Face,
  type GateStep,
  HARD_MODE_LEVEL,
  type RoundLayout,
  displayTimeMs,
  doorCount,
  roundLayout,
  sequenceLength,
} from '@/lib/shared/game'
import { chance, randInt, shuffle } from './crypto'

export interface GeneratedRound {
  sequence: BaseFace[]
  displayMs: number
  layout: RoundLayout
  steps: GateStep[]
  decoys: boolean
  fakeSign: BaseFace[] | null
  blackouts: Blackout[]
  cart?: CartPlan
}

function pick<T>(items: readonly T[]) {
  return items[randInt(items.length)]
}

function generateSequence(length: number): BaseFace[] {
  const seq: BaseFace[] = []
  for (let i = 0; i < length; i++) {
    let face = pick(BASE_FACES)
    // Avoid three identical faces in a row, which reads as a glitch rather than a challenge.
    while (i >= 2 && seq[i - 1] === face && seq[i - 2] === face) face = pick(BASE_FACES)
    seq.push(face)
  }
  return seq
}

function generateCartRound(level: number, intro: boolean): GeneratedRound {
  const forks = cartForkCount(level)
  const correct = Array.from({ length: forks }, () => randInt(2))
  const depth = level - CART_START_LEVEL
  const fogChance = Math.min(0.75, 0.25 + depth * 0.09)
  const fog: number[] = []
  for (let i = 0; i < forks; i++) {
    // The very first fork of the ride is always in clear air so the player learns the map first.
    if (intro && i === 0) continue
    if (chance(fogChance)) fog.push(i)
  }
  const wind = depth >= 1 ? Math.min(1, 0.25 + depth * 0.12) : 0
  const cart: CartPlan = { seed: randInt(2 ** 31 - 1), correct, fog, wind, intro }
  return {
    sequence: [],
    displayMs: 0,
    layout: cartLayout(level, forks, intro),
    steps: correct.map(() => ({ faces: [], preSwap: null })),
    decoys: false,
    fakeSign: null,
    blackouts: [],
    cart,
  }
}

export function generateRound(level: number, cartIntro = false): GeneratedRound {
  if (isCartLevel(level)) return generateCartRound(level, cartIntro)
  const length = sequenceLength(level)
  const sequence = generateSequence(length)
  const hard = level >= HARD_MODE_LEVEL
  const decoys = hard && chance(0.6)
  const swapChance = hard ? Math.min(0.25 + (level - HARD_MODE_LEVEL) * 0.06, 0.6) : 0
  const count = doorCount(level)

  const steps: GateStep[] = sequence.map((correct) => {
    const others = shuffle(BASE_FACES.filter((f) => f !== correct))
    const wrong: Face[] = others.slice(0, count - 1)
    if (decoys && wrong.length > 0 && chance(0.7)) wrong[0] = DECOY_OF[correct]
    const faces = shuffle<Face>([correct, ...wrong])
    let preSwap: Face[] | null = null
    if (chance(swapChance)) {
      let candidate = shuffle(faces)
      for (let i = 0; i < 4 && candidate.every((f, idx) => f === faces[idx]); i++) candidate = shuffle(faces)
      if (!candidate.every((f, idx) => f === faces[idx])) preSwap = candidate
    }
    return { faces, preSwap }
  })

  const fakeSign = hard && chance(0.35) ? generateSequence(length) : null

  const blackouts: Blackout[] = []
  if (hard && chance(0.45)) {
    const count = 1 + (level >= 8 ? randInt(2) : 0)
    const used = new Set<number>()
    for (let i = 0; i < count && used.size < length; i++) {
      let step = randInt(length)
      while (used.has(step)) step = randInt(length)
      used.add(step)
      blackouts.push({ step, durationMs: 650 + randInt(600) })
    }
  }

  return {
    sequence,
    displayMs: displayTimeMs(level),
    layout: roundLayout(level, steps.length),
    steps,
    decoys,
    fakeSign,
    blackouts,
  }
}
