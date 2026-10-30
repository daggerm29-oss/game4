import * as THREE from 'three'
import { CART_PRE_FORK, CART_START_LEVEL, CART_STEP, type RoundDTO } from '@/lib/shared/game'
import { GROUND_Y } from './city'
import type { TrackMaterials } from './track'

/** Half width of the single plank the cart rides on. */
export const PLANK_HALF = 1.75
/** Half width of the widened plank right before a fork. */
export const SPLIT_HALF = 3.3
/** Lateral offset of each branch centerline from the pre-fork centerline. */
export const BRANCH_OFFSET = 1.65
/** Half width of the cart body; the cart derails once it overhangs the plank edge by more than a little. */
export const CART_HALF = 0.45
/** Lateral distance from the bollard at which a fork counts as a crash. */
export const BOLLARD_CLEAR = 0.38

const BRANCH_LEN = 14
const BRANCH_TURN = 0.42
const PRE_STEPS = Math.round(CART_PRE_FORK / CART_STEP)

export interface PathSample {
  x: number
  y: number
  z: number
  yaw: number
  /** Signed curvature, 1/m. Positive = left turn. */
  kappa: number
  /** dy per meter. */
  slope: number
  half: number
}

export interface CoasterFork {
  index: number
  /** Global coaster distance of the fork. */
  s: number
  correct: number
  pre: PathSample
  post: PathSample
  fake: PathSample[]
  fakeLength: number
  fog: boolean
  passed: boolean
}

export interface CoasterRound {
  dto: RoundDTO
  startS: number
  endS: number
  samples: PathSample[]
  forks: CoasterFork[]
  /** Global [from, to] distance ranges covered by fog banks. */
  fog: [number, number][]
  group: THREE.Group
  geometries: THREE.BufferGeometry[]
  entered: boolean
}

interface PathState {
  x: number
  y: number
  z: number
  yaw: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = THREE.MathUtils.lerp

export const forwardOf = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })
export const rightOf = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) })

class PathBuilder {
  samples: PathSample[] = []
  state: PathState

  constructor(start: PathState, half = PLANK_HALF) {
    this.state = { ...start }
    this.samples.push({ ...start, kappa: 0, slope: 0, half })
  }

  get count() {
    return this.samples.length - 1
  }

  /** Appends `steps` samples turning by `turn` radians and changing height by `dy` meters. */
  piece(steps: number, turn: number, dy: number, half: (k: number, n: number) => number = () => PLANK_HALF) {
    const s = this.state
    const kappa = steps > 0 ? turn / (steps * CART_STEP) : 0
    for (let k = 1; k <= steps; k++) {
      const t0 = (k - 1) / steps
      const t1 = k / steps
      s.yaw += turn / steps
      const f = forwardOf(s.yaw)
      s.x += f.x * CART_STEP
      s.z += f.z * CART_STEP
      const deltaY = dy * (smooth(t1) - smooth(t0))
      s.y += deltaY
      this.samples.push({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, kappa, slope: deltaY / CART_STEP, half: half(k, steps) })
    }
  }
}

interface Difficulty {
  maxKappa: number
  plungeChance: number
  straightChance: number
}

function difficulty(level: number): Difficulty {
  const depth = Math.max(0, level - CART_START_LEVEL)
  return {
    maxKappa: Math.min(0.2, 0.075 + depth * 0.018),
    plungeChance: Math.min(0.4, 0.12 + depth * 0.05),
    straightChance: Math.max(0.05, 0.25 - depth * 0.04),
  }
}

/** Twisty filler: a run of curves, climbs and plunges filling exactly `steps` samples. */
function fill(b: PathBuilder, steps: number, rng: () => number, diff: Difficulty) {
  let remaining = steps
  let lastSign = rng() < 0.5 ? -1 : 1
  while (remaining > 0) {
    let n = Math.min(remaining, 16 + Math.floor(rng() * 26))
    if (remaining - n < 10) n = remaining
    const len = n * CART_STEP
    let turn = 0
    if (rng() > diff.straightChance) {
      const sign = rng() < 0.65 ? -lastSign : lastSign
      lastSign = sign
      const kappa = 0.03 + rng() * (diff.maxKappa - 0.03)
      turn = sign * kappa * len
    }
    let dy = (rng() * 0.65 - 0.35) * len
    if (rng() < diff.plungeChance) dy = -len * (0.55 + rng() * 0.35)
    const y = b.state.y
    if (y + dy < -42) dy = Math.abs(dy) * 0.45
    if (y + dy > 26) dy = -Math.abs(dy)
    b.piece(n, turn, dy)
    remaining -= n
  }
}

function splitWidth(k: number, n: number) {
  return lerp(PLANK_HALF, SPLIT_HALF, smooth(Math.min(1, k / Math.min(n, 8))))
}

/** Deterministically lays out one cart round from its seed. */
export function generateRoundPath(dto: RoundDTO, start: PathState, startS: number) {
  const cart = dto.cart!
  const rng = mulberry32(cart.seed)
  const diff = difficulty(dto.level)
  const { firstGateAt, gateGap, length } = dto.layout
  const total = Math.round(length / CART_STEP)
  const forkIdx = cart.correct.map((_, i) => Math.round((firstGateAt + i * gateGap) / CART_STEP))
  const b = new PathBuilder(start)
  const forks: CoasterFork[] = []

  const branchOff = (side: number) => b.piece(Math.round(BRANCH_LEN / CART_STEP), side * BRANCH_TURN, 0)

  cart.correct.forEach((correct, f) => {
    const target = forkIdx[f] - PRE_STEPS
    if (f === 0 && cart.intro) {
      // Station, lift hill, a breath at the crest, then the first big drop.
      b.piece(32, 0, 0)
      b.piece(68, 0.12, 14)
      b.piece(8, 0, 0)
      b.piece(56, -0.25, -34)
    }
    fill(b, Math.max(0, target - b.count), rng, diff)
    b.piece(forkIdx[f] - b.count, 0, 0, splitWidth)

    const pre = b.samples[b.samples.length - 1]
    const r = rightOf(pre.yaw)
    const side = correct === 0 ? -1 : 1
    const post: PathSample = { ...pre, x: pre.x + r.x * side * BRANCH_OFFSET, z: pre.z + r.z * side * BRANCH_OFFSET, half: PLANK_HALF, kappa: 0, slope: 0 }

    // The dead-end branch: diverges the other way, wanders a little into the dark, then just stops.
    const fakeRng = mulberry32((cart.seed ^ Math.imul(f + 1, 0x9e3779b1)) >>> 0)
    const fb = new PathBuilder({ x: pre.x - r.x * side * BRANCH_OFFSET, y: pre.y, z: pre.z - r.z * side * BRANCH_OFFSET, yaw: pre.yaw })
    fb.piece(Math.round(BRANCH_LEN / CART_STEP), -side * BRANCH_TURN, 0)
    fill(fb, 36 + Math.floor(fakeRng() * 36), fakeRng, diff)

    forks.push({
      index: forkIdx[f],
      s: startS + forkIdx[f] * CART_STEP,
      correct,
      pre,
      post,
      fake: fb.samples,
      fakeLength: fb.count * CART_STEP,
      fog: cart.fog.includes(f),
      passed: false,
    })

    b.state = { x: post.x, y: post.y, z: post.z, yaw: post.yaw }
    branchOff(side === -1 ? 1 : -1)
  })
  fill(b, Math.max(0, total - b.count), rng, diff)

  const fog: [number, number][] = forks
    .filter((fork) => fork.fog)
    .map((fork) => [fork.s - Math.max(22, dto.layout.speed * 2.8), fork.s + 8])

  return { samples: b.samples, forks, fog }
}

/** Interpolates along a sample list, treating index `forkIndex` as its post-fork copy when given. */
function interp(samples: PathSample[], d: number, post?: Map<number, PathSample>): PathSample {
  const max = samples.length - 1
  const f = Math.max(0, Math.min(max, d / CART_STEP))
  const i = Math.min(max - 1, Math.floor(f))
  if (i < 0) return samples[0]
  const t = f - i
  const a = post?.get(i) ?? samples[i]
  const bb = samples[i + 1]
  return {
    x: lerp(a.x, bb.x, t),
    y: lerp(a.y, bb.y, t),
    z: lerp(a.z, bb.z, t),
    yaw: lerp(a.yaw, bb.yaw, t),
    kappa: bb.kappa,
    slope: bb.slope,
    half: lerp(a.half, bb.half, t),
  }
}

// ---------- Geometry ----------

type Lateral = (sample: PathSample, i: number) => number

/** Flat double-sided ribbon following the path. */
function ribbon(samples: PathSample[], startS: number, lateral: Lateral, half: (s: PathSample) => number, yOff: number) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  samples.forEach((s, i) => {
    const r = rightOf(s.yaw)
    const c = lateral(s, i)
    const h = half(s)
    const v = (startS + i * CART_STEP) / 2
    for (const side of [-1, 1]) {
      pos.push(s.x + r.x * (c + side * h), s.y + yOff, s.z + r.z * (c + side * h))
      uv.push((side * h) / 2 + 0.5, v)
    }
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Rectangular beam following the path at a lateral offset. */
function beam(samples: PathSample[], startS: number, lateral: Lateral, yOff: number, w: number, h: number) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const corners: [number, number][] = [
    [-w / 2, h / 2],
    [w / 2, h / 2],
    [w / 2, -h / 2],
    [-w / 2, -h / 2],
  ]
  samples.forEach((s, i) => {
    const r = rightOf(s.yaw)
    const c = lateral(s, i)
    const v = (startS + i * CART_STEP) / 1.5
    for (let side = 0; side < 4; side++) {
      for (const k of [side, (side + 1) % 4]) {
        const [cx, cy] = corners[k]
        pos.push(s.x + r.x * (c + cx), s.y + yOff + cy, s.z + r.z * (c + cx))
        uv.push(k === side ? 0 : 1, v)
      }
    }
    if (i > 0) {
      for (let side = 0; side < 4; side++) {
        const a = (i - 1) * 8 + side * 2
        const bb = i * 8 + side * 2
        idx.push(a, bb, a + 1, a + 1, bb, bb + 1)
      }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const UNIT_CYL = new THREE.CylinderGeometry(0.11, 0.2, 1, 6)
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const BEACON_GEO = new THREE.SphereGeometry(0.09, 8, 6)
const BOLLARD_GEO = new THREE.CylinderGeometry(0.22, 0.26, 1.3, 10)

export class Coaster {
  group = new THREE.Group()
  rounds: CoasterRound[] = []
  cart = new THREE.Group()
  headlight = new THREE.SpotLight(0xfff0d6, 70, 80, 0.55, 0.55, 1.1)
  private beaconMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 5 })
  /** Bright edge rails and a centre guide line so the plank reads clearly against the night sky. */
  private railGlowMat = new THREE.MeshStandardMaterial({ color: 0x1a2a10, emissive: 0xffd84d, emissiveIntensity: 2.4 })
  private guideMat = new THREE.MeshStandardMaterial({ color: 0x0a1a20, emissive: 0x7fe8ff, emissiveIntensity: 1.6 })
  private deckMat = new THREE.MeshStandardMaterial({
    color: 0x3a4652,
    emissive: 0x16202a,
    roughness: 0.85,
    metalness: 0.3,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  })
  private cartMat = new THREE.MeshStandardMaterial({ color: 0xe0661c, metalness: 0.45, roughness: 0.55 })
  private nextStart: PathState
  private nextS = 0

  constructor(
    private mats: TrackMaterials,
    start: PathState,
  ) {
    this.nextStart = { ...start }
    this.buildCart()
    this.group.add(this.cart)
  }

  private buildCart() {
    const m = this.mats
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y, z)
      mesh.scale.set(sx, sy, sz)
      this.cart.add(mesh)
      return mesh
    }
    const w = CART_HALF * 2
    add(UNIT_BOX, this.cartMat, 0, 0.32, 0, w, 0.08, 1.6)
    add(UNIT_BOX, this.cartMat, -CART_HALF, 0.62, 0, 0.06, 0.62, 1.6)
    add(UNIT_BOX, this.cartMat, CART_HALF, 0.62, 0, 0.06, 0.62, 1.6)
    add(UNIT_BOX, this.cartMat, 0, 0.66, -0.8, w, 0.7, 0.06)
    add(UNIT_BOX, this.cartMat, 0, 0.62, 0.8, w, 0.62, 0.06)
    add(UNIT_BOX, m.darkSteel, 0, 0.98, -0.72, w * 0.9, 0.05, 0.05)
    add(UNIT_BOX, m.hazard, 0, 0.94, -0.81, w, 0.06, 0.04)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wheel = add(UNIT_CYL, m.darkSteel, sx * (CART_HALF - 0.05), 0.16, sz * 0.55, 1.1, 0.12, 1.1)
        wheel.rotation.z = Math.PI / 2
      }
    }
    const lamp = add(BEACON_GEO, new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xfff0d0, emissiveIntensity: 8 }), 0, 0.85, -0.86, 1.4, 1.4, 1)
    lamp.renderOrder = 1
    this.headlight.position.set(0, 0.95, -0.9)
    this.headlight.target.position.set(0, -0.6, -14)
    this.cart.add(this.headlight, this.headlight.target)
  }

  appendRound(dto: RoundDTO): CoasterRound {
    const startS = this.nextS
    const { samples, forks, fog } = generateRoundPath(dto, this.nextStart, startS)
    const group = new THREE.Group()
    const geometries: THREE.BufferGeometry[] = []
    const round: CoasterRound = {
      dto,
      startS,
      endS: startS + (samples.length - 1) * CART_STEP,
      samples,
      forks,
      fog,
      group,
      geometries,
      entered: false,
    }

    // Main line is split at each fork, since the centerline jumps sideways into the real branch.
    let from = 0
    let first: PathSample | null = null
    const sections: { list: PathSample[]; s0: number }[] = []
    for (const fork of forks) {
      sections.push({ list: [first ?? samples[from], ...samples.slice(from + 1, fork.index + 1)], s0: startS + from * CART_STEP })
      first = fork.post
      from = fork.index
      sections.push({ list: fork.fake, s0: fork.s })
    }
    sections.push({ list: [first ?? samples[from], ...samples.slice(from + 1)], s0: startS + from * CART_STEP })
    for (const section of sections) this.buildSection(section.list, section.s0, round)

    for (const fork of forks) this.buildFork(fork, round)

    const last = samples[samples.length - 1]
    this.nextStart = { x: last.x, y: last.y, z: last.z, yaw: last.yaw }
    this.nextS = round.endS
    this.rounds.push(round)
    this.group.add(group)
    return round
  }

  private buildSection(list: PathSample[], s0: number, round: CoasterRound) {
    if (list.length < 2) return
    const m = this.mats
    const add = (g: THREE.BufferGeometry, mat: THREE.Material) => {
      round.geometries.push(g)
      round.group.add(new THREE.Mesh(g, mat))
    }
    add(ribbon(list, s0, () => 0, (s) => s.half, 0), m.grating)
    add(ribbon(list, s0, () => 0, (s) => s.half, -0.04), this.deckMat)
    add(beam(list, s0, (s) => -s.half, 0.08, 0.1, 0.16), m.hazard)
    add(beam(list, s0, (s) => s.half, 0.08, 0.1, 0.16), m.hazard)
    add(beam(list, s0, (s) => -s.half, 0.2, 0.12, 0.08), this.railGlowMat)
    add(beam(list, s0, (s) => s.half, 0.2, 0.12, 0.08), this.railGlowMat)
    add(beam(list, s0, () => 0, 0.02, 0.07, 0.02), this.guideMat)
    add(beam(list, s0, (s) => -s.half + 0.3, -0.22, 0.14, 0.34), m.darkSteel)
    add(beam(list, s0, (s) => s.half - 0.3, -0.22, 0.14, 0.34), m.darkSteel)

    // Pylons all the way down to the city, cross beams under the grating, and blinking edge beacons.
    const pylons = Math.ceil(list.length / 24)
    const legs = new THREE.InstancedMesh(UNIT_CYL, m.darkSteel, pylons)
    const ribs = new THREE.InstancedMesh(UNIT_BOX, m.steel, Math.ceil(list.length / 4))
    const beacons = new THREE.InstancedMesh(BEACON_GEO, this.beaconMat, Math.ceil(list.length / 30) + 1)
    const mtx = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    let li = 0
    let ri = 0
    let bi = 0
    list.forEach((s, i) => {
      q.setFromAxisAngle(up, s.yaw)
      if (i % 24 === 12) {
        const top = s.y - 0.4
        const height = top - GROUND_Y
        mtx.compose(new THREE.Vector3(s.x, top - height / 2, s.z), q, new THREE.Vector3(1, height, 1))
        legs.setMatrixAt(li++, mtx)
      }
      if (i % 4 === 0) {
        mtx.compose(new THREE.Vector3(s.x, s.y - 0.1, s.z), q, new THREE.Vector3(s.half * 2, 0.08, 0.14))
        ribs.setMatrixAt(ri++, mtx)
      }
      if (i % 30 === 15) {
        const r = rightOf(s.yaw)
        const side = (i / 30) % 2 < 1 ? -1 : 1
        mtx.compose(new THREE.Vector3(s.x + r.x * side * s.half, s.y + 0.26, s.z + r.z * side * s.half), q, new THREE.Vector3(1, 1, 1))
        beacons.setMatrixAt(bi++, mtx)
      }
    })
    legs.count = li
    ribs.count = ri
    beacons.count = bi
    for (const mesh of [legs, ribs, beacons]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      round.group.add(mesh)
    }
  }

  private buildFork(fork: CoasterFork, round: CoasterRound) {
    const p = fork.pre
    const bollard = new THREE.Mesh(BOLLARD_GEO, this.mats.hazard)
    bollard.position.set(p.x, p.y + 0.65, p.z)
    round.group.add(bollard)
    const beacon = new THREE.Mesh(BEACON_GEO, this.beaconMat)
    beacon.scale.setScalar(1.8)
    beacon.position.set(p.x, p.y + 1.4, p.z)
    round.group.add(beacon)
    // A short crossbar at the very end of the dead-end, barely visible in the dark.
    const end = fork.fake[fork.fake.length - 1]
    const stub = new THREE.Mesh(UNIT_BOX, this.mats.darkSteel)
    stub.position.set(end.x, end.y - 0.15, end.z)
    stub.rotation.set(0.5, end.yaw, 0.3)
    stub.scale.set(PLANK_HALF * 1.6, 0.06, 0.2)
    round.group.add(stub)
  }

  roundAt(S: number) {
    for (let i = this.rounds.length - 1; i >= 0; i--) if (this.rounds[i].startS <= S) return this.rounds[i]
    return this.rounds[0] ?? null
  }

  /** Main-line sample at a global distance. Past a fork it follows the real branch. */
  sampleAt(S: number): PathSample | null {
    const round = this.roundAt(S)
    if (!round) return null
    if (S > round.endS) {
      const next = this.rounds[this.rounds.indexOf(round) + 1]
      if (!next) return { ...round.samples[round.samples.length - 1] }
    }
    const post = new Map<number, PathSample>()
    for (const fork of round.forks) post.set(fork.index, fork.post)
    return interp(round.samples, S - round.startS, post)
  }

  fakeSampleAt(fork: CoasterFork, d: number) {
    return interp(fork.fake, d)
  }

  /** Mist amount 0..1 at a global distance. */
  mistAt(S: number) {
    let mist = 0
    for (const round of this.rounds) {
      for (const [a, b] of round.fog) {
        const ramp = 14
        const k = Math.min((S - a) / ramp + 1, (b - S) / 6 + 1)
        mist = Math.max(mist, Math.min(1, Math.max(0, k)))
      }
    }
    return mist
  }

  /** Total main-line length built so far. */
  get builtTo() {
    return this.nextS
  }

  prune(S: number, behind = 80) {
    this.rounds = this.rounds.filter((round) => {
      if (round.endS >= S - behind || round === this.rounds[this.rounds.length - 1]) return true
      round.group.removeFromParent()
      round.geometries.forEach((g) => g.dispose())
      round.group.traverse((obj) => {
        if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose()
      })
      return false
    })
  }

  updateBeacons(time: number, blink: number) {
    this.beaconMat.emissiveIntensity = (Math.sin(time * 6) > 0 ? 5 : 0.6) * blink
  }

  /**
   * Heading-up minimap of the real route ahead. Sharp curves are tinted, forks show a short red stub for the
   * dead end so the player can see where the split is and which side the route takes.
   */
  drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number, view: { S: number; x: number; y: number; z: number; yaw: number }, time: number, noise: number) {
    ctx.clearRect(0, 0, w, h)
    const cx = w / 2
    const cy = h * 0.78
    const scale = (h * 0.72) / 95
    const f = forwardOf(view.yaw)
    const r = rightOf(view.yaw)
    const project = (p: { x: number; z: number }) => {
      const dx = p.x - view.x
      const dz = p.z - view.z
      return [cx + (dx * r.x + dz * r.z) * scale, cy - (dx * f.x + dz * f.z) * scale] as const
    }

    ctx.strokeStyle = 'rgba(255, 216, 77, 0.07)'
    ctx.lineWidth = 1
    for (let gx = 0; gx < w; gx += 16) {
      ctx.beginPath()
      ctx.moveTo(gx + 0.5, 0)
      ctx.lineTo(gx + 0.5, h)
      ctx.stroke()
    }
    for (let gy = 0; gy < h; gy += 16) {
      ctx.beginPath()
      ctx.moveTo(0, gy + 0.5)
      ctx.lineTo(w, gy + 0.5)
      ctx.stroke()
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Dead-end stubs first so the real route draws over them.
    for (const round of this.rounds) {
      for (const fork of round.forks) {
        if (fork.s < view.S - 30 || fork.s > view.S + 140) continue
        ctx.strokeStyle = 'rgba(255, 80, 60, 0.75)'
        ctx.lineWidth = 3
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        for (let d = 0; d <= 12; d += 2) {
          const [px, py] = project(interp(fork.fake, d))
          if (d === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.stroke()
        ctx.setLineDash([])
        const [ex, ey] = project(interp(fork.fake, 12))
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(ex - 4, ey - 4)
        ctx.lineTo(ex + 4, ey + 4)
        ctx.moveTo(ex + 4, ey - 4)
        ctx.lineTo(ex - 4, ey + 4)
        ctx.stroke()
      }
    }

    let prev: readonly [number, number] | null = null
    for (let S = view.S - 25; S <= Math.min(view.S + 130, this.builtTo); S += 1.5) {
      const s = this.sampleAt(S)
      if (!s) continue
      const pt = project(s)
      if (prev) {
        const ahead = S > view.S
        const sharp = Math.min(1, Math.abs(s.kappa) / 0.14)
        const drop = s.slope < -0.45
        ctx.strokeStyle = !ahead ? 'rgba(255, 216, 77, 0.25)' : drop ? '#7fe3ff' : sharp > 0.6 ? '#ff9a3c' : '#ffd84d'
        ctx.lineWidth = ahead ? 4 : 3
        ctx.beginPath()
        ctx.moveTo(prev[0], prev[1])
        ctx.lineTo(pt[0], pt[1])
        ctx.stroke()
      }
      prev = pt
    }

    for (const round of this.rounds) {
      for (const fork of round.forks) {
        if (fork.passed || fork.s < view.S || fork.s > view.S + 130) continue
        const [px, py] = project(fork.pre)
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(px, py, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // The cart.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.fillStyle = '#ff6a1a'
    ctx.strokeStyle = '#1a0d05'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, -8)
    ctx.lineTo(6, 6)
    ctx.lineTo(0, 3)
    ctx.lineTo(-6, 6)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()

    // Scanlines, plus static bursts when the signal drops.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
    for (let y = (time * 30) % 3; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    if (noise > 0) {
      for (let i = 0; i < 260 * noise; i++) {
        const v = Math.floor(Math.random() * 255)
        ctx.fillStyle = `rgba(${v},${v},${v},${0.5 + Math.random() * 0.5})`
        ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 1 + Math.random() * 3)
      }
    }
  }

  dispose() {
    this.prune(Number.POSITIVE_INFINITY, -Number.POSITIVE_INFINITY)
    for (const round of this.rounds) {
      round.group.removeFromParent()
      round.geometries.forEach((g) => g.dispose())
    }
    this.rounds = []
    this.beaconMat.dispose()
    this.cartMat.dispose()
    this.group.removeFromParent()
  }
}
