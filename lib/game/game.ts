import * as THREE from 'three'
import {
  type AnswerResponse,
  CART_RESPAWNS,
  type FailReason,
  type RoundDTO,
  START_RUNUP,
  TRACK_HALF,
  doorwayWidth,
  laneCenter,
  roundLayout,
} from '@/lib/shared/game'
import { ApiError, api } from './api'
import { AudioEngine } from './audio'
import { Input } from './input'
import { ResolutionScaler, TIERS, downgrade, guessTier } from './quality'
import {
  BOLLARD_CLEAR,
  BRANCH_OFFSET,
  CART_HALF,
  type CoasterFork,
  type CoasterRound,
  type PathSample,
  forwardOf,
  rightOf,
} from './render/coaster'
import { type TrackGate, type TrackRound, sToZ } from './render/track'
import { World } from './render/world'
import {
  type GameStore,
  type Phase,
  type QualitySetting,
  RUNNER_PHASES,
  RUNNING_PHASES,
  type Tier,
  createStore,
  initialUIState,
} from './store'
import { telegram } from './telegram'

const QUALITY_KEY = 'skywalk-quality'
const RUNNER_RADIUS = 0.2
const STEER_LIMIT = TRACK_HALF - 0.3
const START_S = -4

const DEMO_ROUND: TrackRound['dto'] = {
  level: 1,
  sequence: ['smile', 'angry', 'frown'],
  displayMs: 3000,
  layout: roundLayout(1, 3),
  steps: [
    { faces: ['smile', 'frown'], preSwap: null },
    { faces: ['flat', 'angry'], preSwap: null },
    { faces: ['frown', 'smile'], preSwap: null },
  ],
  modifiers: { decoys: false, fakeSign: null, blackouts: [] },
}

interface CartState {
  S: number
  x: number
  targetX: number
  speed: number
  /** Dead-end branch the cart took, if any. */
  fake: CoasterFork | null
  fakeD: number
  gust: number
  gustLeft: number
  nextGust: number
  creakCooldown: number
  sample: PathSample
  pos: THREE.Vector3
  bank: number
}

interface CartFallState {
  kind: 'derail' | 'deadend' | 'bollard'
  t: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  rot: THREE.Euler
  spin: THREE.Vector3
  hapticStep: number
}

interface FallState {
  kind: 'trap' | 'wall'
  t: number
  vx: number
  vy: number
  forward: number
  grounded: boolean
  spin: number
  hapticStep: number
  anchorS: number
  laneX: number
}

class BootCancelled extends Error {}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (t: number) => t * t * (3 - 2 * t)
const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt))

export class Game {
  store: GameStore = createStore({ ...initialUIState })
  private world!: World
  private audio = new AudioEngine()
  private input = new Input()
  private scaler!: ResolutionScaler

  private phase: Phase = 'LOADING'
  private raf = 0
  private last = 0
  private time = 0
  private destroyed = false

  private runId: string | null = null
  private runEpoch = 0
  private serverChain: Promise<void> = Promise.resolve()
  private runClockMs = 0
  private activeRound: TrackRound | null = null
  private entered = new Set<TrackRound>()
  private signTimer = 0
  private blackoutLeft = 0
  private bannerLeft = 0
  private pruneTimer = 0

  private player = { s: START_S, x: 0, targetX: 0, vx: 0, y: 0, speed: 0, stepPhase: 0 }
  private camState = { pos: new THREE.Vector3(4.5, 2.4, 4), look: new THREE.Vector3(0, 1.4, -12), fov: 66, roll: 0 }
  private fall: FallState | null = null
  private stress = 0
  private fade = 1
  private fadeTarget = 0
  private uiAccum = 0
  private bench: { frames: number; target: number; time: number; resolve: (ms: number) => void } | null = null
  private qualitySetting: QualitySetting = 'auto'
  private finalResult: { result: AnswerResponse & { result: 'wrong' } } | null = null

  private pendingCart: RoundDTO[] = []
  private stationS: number | null = null
  private cart: CartState | null = null
  private cartFall: CartFallState | null = null
  private boardT = 0
  private minimap: HTMLCanvasElement | null = null
  private mapAccum = 0
  private mapNoise = 0
  private nextStatic = 6
  private trackPruned = false
  /** Checkpoint round delivered by the server after a coaster death; used once the fall fades out. */
  private pendingRespawn: { round: RoundDTO; left: number } | null = null

  async boot(container: HTMLElement) {
    const inTelegram = telegram.init()
    this.store.set({ inTelegram, groupLaunch: Boolean(telegram.startParam) })
    try {
      this.qualitySetting = (localStorage.getItem(QUALITY_KEY) as QualitySetting | null) ?? 'auto'
    } catch {
      this.qualitySetting = 'auto'
    }

    const progress = async (fraction: number, label: string) => {
      this.store.set({ loadingProgress: fraction, loadingLabel: label })
      // Yield so the loading screen can paint between heavy steps.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      if (this.destroyed) throw new BootCancelled()
    }

    try {
      await this.bootSteps(container, progress)
    } catch (error) {
      if (error instanceof BootCancelled) return
      console.error('[skywalk] boot failed', error)
      this.store.set({ error: error instanceof Error ? error.message : 'Failed to start the game' })
    }
  }

  private async bootSteps(container: HTMLElement, progress: (fraction: number, label: string) => Promise<void>) {
    await progress(0.05, 'Checking your device')
    const probe = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')
    if (!probe) {
      this.store.set({ error: 'WebGL is not available on this device.' })
      return
    }
    let tier: Tier = this.qualitySetting === 'auto' ? guessTier(probe) : this.qualitySetting
    probe.getExtension('WEBGL_lose_context')?.loseContext()

    this.world = new World(container, tier)
    this.scaler = new ResolutionScaler(TIERS[tier])
    this.world.onLightning = (distance) => {
      this.audio.thunder(distance)
      if (distance < 0.3 && this.phase !== 'MENU') telegram.impact('soft')
    }
    await this.world.init(progress)
    this.buildDemo()

    this.input.attach(container)
    this.input.onAnyGesture = () => this.audio.unlock()

    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)

    if (this.qualitySetting === 'auto') {
      await progress(0.85, 'Benchmarking')
      for (let attempt = 0; attempt < 2 && tier !== 'low'; attempt++) {
        const ms = await this.measure(40)
        const budget = 1000 / (TIERS[tier].targetFps * 0.8)
        if (ms <= budget) break
        tier = downgrade(tier)
        this.world.applyTier(tier)
        this.scaler.setConfig(TIERS[tier])
      }
    }
    this.store.set({ tier, qualitySetting: this.qualitySetting })
    await progress(1, 'Ready')
    this.setPhase('MENU')
  }

  /** Average frame time in ms over `frames` frames, skipping a short warm-up. */
  private measure(frames: number) {
    return new Promise<number>((resolve) => {
      this.bench = { frames: -5, target: frames, time: 0, resolve }
    })
  }

  setQuality(setting: QualitySetting) {
    this.qualitySetting = setting
    try {
      localStorage.setItem(QUALITY_KEY, setting)
    } catch {}
    const tier = setting === 'auto' ? guessTier(this.world.gl) : setting
    this.world.applyTier(tier)
    this.scaler.setConfig(TIERS[tier])
    this.store.set({ qualitySetting: setting, tier })
  }

  setMuted(muted: boolean) {
    this.audio.setMuted(muted)
  }

  private resetCart() {
    this.world.resetCoaster(null)
    this.pendingCart = []
    this.stationS = null
    this.cart = null
    this.cartFall = null
    this.trackPruned = false
    this.mapNoise = 0
    this.store.set({ cart: false, mist: 0, edge: 0 })
  }

  /** Idle scene for the menu: a lit sign and a gate ahead of the waiting runner. */
  private buildDemo() {
    this.resetCart()
    const track = this.world.resetTrack()
    const round = track.appendRound(DEMO_ROUND, START_RUNUP)
    round.sign.target = 0.55
    this.world.activeRound = round
    this.activeRound = null
    this.entered.clear()
    this.player = { s: START_S, x: 0, targetX: 0, vx: 0, y: 0, speed: 0, stepPhase: 0 }
    this.world.runner.reset(0, sToZ(START_S))
    this.world.runner.setVisible(true)
  }

  // ---------- Run flow ----------

  /** `startLevel` (test page) or `?level=N` / `?cart=1` start past level 1; the server only honors it outside production. */
  async startRun(startLevel?: number) {
    if (this.store.get().busy) return
    this.audio.unlock()
    this.store.set({ busy: true, error: null, result: null, overlay: 'none' })
    try {
      const params = new URLSearchParams(window.location.search)
      const devLevel = startLevel ?? (params.has('cart') ? 6 : Number(params.get('level')) || undefined)
      const run = await api.startRun(devLevel)
      if (this.destroyed) return
      this.runEpoch += 1
      this.runId = run.runId
      this.serverChain = Promise.resolve()
      this.finalResult = null
      this.pendingRespawn = null
      this.fall = null
      this.runClockMs = 0
      this.store.set({
        guest: run.guest,
        groupLaunch: run.groupLaunch,
        playerName: run.player.name,
        level: run.round.level,
        respawns: run.respawns ?? CART_RESPAWNS,
      })
      telegram.setClosingConfirmation(true)

      const track = this.world.resetTrack()
      this.resetCart()
      if (run.round.cart) this.pendingCart.push(run.round)
      else track.appendRound(run.round, START_RUNUP)
      this.entered.clear()
      this.activeRound = null
      this.world.activeRound = null
      this.player = { s: START_S, x: 0, targetX: 0, vx: 0, y: 0, speed: 0, stepPhase: 0 }
      this.world.runner.reset(0, sToZ(START_S))
      this.world.runner.setVisible(true)
      this.input.flush()
      this.input.steeredDistance = 0
      this.clearBlackout()
      this.fadeTarget = 0
      this.showBanner(`Level ${run.round.level}`)
      this.setPhase('LEVEL_COMPLETE')
    } catch (error) {
      this.showError(error)
    } finally {
      this.store.set({ busy: false })
    }
  }

  quitToMenu() {
    if (this.runId && RUNNING_PHASES.includes(this.phase)) {
      const cartRound = this.cart ? this.world.coaster?.roundAt(this.cart.S) : null
      if (cartRound) {
        this.sendGate(cartRound.dto, Math.max(0, cartRound.forks.findIndex((f) => !f.passed)), -2)
      } else {
        const round = this.activeRound ?? this.world.track?.rounds[0]
        if (round?.dto.roundId) this.sendGate(round.dto, round.gates.find((g) => !g.passed)?.index ?? 0, -2)
      }
    }
    this.runId = null
    this.runEpoch += 1
    this.fall = null
    this.pendingRespawn = null
    this.clearBlackout()
    telegram.setClosingConfirmation(false)
    this.audio.setMuffled(false)
    this.audio.setHeartRate(0)
    this.buildDemo()
    this.store.set({ result: null, overlay: 'none', banner: '' })
    this.setPhase('MENU')
  }

  private showError(error: unknown) {
    const message = error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong'
    this.store.set({ error: message })
    this.quitToMenu()
  }

  private showBanner(text: string) {
    this.bannerLeft = 1.6
    this.store.set({ banner: text })
  }

  private setPhase(phase: Phase) {
    this.phase = phase
    switch (phase) {
      case 'MENU':
        this.fadeTarget = 0
        this.stress = 0
        this.audio.setHeartRate(0)
        this.audio.setWind(0.35)
        this.store.set({ hint: '', blackout: false, banner: '' })
        break
      case 'SIGN_PHASE':
        this.store.set({ hint: this.store.get().level === 1 && this.input.steeredDistance < 2 ? 'Swipe to steer' : '' })
        break
      case 'GATE_PHASE':
      case 'LEVEL_COMPLETE':
        break
      case 'FALL':
        this.audio.fall()
        telegram.impact('heavy')
        this.store.set({ hint: '', banner: '' })
        break
      case 'RESULT': {
        this.audio.impact()
        telegram.notify('error')
        telegram.setClosingConfirmation(false)
        this.clearBlackout()
        const verdict = this.finalResult?.result
        if (verdict) this.store.set({ result: { ...verdict.final, reason: verdict.reason } })
        this.runId = null
        this.buildDemo()
        this.fadeTarget = 0.35
        break
      }
    }
    this.store.set({ phase })
  }

  private enterRound(round: TrackRound) {
    this.entered.add(round)
    this.activeRound = round
    this.world.activeRound = round
    const { dto } = round
    round.sign.target = 1
    round.sign.flicker = 0
    if (round.fakeSign) {
      round.fakeSign.target = 1
      round.fakeSign.flicker = 1
    }
    this.signTimer = dto.displayMs / 1000
    this.audio.signOn()
    this.audio.setMuffled(true)
    this.audio.setWind(Math.min(1, 0.3 + dto.level * 0.06))
    telegram.impact('heavy')
    if (dto.level !== this.store.get().level) this.showBanner(`Level ${dto.level}`)
    this.store.set({ level: dto.level, stepIndex: 0, stepCount: dto.steps.length })
    this.setPhase('SIGN_PHASE')
  }

  private hideSign(round: TrackRound) {
    round.sign.target = 0
    round.sign.flicker = 0.6
    if (round.fakeSign) round.fakeSign.target = 0
    this.audio.signOff()
    this.audio.setMuffled(false)
    telegram.impact('light')
  }

  private clearBlackout() {
    this.blackoutLeft = 0
    if (this.world) this.world.blackout = false
    this.store.set({ blackout: false })
  }

  // ---------- Server verification ----------

  /** Gate passes are sent strictly in order; the server verifies lane and timing. */
  private sendGate(dto: { roundId?: string; token?: string }, step: number, lane: number) {
    const { roundId, token } = dto
    const runId = this.runId
    if (!runId || !roundId || !token) return
    const epoch = this.runEpoch
    const clientMs = Math.round(this.runClockMs)
    this.serverChain = this.serverChain
      .then(async () => {
        const verdict = await api.gate({ runId, roundId, token, step, lane, clientMs })
        if (epoch !== this.runEpoch) return
        this.handleVerdict(verdict)
      })
      .catch((error) => {
        if (epoch !== this.runEpoch) return
        console.error('[skywalk] gate verification failed', error)
        this.showError(error)
      })
  }

  private handleVerdict(verdict: AnswerResponse) {
    const track = this.world.track
    if (verdict.result === 'correct') {
      if (verdict.next?.cart) {
        if (this.world.coaster && this.cart) this.world.coaster.appendRound(verdict.next)
        else this.pendingCart.push(verdict.next)
      } else if (verdict.next && track) track.appendRound(verdict.next, this.player.s + 25)
      return
    }
    if (verdict.result === 'respawn') {
      this.pendingRespawn = { round: verdict.round, left: verdict.respawnsLeft }
      if (this.cart && this.phase !== 'FALL' && this.phase !== 'RESULT' && !this.cart.fake) this.startCartFall('derail')
      return
    }
    this.finalResult = { result: verdict }
    if (this.cart) {
      // On a dead-end branch the cart keeps rolling until the rails run out.
      if (this.phase !== 'FALL' && this.phase !== 'RESULT' && !this.cart.fake) this.startCartFall('derail')
      return
    }
    // The server disagreed with a pass the client accepted (e.g. implausible timing): fall anyway.
    if (this.phase !== 'FALL' && this.phase !== 'RESULT') this.startFall(verdict.reason === 'wrong_door' ? 'trap' : 'wall')
  }

  // ---------- Frame loop ----------

  private frame = (now: number) => {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000))
    this.last = now
    this.time += dt

    if (this.bench) {
      this.bench.frames += 1
      if (this.bench.frames > 0) this.bench.time += dt
      if (this.bench.frames >= this.bench.target) {
        const ms = (this.bench.time / this.bench.frames) * 1000
        const { resolve } = this.bench
        this.bench = null
        resolve(ms)
      }
    }

    if (RUNNER_PHASES.includes(this.phase)) this.updateRunning(dt)
    else if (this.phase === 'BOARDING' || this.phase === 'CART') this.updateCart(dt)
    else if (this.phase === 'FALL') {
      if (this.cartFall) this.updateCartFall(dt)
      else this.updateFall(dt)
    }
    else {
      this.stress = damp(this.stress, 0, 2, dt)
      this.input.flush()
    }

    this.updateGates(dt)
    this.updateTimers(dt)
    this.updateRunner(dt)
    this.updateCamera(dt)
    this.fade = damp(this.fade, this.fadeTarget, this.fadeTarget > this.fade ? 7 : 3, dt)

    if (this.cart) this.world.update(dt, this.time, this.cart.pos.z, this.cart.pos.x)
    else this.world.update(dt, this.time, sToZ(this.player.s))
    this.drawMinimap(dt)
    this.world.render(this.time, this.stress, this.fade)

    const ratio = this.scaler.sample(dt)
    if (ratio !== null) this.world.setPixelRatio(ratio)
    if (
      this.qualitySetting === 'auto' &&
      this.scaler.slowStreak >= 4 &&
      this.world.tier !== 'low' &&
      (this.phase === 'MENU' || this.phase === 'RESULT' || this.phase === 'LEVEL_COMPLETE')
    ) {
      const tier = downgrade(this.world.tier)
      this.world.applyTier(tier)
      this.scaler.setConfig(TIERS[tier])
      this.store.set({ tier })
    }

    this.uiAccum += dt
    if (this.uiAccum > 0.08) {
      this.uiAccum = 0
      this.store.set({ stress: Math.round(this.stress * 20) / 20, fps: Math.round(this.scaler.fps), mist: Math.round(this.world.mist * 20) / 20 })
    }
  }

  private updateTimers(dt: number) {
    if (this.bannerLeft > 0) {
      this.bannerLeft -= dt
      if (this.bannerLeft <= 0) this.store.set({ banner: '' })
    }
    if (this.blackoutLeft > 0) {
      this.blackoutLeft -= dt
      if (this.blackoutLeft <= 0) this.clearBlackout()
    }
  }

  private nextGate(): TrackGate | null {
    return this.activeRound?.gates.find((g) => !g.passed) ?? null
  }

  private laneOf(x: number, lanes: number) {
    const width = (TRACK_HALF * 2) / lanes
    return Math.min(lanes - 1, Math.max(0, Math.floor((x + TRACK_HALF) / width)))
  }

  private updateRunning(dt: number) {
    const track = this.world.track
    if (!track) return
    const p = this.player

    // Constant per-level speed; the first round's speed applies to the run-up too.
    const upcoming = track.rounds.find((r) => !this.entered.has(r))
    const targetSpeed = (this.activeRound ?? upcoming)?.dto.layout.speed ?? 7.5
    p.speed = damp(p.speed, targetSpeed, p.speed < 2 ? 2.4 : 1.2, dt)
    p.s += p.speed * dt
    this.runClockMs += dt * 1000

    const prevX = p.x
    p.targetX = THREE.MathUtils.clamp(p.targetX + this.input.consumeSteer(dt), -STEER_LIMIT, STEER_LIMIT)
    p.x = damp(p.x, p.targetX, 9, dt)
    p.vx = (p.x - prevX) / dt
    if (this.store.get().hint && this.input.steeredDistance > 2.5) this.store.set({ hint: '' })

    if (upcoming && p.s >= upcoming.startS) {
      if (this.activeRound && this.activeRound.sign.target > 0) this.hideSign(this.activeRound)
      this.enterRound(upcoming)
    }

    const round = this.activeRound
    if (this.phase === 'SIGN_PHASE' && round) {
      this.signTimer -= dt
      if (this.signTimer <= 0 || p.s > round.startS + round.dto.layout.signAt + 1) {
        this.hideSign(round)
        this.setPhase('GATE_PHASE')
      }
    }

    const gate = this.nextGate()
    if (gate && round) {
      const dist = gate.s - p.s
      const gap = round.dto.layout.gateGap
      const near = 1 - clamp01(dist / gap)
      this.stress = damp(this.stress, 0.2 + near * 0.6, 3, dt)
      this.audio.setHeartRate(75 + near * 85)

      if (gate.swapT < 1 && !gate.swapping && this.phase === 'GATE_PHASE' && dist < Math.max(16, p.speed * 1.6)) {
        gate.swapping = true
        this.audio.creak(1)
        telegram.impact('rigid')
      }
      const blackout = round.dto.modifiers.blackouts.find((b) => b.step === gate.index)
      if (blackout && !gate.blackoutDone && dist < p.speed * 1.1) {
        gate.blackoutDone = true
        this.blackoutLeft = blackout.durationMs / 1000
        this.world.blackout = true
        this.world.strikeSoon(0.15)
        this.audio.signOff()
        this.store.set({ blackout: true })
        telegram.impact('medium')
      }
      if (p.s >= gate.s) this.resolveGate(round, gate)
    } else {
      this.stress = damp(this.stress, 0.15, 2, dt)
      this.audio.setHeartRate(72)
    }

    this.checkStation()
    track.ensureAhead(p.s)
    this.pruneTimer -= dt
    if (this.pruneTimer <= 0) {
      this.pruneTimer = 1
      track.prune(p.s)
    }
  }

  private resolveGate(round: TrackRound, gate: TrackGate) {
    const p = this.player
    gate.passed = true
    gate.swapT = 1
    gate.swapping = false
    const lane = this.laneOf(p.x, gate.lanes)
    const center = laneCenter(lane, gate.lanes)
    const inDoorway = Math.abs(p.x - center) <= doorwayWidth(gate.lanes) / 2 - RUNNER_RADIUS
    const correct = inDoorway && gate.faces[lane] === round.dto.sequence[gate.index]

    if (!inDoorway) {
      gate.passedLane = -1
      this.sendGate(round.dto, gate.index, -1)
      this.audio.wrong()
      telegram.notify('error')
      this.startFall('wall')
      return
    }

    gate.passedLane = lane
    this.sendGate(round.dto, gate.index, lane)
    if (!correct) {
      gate.traps[lane].t = 0.001
      this.audio.wrong()
      telegram.notify('error')
      this.startFall('trap')
      return
    }

    gate.doors[lane].openT = Math.max(gate.doors[lane].openT, 0.6)
    this.world.pulseDoor(center, sToZ(gate.s))
    this.audio.doorOpen()
    this.audio.correct()
    telegram.impact('light')
    const passed = gate.index + 1
    this.store.set({ stepIndex: passed })
    if (passed >= round.gates.length) {
      telegram.notify('success')
      this.showBanner(`Level ${round.dto.level} clear`)
      this.setPhase('LEVEL_COMPLETE')
    }
  }

  private startFall(kind: FallState['kind']) {
    const p = this.player
    const side = p.x === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(p.x)
    this.fall = {
      kind,
      t: 0,
      vx: kind === 'wall' ? side * 3.4 : p.vx * 0.2,
      vy: kind === 'wall' ? 0 : -0.5,
      forward: kind === 'wall' ? -2.5 : p.speed * 0.55,
      grounded: kind === 'wall',
      spin: (Math.random() - 0.5) * 1.6,
      hapticStep: 0,
      anchorS: p.s,
      laneX: p.x,
    }
    if (kind === 'wall') {
      this.stress = 1
      this.camState.roll += side * 0.08
    }
    this.clearBlackout()
    this.setPhase('FALL')
  }

  private updateFall(dt: number) {
    const f = this.fall
    const track = this.world.track
    if (!f || !track) return
    const p = this.player
    f.t += dt
    this.stress = 1
    p.speed = 0
    p.s += f.forward * dt
    f.forward = damp(f.forward, 0, 2.5, dt)
    if (f.grounded) {
      p.x += f.vx * dt
      f.vx *= 1 + dt * 1.2
      if (Math.abs(p.x) > track.halfWidthAt(p.s) + 0.15) f.grounded = false
    } else {
      f.vy = Math.max(-58, f.vy - 9.81 * 1.25 * dt)
      p.y += f.vy * dt
      p.x += f.vx * dt
    }
    const pulses = [0, 0.5, 1.0, 1.5]
    if (f.hapticStep < pulses.length && f.t >= pulses[f.hapticStep]) {
      telegram.impact(f.hapticStep === 0 ? 'heavy' : 'rigid')
      f.hapticStep += 1
    }
    if (f.t > 2.4) this.fadeTarget = 1
    if (f.t > 3.0 && this.fade > 0.9) {
      if (this.finalResult) {
        this.fall = null
        this.audio.resetAfterFall()
        this.setPhase('RESULT')
      } else if (f.t > 10) {
        this.showError(new Error('Lost connection to the tower. Try again.'))
      }
    }
  }

  /** Door panels, trap floors and lane swaps on every live gate. */
  private updateGates(dt: number) {
    const track = this.world.track
    if (!track) return
    const p = this.player
    const running = RUNNER_PHASES.includes(this.phase)
    for (const round of track.rounds) {
      for (const gate of round.gates) {
        if (gate.swapping) {
          gate.swapT = Math.min(1, gate.swapT + dt / 0.55)
          if (gate.swapT >= 1) gate.swapping = false
        }
        const k = smooth(clamp01(gate.swapT))
        for (const icon of gate.icons) icon.mesh.position.x = THREE.MathUtils.lerp(icon.fromX, icon.x, k)

        const dist = gate.s - p.s
        const lane = this.laneOf(p.x, gate.lanes)
        gate.doors.forEach((door, i) => {
          const open = gate.passed ? i === gate.passedLane : running && i === lane && dist < 7 && dist > -1
          door.openT = damp(door.openT, open ? 1 : 0, open ? 7 : 4, dt)
          door.pivot.rotation.y = smooth(clamp01(door.openT)) * 1.5
        })
        for (const trap of gate.traps) {
          if (trap.t > 0 && trap.t < 1) trap.t = Math.min(1, trap.t + dt / 0.22)
          trap.pivot.rotation.x = -smooth(trap.t) * 1.7
        }
      }
    }
  }

  private updateRunner(dt: number) {
    const p = this.player
    const track = this.world.track
    const airborne = this.phase === 'FALL' && !!this.fall && !this.fall.grounded
    if (p.speed > 1 && RUNNER_PHASES.includes(this.phase)) {
      const before = Math.sign(Math.sin(p.stepPhase))
      p.stepPhase += dt * (3.2 + p.speed * 1.05)
      if (Math.sign(Math.sin(p.stepPhase)) !== before) this.audio.footstep()
    }
    const floorAt = (x: number, z: number) => !!track && Math.abs(x) <= track.halfWidthAt(-z) + 0.05
    const visualSpeed = RUNNER_PHASES.includes(this.phase) || this.phase === 'BOARDING' ? p.speed : 0
    this.world.runner.update(dt, p.x, p.y, sToZ(p.s), visualSpeed, p.vx, airborne, floorAt)
  }

  private updateCamera(dt: number) {
    if (this.cart && (this.phase === 'CART' || this.phase === 'BOARDING' || this.cartFall)) {
      this.updateCartCamera(dt)
      return
    }
    const cam = this.world.camera
    const p = this.player
    const c = this.camState
    const level = this.store.get().level
    const wind = Math.min(1, 0.3 + level * 0.06)
    const z = sToZ(p.s)
    const pos = new THREE.Vector3()
    const look = new THREE.Vector3()
    let fov = 66 - this.stress * 9
    let posRate = 6
    let roll = 0

    if (this.phase === 'MENU' || this.phase === 'RESULT' || this.phase === 'LOADING') {
      const sway = Math.sin(this.time * 0.09)
      pos.set(3.4 + sway * 1.2, 2.3 + Math.sin(this.time * 0.13) * 0.2, z + 4.2)
      look.set(-1.2 + sway * 0.8, 1.6, z - 18)
      fov = 64
      posRate = 2
    } else if (this.phase === 'FALL' && this.fall) {
      const f = this.fall
      const k = smooth(clamp01(f.t / 1.2))
      if (f.kind === 'trap') {
        // Stop in the open doorway and look down the hole as the runner drops into the city.
        pos.set(f.laneX, 2.6 - k * 0.4, sToZ(f.anchorS) + 1.4 - k * 0.9)
        look.set(p.x, p.y + 0.6, z - 0.6)
      } else {
        // Knocked back off the wall: hold above the edge and watch them go over.
        pos.set(p.x * 0.5, 3.1, sToZ(f.anchorS) + 4.8)
        look.set(p.x, p.y + 0.8, z)
      }
      c.roll += f.spin * dt * 0.25
      roll = c.roll
      fov = THREE.MathUtils.lerp(66, 92, k)
      posRate = 4
    } else {
      // Kept under the door lintel and inside the runner's doorway so it never clips through a gate wall.
      pos.set(p.x * 0.85, 2.75, z + 6.2)
      look.set(p.x * 0.9, 1.3, z - 9)
      const signLevel = this.activeRound?.sign.intensity ?? 0
      if (this.phase === 'SIGN_PHASE') {
        // Glance toward the sign on the left while it is lit.
        look.x -= 2.2 * signLevel
        look.y += 0.9 * signLevel
      }
      roll = THREE.MathUtils.clamp(-p.vx * 0.012, -0.08, 0.08)
      posRate = 10
    }

    // Wind sway, stronger at higher levels.
    const t = this.time
    const sway = (Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.9 + 1.2) * 0.3 + Math.sin(t * 4.3) * 0.1) * wind
    roll += sway * 0.012
    pos.x += Math.sin(t * 0.53) * 0.03 * wind

    if (RUNNER_PHASES.includes(this.phase) && this.world.track) {
      const margin = this.world.track.halfWidthAt(p.s) - Math.abs(p.x)
      const edge = clamp01((0.9 - margin) / 0.9)
      const shake = edge * 0.02 + this.stress * 0.006
      pos.x += (Math.random() - 0.5) * shake
      pos.y += (Math.random() - 0.5) * shake
      roll += (Math.random() - 0.5) * shake * 0.5
    }
    if (this.phase === 'FALL') {
      pos.x += (Math.random() - 0.5) * 0.06
      pos.y += (Math.random() - 0.5) * 0.06
    } else {
      c.roll = 0
    }

    // Snap rather than drift on large jumps (run start, return to menu).
    if (c.pos.distanceTo(pos) > 25) c.pos.copy(pos)
    if (c.look.distanceTo(look) > 25) c.look.copy(look)
    const kp = 1 - Math.exp(-posRate * dt)
    c.pos.lerp(pos, kp)
    c.look.lerp(look, 1 - Math.exp(-posRate * 1.2 * dt))
    c.fov = damp(c.fov, fov, 4, dt)
    cam.position.copy(c.pos)
    cam.lookAt(c.look)
    cam.rotateZ(roll)
    if (Math.abs(cam.fov - c.fov) > 0.01) {
      cam.fov = c.fov
      cam.updateProjectionMatrix()
    }
  }

  // ---------- Cart ride (levels 6+) ----------

  attachMinimap(canvas: HTMLCanvasElement | null) {
    this.minimap = canvas
  }

  /** Builds the coaster station once the last on-foot level is cleared and the cart round is known. */
  private checkStation() {
    if (this.phase !== 'LEVEL_COMPLETE') return
    const p = this.player
    if (this.stationS === null) {
      if (!this.pendingCart.length) return
      const round = this.activeRound
      if (round && round.gates.some((g) => !g.passed)) return
      this.stationS = Math.max(p.s + 16, round ? round.endS : 0)
      const coaster = this.world.resetCoaster({ x: 0, y: 0, z: sToZ(this.stationS), yaw: 0 })
      if (!coaster) return
      for (const dto of this.pendingCart) coaster.appendRound(dto)
      this.pendingCart = []
      const sample = coaster.sampleAt(0)
      if (!sample) return
      this.cart = this.freshCart(sample)
      this.placeCart(0)
      this.showBanner('Cart ahead')
    }
    if (this.cart && p.s >= this.stationS - 0.9) this.startBoarding()
  }

  private freshCart(sample: PathSample): CartState {
    return {
      S: 0,
      x: 0,
      targetX: 0,
      speed: 0,
      fake: null,
      fakeD: 0,
      gust: 0,
      gustLeft: 0,
      nextGust: 3,
      creakCooldown: 0,
      sample,
      pos: new THREE.Vector3(sample.x, sample.y, sample.z),
      bank: 0,
    }
  }

  /** Back at the checkpoint: a fresh line of the same level starts at a station where the cart went down. */
  private respawn() {
    const pending = this.pendingRespawn
    const old = this.cart
    if (!pending || !old) return
    this.pendingRespawn = null
    const at = old.sample
    const coaster = this.world.resetCoaster({ x: at.x, y: 0, z: at.z, yaw: at.yaw })
    if (!coaster) return
    const round = coaster.appendRound(pending.round)
    // Entered by hand so the respawn banner is not replaced by the level banner on the first frame.
    round.entered = true
    const sample = coaster.sampleAt(0)
    if (!sample) return
    if (!this.trackPruned) {
      this.trackPruned = true
      this.world.track?.prune(Number.POSITIVE_INFINITY)
    }
    this.cartFall = null
    this.cart = this.freshCart(sample)
    this.placeCart(0)
    this.world.mist = 0
    this.mapNoise = 0
    this.stress = 0.3
    this.input.flush()
    this.audio.resetAfterFall()
    this.fadeTarget = 0
    this.store.set({
      level: pending.round.level,
      respawns: pending.left,
      edge: 0,
      stepIndex: 0,
      stepCount: round.forks.length,
      hint: 'Checkpoint. Trust the map',
    })
    this.showBanner(pending.left === 0 ? 'Last chance' : `Respawn · ${pending.left} left`)
    this.audio.creak(0.8)
    telegram.impact('heavy')
    this.setPhase('CART')
  }

  /** Test page helper: knock the cart off the rails right now to exercise the respawn flow. */
  testDerail() {
    const c = this.cart
    if (this.phase !== 'CART' || !c) return
    const round = this.world.coaster?.roundAt(c.fake ? c.fake.s : c.S)
    if (!c.fake && round) this.sendGate(round.dto, Math.max(0, round.forks.findIndex((f) => !f.passed)), -1)
    this.startCartFall('derail')
  }

  private startBoarding() {
    this.boardT = 0
    this.audio.creak(0.8)
    telegram.impact('medium')
    this.store.set({ cart: true, hint: '' })
    this.showBanner('All aboard')
    this.setPhase('BOARDING')
  }

  private placeCart(dt: number) {
    const c = this.cart
    const coaster = this.world.coaster
    if (!c || !coaster) return
    const sample = c.fake ? coaster.fakeSampleAt(c.fake, c.fakeD) : coaster.sampleAt(c.S)
    if (!sample) return
    c.sample = sample
    const r = rightOf(sample.yaw)
    c.pos.set(sample.x + r.x * c.x, sample.y, sample.z + r.z * c.x)
    const targetBank = THREE.MathUtils.clamp(sample.kappa * c.speed * c.speed * 0.012, -0.42, 0.42)
    c.bank = dt > 0 ? damp(c.bank, targetBank, 4, dt) : targetBank
    coaster.cart.position.copy(c.pos)
    coaster.cart.rotation.set(Math.atan(sample.slope), sample.yaw, c.bank, 'YXZ')
  }

  private enterCartRound(round: CoasterRound) {
    const level = round.dto.level
    const intro = round.dto.cart?.intro ?? false
    if (level !== this.store.get().level || intro) this.showBanner(`Level ${level}`)
    this.store.set({
      level,
      stepIndex: 0,
      stepCount: round.forks.length,
      hint: intro ? 'Trust the map. Slide left or right of the bollard' : '',
    })
    this.audio.setWind(Math.min(1, 0.5 + (level - 6) * 0.06))
    telegram.impact('heavy')
  }

  private updateCart(dt: number) {
    const coaster = this.world.coaster
    const c = this.cart
    if (!coaster || !c) return
    this.runClockMs += dt * 1000
    const p = this.player

    if (this.phase === 'BOARDING') {
      this.boardT += dt
      p.speed = damp(p.speed, 0, 3, dt)
      p.s = Math.min(p.s + p.speed * dt, (this.stationS ?? p.s) + 0.4)
      if (this.boardT > 0.45) this.world.runner.setVisible(false)
      this.input.flush()
      this.placeCart(dt)
      if (this.boardT >= 1.4) {
        telegram.impact('heavy')
        this.setPhase('CART')
      }
      return
    }

    const round = coaster.roundAt(c.fake ? c.fake.s : c.S)
    if (round && !round.entered && !c.fake && c.S >= round.startS) {
      round.entered = true
      this.enterCartRound(round)
    }

    // Climbs slow the cart, drops never push it past the level speed (the server checks timing).
    const layoutSpeed = round?.dto.layout.speed ?? 10
    const target = layoutSpeed * THREE.MathUtils.clamp(1 - Math.max(0, c.sample.slope) * 1.1, 0.7, 1)
    const rate = c.speed < target ? (c.speed < 4 ? 0.8 : 1.5) : 3
    c.speed = Math.min(layoutSpeed, damp(c.speed, target, rate, dt))
    if (c.fake) c.fakeD += c.speed * dt
    else c.S = Math.min(c.S + c.speed * dt, coaster.builtTo - 0.05)

    if (!c.fake && round) {
      const fork = round.forks.find((f) => !f.passed)
      if (fork && c.S >= fork.s) {
        this.resolveFork(round, fork)
        if (this.phase !== 'CART') return
      }
    }

    // Curves fling the cart outward; gusts shove it sideways. The player slides to compensate.
    const steer = this.input.consumeSteer(dt)
    const wind = round?.dto.cart?.wind ?? 0
    if (wind > 0) {
      c.nextGust -= dt
      if (c.nextGust <= 0) {
        c.gust = (Math.random() < 0.5 ? -1 : 1) * wind * (0.4 + Math.random() * 0.4)
        c.gustLeft = 0.6 + Math.random() * 0.5
        c.nextGust = 2.2 + Math.random() * 3
        this.audio.creak(0.6)
        telegram.impact('medium')
      }
    }
    if (c.gustLeft > 0) c.gustLeft -= dt
    else c.gust = 0
    const drift = c.speed * c.speed * c.sample.kappa * 0.022
    const limit = c.sample.half - CART_HALF + 0.35
    // Soft guard rail: steering, drift and gusts can push the cart close to the edge but never over it.
    // Danger comes from the forks (bollard / dead-end branch), not from twitchy steering.
    const safe = limit * 0.88
    c.targetX = THREE.MathUtils.clamp(c.targetX + steer + (drift + c.gust) * dt, -safe, safe)
    const upcoming = !c.fake && round ? round.forks.find((f) => !f.passed) : null
    const clearRun = !upcoming || upcoming.s - c.S > 30
    if (clearRun && Math.abs(steer) < 1e-4) c.targetX *= Math.exp(-0.9 * dt)
    c.x = THREE.MathUtils.clamp(damp(c.x, c.targetX, 11, dt), -safe, safe)
    this.placeCart(dt)
    if (this.store.get().hint && this.store.get().stepIndex > 0) this.store.set({ hint: '' })

    if (Math.abs(c.x) > limit) {
      if (!c.fake && round) this.sendGate(round.dto, Math.max(0, round.forks.findIndex((f) => !f.passed)), -1)
      this.startCartFall('derail')
      return
    }
    if (c.fake && c.fakeD >= c.fake.fakeLength) {
      this.startCartFall('deadend')
      return
    }

    const edge = c.x / limit
    const nextFork = !c.fake && round ? round.forks.find((f) => !f.passed) : null
    const forkNear = nextFork ? 1 - clamp01((nextFork.s - c.S) / 40) : 0
    const mistTarget = coaster.mistAt(c.fake ? c.fake.s + c.fakeD : c.S)
    this.world.mist = damp(this.world.mist, mistTarget, 2.5, dt)
    const targetStress = Math.max(0.25 + forkNear * 0.5, Math.abs(edge) * 0.95, c.fake ? 0.9 : 0, this.world.mist * 0.6)
    this.stress = damp(this.stress, targetStress, 3, dt)
    this.audio.setHeartRate(80 + this.stress * 90)
    this.audio.setWind(THREE.MathUtils.clamp(0.35 + (c.speed / 19) * 0.5 + Math.max(0, -c.sample.slope) * 0.5, 0, 1))
    c.creakCooldown -= dt
    if (Math.abs(c.sample.kappa) * c.speed * c.speed > 4 && c.creakCooldown <= 0) {
      this.audio.creak(0.5)
      c.creakCooldown = 1.4
    }
    this.store.set({ edge: Math.round(edge * 10) / 10 })

    if (this.store.get().level >= 8) {
      this.nextStatic -= dt
      if (this.nextStatic <= 0) {
        this.mapNoise = 1
        this.nextStatic = 4 + Math.random() * 6
      }
    }
    this.mapNoise = Math.max(0, this.mapNoise - dt * 1.3)

    this.pruneTimer -= dt
    if (this.pruneTimer <= 0) {
      this.pruneTimer = 1
      coaster.prune(c.S)
      if (!this.trackPruned && c.S > 90) {
        this.trackPruned = true
        this.world.track?.prune(Number.POSITIVE_INFINITY)
      }
    }
  }

  private resolveFork(round: CoasterRound, fork: CoasterFork) {
    const c = this.cart
    if (!c) return
    fork.passed = true
    const step = round.forks.indexOf(fork)
    if (Math.abs(c.x) < BOLLARD_CLEAR) {
      this.sendGate(round.dto, step, -1)
      this.startCartFall('bollard')
      return
    }
    const lane = c.x < 0 ? 0 : 1
    this.sendGate(round.dto, step, lane)
    const offset = lane === 0 ? -BRANCH_OFFSET : BRANCH_OFFSET
    c.x -= offset
    c.targetX -= offset
    if (lane !== fork.correct) {
      // No warning: the rails simply run out somewhere ahead in the dark.
      c.fakeD = c.S - fork.s
      c.S = fork.s
      c.fake = fork
      this.audio.creak(1)
      telegram.impact('rigid')
      return
    }
    this.audio.correct()
    telegram.impact('light')
    const passed = step + 1
    this.store.set({ stepIndex: passed })
    if (passed >= round.forks.length) {
      telegram.notify('success')
      this.showBanner(`Level ${round.dto.level} clear`)
    }
  }

  private startCartFall(kind: CartFallState['kind']) {
    const c = this.cart
    const coaster = this.world.coaster
    if (!c || !coaster) return
    const s = c.sample
    const fwd = forwardOf(s.yaw)
    const r = rightOf(s.yaw)
    const side = c.x === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(c.x)
    const vel = new THREE.Vector3(fwd.x, s.slope, fwd.z).normalize().multiplyScalar(Math.max(4, c.speed))
    if (kind === 'derail') {
      vel.add(new THREE.Vector3(r.x, 0, r.z).multiplyScalar(side * 3.5))
      vel.y += 1.2
    } else if (kind === 'bollard') {
      vel.multiplyScalar(0.35).add(new THREE.Vector3(r.x, 0, r.z).multiplyScalar(side * 2.5))
      vel.y += 4
    } else {
      vel.y += 0.6
    }
    this.cartFall = {
      kind,
      t: 0,
      pos: c.pos.clone(),
      vel,
      rot: coaster.cart.rotation.clone(),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 1.2 + (kind === 'deadend' ? 0.9 : 0.3),
        (Math.random() - 0.5) * 0.8,
        side * (kind === 'derail' ? -1.6 : -0.6),
      ),
      hapticStep: 0,
    }
    this.stress = 1
    this.store.set({ edge: 0, hint: '' })
    this.audio.wrong()
    telegram.notify('error')
    this.setPhase('FALL')
  }

  private updateCartFall(dt: number) {
    const f = this.cartFall
    const coaster = this.world.coaster
    if (!f || !coaster || !this.cart) return
    f.t += dt
    this.stress = 1
    f.vel.y = Math.max(-60, f.vel.y - 9.81 * 1.25 * dt)
    f.pos.addScaledVector(f.vel, dt)
    f.rot.x += f.spin.x * dt
    f.rot.y += f.spin.y * dt
    f.rot.z += f.spin.z * dt
    coaster.cart.position.copy(f.pos)
    coaster.cart.rotation.copy(f.rot)
    this.cart.pos.copy(f.pos)
    this.world.mist = damp(this.world.mist, 0, 1, dt)
    this.mapNoise = Math.min(1, f.t * 1.5)
    const pulses = [0, 0.5, 1.0, 1.5]
    if (f.hapticStep < pulses.length && f.t >= pulses[f.hapticStep]) {
      telegram.impact(f.hapticStep === 0 ? 'heavy' : 'rigid')
      f.hapticStep += 1
    }
    if (f.t > 2.6) this.fadeTarget = 1
    if (f.t > 3.2 && this.fade > 0.9) {
      if (this.pendingRespawn) {
        this.respawn()
      } else if (this.finalResult) {
        this.audio.resetAfterFall()
        this.setPhase('RESULT')
      } else if (f.t > 10) {
        this.showError(new Error('Lost connection to the tower. Try again.'))
      }
    }
  }

  /** First person from the cart seat: the track ahead, the drop below. */
  private updateCartCamera(dt: number) {
    const c = this.cart
    const coaster = this.world.coaster
    if (!c || !coaster) return
    const cam = this.world.camera
    const cs = this.camState
    coaster.cart.updateMatrixWorld()
    const pos = coaster.cart.localToWorld(new THREE.Vector3(0, 1.3, 0.3))
    let look: THREE.Vector3
    let roll = 0
    let fov = 74
    let rate = 30
    const f = this.cartFall
    if (f) {
      const dir = f.vel.clone().normalize()
      look = pos.clone().addScaledVector(dir, 10)
      look.y -= Math.min(9, f.t * 5)
      roll = c.bank + f.t * f.spin.z * 0.35
      fov = THREE.MathUtils.lerp(76, 98, smooth(clamp01(f.t / 1.6)))
      rate = 14
      pos.x += (Math.random() - 0.5) * 0.08
      pos.y += (Math.random() - 0.5) * 0.08
    } else {
      const ahead = (c.fake ? coaster.fakeSampleAt(c.fake, c.fakeD + 14) : coaster.sampleAt(c.S + 14)) ?? c.sample
      const r = rightOf(ahead.yaw)
      // Aim low so the plank ahead fills the view instead of the cart walls and sky.
      look = new THREE.Vector3(ahead.x + r.x * c.x * 0.8, ahead.y + 0.35, ahead.z + r.z * c.x * 0.8)
      roll = c.bank * 0.9
      const drop = Math.max(0, -c.sample.slope)
      fov = 72 + (c.speed / 19) * 8 + drop * 16 - this.world.mist * 4
      if (this.phase === 'BOARDING') rate = 3.2
      const limit = c.sample.half - CART_HALF + 0.35
      const shake = 0.004 + (c.speed / 19) * 0.012 + clamp01(Math.abs(c.x) / limit - 0.6) * 0.05
      pos.x += (Math.random() - 0.5) * shake
      pos.y += (Math.random() - 0.5) * shake
      roll += (Math.random() - 0.5) * shake * 0.4
    }
    if (cs.pos.distanceTo(pos) > 25) cs.pos.copy(pos)
    if (cs.look.distanceTo(look) > 40) cs.look.copy(look)
    cs.pos.lerp(pos, 1 - Math.exp(-rate * dt))
    cs.look.lerp(look, 1 - Math.exp(-rate * 0.8 * dt))
    cs.fov = damp(cs.fov, fov, 4, dt)
    cam.position.copy(cs.pos)
    cam.lookAt(cs.look)
    cam.rotateZ(roll)
    if (Math.abs(cam.fov - cs.fov) > 0.01) {
      cam.fov = cs.fov
      cam.updateProjectionMatrix()
    }
  }

  private drawMinimap(dt: number) {
    const canvas = this.minimap
    const c = this.cart
    const coaster = this.world.coaster
    if (!canvas || !c || !coaster) return
    this.mapAccum += dt
    if (this.mapAccum < 1 / 30) return
    this.mapAccum = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const S = c.fake ? c.fake.s + c.fakeD : c.S
    coaster.drawMinimap(ctx, w, h, { S, x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.sample.yaw }, this.time, this.mapNoise)
  }

  destroy() {
    this.destroyed = true
    this.runEpoch += 1
    cancelAnimationFrame(this.raf)
    this.input.dispose()
    this.audio.setHeartRate(0)
    this.world?.dispose()
  }
}

export type { FailReason, RoundDTO }
