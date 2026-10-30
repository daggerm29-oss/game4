import * as THREE from 'three'
import {
  type BaseFace,
  type Face,
  type RoundDTO,
  TRACK_HALF,
  doorwayWidth,
  laneCenter,
} from '@/lib/shared/game'
import { GROUND_Y } from './city'
import { drawFace, faceTexture } from './faces'
import { type PBRSet, makeConcrete, makeGrating, makeHazardStripes, makeSteel } from './textures'

/** Track distance s maps to world z = -s. The runner always moves toward -z. */
export const sToZ = (s: number) => -s

const TRAP_DEPTH = 2.4
const WALL_HEIGHT = 4.3
const DOOR_HEIGHT = 3.05
const DECK_CHUNK = 12
const LAMP_SPACING = 18
const PILLAR_SPACING = 64
const START_PLATFORM = { from: -9, to: 3, half: 5.5 }

export class TrackMaterials {
  steel: THREE.MeshStandardMaterial
  darkSteel: THREE.MeshStandardMaterial
  grating: THREE.MeshStandardMaterial
  concrete: THREE.MeshStandardMaterial
  hazard: THREE.MeshStandardMaterial
  wall: THREE.MeshStandardMaterial
  doorSteel: THREE.MeshStandardMaterial
  bulb: THREE.MeshStandardMaterial
  private sets: PBRSet[] = []

  constructor(textureSize: number) {
    const steel = makeSteel(textureSize, 7)
    const door = makeSteel(textureSize, 23)
    const grating = makeGrating(textureSize)
    const concrete = makeConcrete(textureSize)
    this.sets.push(steel, door, grating, concrete)
    this.steel = new THREE.MeshStandardMaterial({ ...steel, metalness: 0.85, normalScale: new THREE.Vector2(0.8, 0.8) })
    this.darkSteel = new THREE.MeshStandardMaterial({ ...steel, color: 0x6f747c, metalness: 0.9 })
    this.doorSteel = new THREE.MeshStandardMaterial({ ...door, metalness: 0.75, color: 0x9aa0aa })
    this.wall = new THREE.MeshStandardMaterial({ ...door, metalness: 0.6, color: 0x2a2e35, roughness: 0.7 })
    this.grating = new THREE.MeshStandardMaterial({ ...grating, metalness: 0.8, alphaTest: 0.5, side: THREE.DoubleSide })
    this.concrete = new THREE.MeshStandardMaterial({ ...concrete, metalness: 0 })
    this.hazard = new THREE.MeshStandardMaterial({ map: makeHazardStripes(), roughness: 0.6, metalness: 0.2 })
    this.bulb = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb36b, emissiveIntensity: 6 })
  }
}

/** Shared geometries keyed by dimensions; segments come and go but geometry is reused. */
class GeometryCache {
  private map = new Map<string, THREE.BufferGeometry>()

  box(w: number, h: number, d: number, uvScale = 1) {
    const key = `b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${uvScale}`
    let geo = this.map.get(key)
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d)
      if (uvScale !== 1) {
        const uv = geo.attributes.uv as THREE.BufferAttribute
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) * uvScale, uv.getY(i) * h * uvScale)
      }
      this.map.set(key, geo)
    }
    return geo
  }

  floor(width: number, length: number) {
    const key = `f${width.toFixed(3)}|${length.toFixed(3)}`
    let geo = this.map.get(key)
    if (!geo) {
      geo = new THREE.PlaneGeometry(width, length)
      const uv = geo.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width * 1.4, uv.getY(i) * length * 1.4)
      geo.rotateX(-Math.PI / 2)
      this.map.set(key, geo)
    }
    return geo
  }

  plane(w: number, h: number) {
    const key = `p${w.toFixed(3)}|${h.toFixed(3)}`
    let geo = this.map.get(key)
    if (!geo) {
      geo = new THREE.PlaneGeometry(w, h)
      this.map.set(key, geo)
    }
    return geo
  }

  dispose() {
    this.map.forEach((geo) => geo.dispose())
    this.map.clear()
  }
}

export class Sign {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  private canvas: HTMLCanvasElement
  private texture: THREE.CanvasTexture
  intensity = 0
  target = 0
  flicker = 0

  constructor(width: number, height: number, private tint: string | null) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 1024
    this.canvas.height = Math.round((1024 * height) / width)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
    this.material = new THREE.MeshStandardMaterial({
      color: 0x050505,
      roughness: 0.25,
      metalness: 0.1,
      emissive: 0xffffff,
      emissiveMap: this.texture,
      emissiveIntensity: 0,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material)
  }

  show(sequence: Face[]) {
    const ctx = this.canvas.getContext('2d')!
    const { width, height } = this.canvas
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = this.tint ? '#1a0505' : '#0b0d10'
    for (let y = 6; y < height; y += 12) for (let x = 6; x < width; x += 12) ctx.fillRect(x, y, 3, 3)

    const rows = sequence.length > 5 ? 2 : 1
    const perRow = Math.ceil(sequence.length / rows)
    const cellW = width / perRow
    const cellH = height / rows
    const r = Math.min(cellW, cellH) * 0.36
    sequence.forEach((face, i) => {
      const row = Math.floor(i / perRow)
      const col = i % perRow
      const rowCount = row === rows - 1 ? sequence.length - perRow * (rows - 1) : perRow
      const offset = (perRow - rowCount) * cellW * 0.5
      const cx = offset + cellW * (col + 0.5)
      const cy = cellH * (row + 0.44)
      drawFace(ctx, face, cx, cy, r)
      ctx.fillStyle = this.tint ?? '#8a93a3'
      ctx.font = `700 ${Math.round(r * 0.4)}px ui-monospace, monospace`
      ctx.textAlign = 'center'
      ctx.fillText(String(i + 1), cx, cy + r * 1.5)
    })
    if (this.tint) {
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = this.tint
      ctx.fillRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'source-over'
    }
    this.texture.needsUpdate = true
  }

  update(dt: number, time: number) {
    const k = 1 - Math.exp(-dt * 18)
    this.intensity += (this.target - this.intensity) * k
    let value = this.intensity
    if (this.flicker > 0) {
      const n = Math.sin(time * 53.1) * Math.sin(time * 17.3 + 1.3)
      value *= n > 0.25 - this.flicker * 0.6 ? 1 : 0.05
    }
    this.material.emissiveIntensity = value * 2.8
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
}

export interface GateIcon {
  mesh: THREE.Mesh
  mat: THREE.MeshStandardMaterial
  lane: number
  x: number
  fromX: number
}

export interface TrackGate {
  /** Gate index within its round (= sequence position). */
  index: number
  round: TrackRound
  s: number
  lanes: number
  faces: Face[]
  icons: GateIcon[]
  doors: { pivot: THREE.Group; openT: number }[]
  traps: { pivot: THREE.Group; t: number }[]
  lamps: THREE.MeshStandardMaterial[]
  swapT: number
  swapping: boolean
  passed: boolean
  /** Lane the runner went through, or -1. */
  passedLane: number
  blackoutDone: boolean
}

export interface TrackRound {
  dto: Pick<RoundDTO, 'level' | 'sequence' | 'displayMs' | 'layout' | 'steps' | 'modifiers'> & { roundId?: string; token?: string }
  startS: number
  endS: number
  gates: TrackGate[]
  sign: Sign
  signPosition: THREE.Vector3
  fakeSign: Sign | null
  group: THREE.Group
}

export interface Lamp {
  position: THREE.Vector3
  phase: number
  mat: THREE.MeshStandardMaterial
  group: THREE.Group
}

interface Chunk {
  fromS: number
  toS: number
  group: THREE.Group
}

/**
 * Endless walkway: round segments (sign + gates) are appended ahead as rounds arrive from the server,
 * plain deck fills any gap, and everything far behind the runner is disposed.
 */
export class Track {
  group = new THREE.Group()
  rounds: TrackRound[] = []
  lamps: Lamp[] = []
  /** Track distance up to which deck has been built. */
  deckEnd = START_PLATFORM.to
  private chunks: Chunk[] = []
  private geo = new GeometryCache()
  private nextLampS = 8
  private nextPillarS = 24
  /** Gate trap zones the deck builder must leave open. */
  private holes: [number, number][] = []

  constructor(private mats: TrackMaterials) {
    this.buildStartPlatform()
  }

  /** Where the next round would naturally start. */
  get plannedNextStart() {
    const last = this.rounds[this.rounds.length - 1]
    return last ? last.endS : 0
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    parent.add(m)
    return m
  }

  private buildStartPlatform() {
    const m = this.mats
    const g = new THREE.Group()
    const len = START_PLATFORM.to - START_PLATFORM.from
    const cz = sToZ((START_PLATFORM.from + START_PLATFORM.to) / 2)
    const size = START_PLATFORM.half * 2
    this.mesh(this.geo.box(size, 0.35, len, 0.35), m.concrete, 0, -0.175, cz, g)
    const height = -GROUND_Y
    this.mesh(this.geo.box(size - 1.2, height, len - 1.2, 0.05), m.concrete, 0, -height / 2 - 0.35, cz, g)
    for (let i = 1; i <= 3; i++) this.mesh(this.geo.box(size - 0.2, 0.3, len - 0.2, 0.35), m.concrete, 0, -i * 3.8, cz, g)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.mesh(this.geo.box(0.5, 12, 0.5, 0.4), m.concrete, sx * (START_PLATFORM.half - 0.35), -6.35, cz + sz * (len / 2 - 0.35), g)
      }
    }
    for (let i = 0; i < 9; i++) {
      const rebar = this.mesh(this.geo.box(0.025, 0.6 + (i % 3) * 0.3, 0.025), m.darkSteel, -START_PLATFORM.half + 0.6 + i * 1.2, 0.3, sToZ(START_PLATFORM.from) - 0.2, g)
      rebar.rotation.z = ((i % 4) - 1.5) * 0.08
    }
    this.group.add(g)
    this.chunks.push({ fromS: START_PLATFORM.from, toS: START_PLATFORM.to, group: g })
  }

  /** Builds deck from deckEnd up to `toS`, skipping trap holes. */
  private extendDeck(toS: number) {
    while (this.deckEnd < toS - 0.01) {
      const from = this.deckEnd
      const to = Math.min(toS, from + DECK_CHUNK)
      const g = new THREE.Group()
      // Floor pieces between holes.
      let cursor = from
      const holes = this.holes.filter(([a, b]) => b > from && a < to).sort((a, b) => a[0] - b[0])
      for (const [a, b] of holes) {
        if (a > cursor) this.addFloor(cursor, a, g)
        cursor = Math.max(cursor, b)
      }
      if (cursor < to) this.addFloor(cursor, to, g)
      this.addStructure(from, to, g)
      while (this.nextLampS < to) {
        this.addLamp(this.nextLampS, Math.round(this.nextLampS / LAMP_SPACING) % 2 === 0 ? -1 : 1, g)
        this.nextLampS += LAMP_SPACING
      }
      while (this.nextPillarS < to) {
        this.addPillar(this.nextPillarS, g)
        this.nextPillarS += PILLAR_SPACING
      }
      this.group.add(g)
      this.chunks.push({ fromS: from, toS: to, group: g })
      this.deckEnd = to
    }
  }

  private addFloor(fromS: number, toS: number, parent: THREE.Object3D) {
    const len = toS - fromS
    if (len < 0.02) return
    this.mesh(this.geo.floor(TRACK_HALF * 2, len), this.mats.grating, 0, 0, sToZ((fromS + toS) / 2), parent)
  }

  private addStructure(fromS: number, toS: number, parent: THREE.Object3D) {
    const m = this.mats
    const len = toS - fromS
    const cz = sToZ((fromS + toS) / 2)
    for (const side of [-1, 1]) {
      const x = side * (TRACK_HALF - 0.05)
      this.mesh(this.geo.box(0.22, 0.025, len, 0.8), m.steel, x, -0.04, cz, parent)
      this.mesh(this.geo.box(0.03, 0.32, len, 0.8), m.steel, x, -0.2, cz, parent)
      this.mesh(this.geo.box(0.22, 0.025, len, 0.8), m.steel, x, -0.37, cz, parent)
      // Hazard edge so the drop always reads.
      this.mesh(this.geo.box(0.1, 0.03, len), m.hazard, side * (TRACK_HALF - 0.05), 0.012, cz, parent)
    }
    this.mesh(this.geo.box(0.08, 0.08, len), m.darkSteel, 0, -1.0, cz, parent)
    for (let s = Math.ceil(fromS / 3) * 3; s < toS; s += 3) {
      this.mesh(this.geo.box(TRACK_HALF * 2, 0.08, 0.08), m.darkSteel, 0, -0.3, sToZ(s), parent)
      for (const side of [-1, 1]) {
        const diag = this.mesh(this.geo.box(0.05, 1.25, 0.05), m.darkSteel, side * TRACK_HALF * 0.5, -0.65, sToZ(s), parent)
        diag.rotation.z = side * 1.05
      }
    }
  }

  private addPillar(s: number, parent: THREE.Object3D) {
    const m = this.mats
    const height = -GROUND_Y
    const z = sToZ(s)
    this.mesh(this.geo.box(1.4, 0.4, 1.4, 0.3), m.concrete, 0, -1.25, z, parent)
    this.mesh(this.geo.box(0.9, height, 0.9, 0.03), m.concrete, 0, -height / 2 - 1.4, z, parent)
    for (const side of [-1, 1]) {
      const brace = this.mesh(this.geo.box(0.12, 3.2, 0.12), m.darkSteel, side * 1.2, -1.9, z, parent)
      brace.rotation.z = side * -0.7
    }
  }

  private addLamp(s: number, side: number, parent: THREE.Object3D) {
    const m = this.mats
    const g = new THREE.Group()
    const x = side * (TRACK_HALF + 0.15)
    const z = sToZ(s)
    const y = 2.9
    this.mesh(this.geo.box(0.08, y, 0.08), m.darkSteel, x, y / 2, z, g)
    this.mesh(this.geo.box(0.6, 0.05, 0.05), m.darkSteel, x - side * 0.3, y, z, g)
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.16, 10), m.darkSteel)
    cage.position.set(x - side * 0.58, y - 0.1, z)
    g.add(cage)
    const mat = m.bulb.clone()
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat)
    bulb.position.set(cage.position.x, y - 0.19, z)
    g.add(bulb)
    parent.add(g)
    this.lamps.push({ position: bulb.position.clone(), phase: Math.random() * 100, mat, group: g })
  }

  /** Appends a round segment, starting no earlier than the built deck so a late round never overlaps. */
  appendRound(dto: TrackRound['dto'], minStartS = 0) {
    const startS = Math.max(this.plannedNextStart, minStartS, this.deckEnd)
    const { layout } = dto
    const endS = startS + layout.length
    const group = new THREE.Group()
    const round: TrackRound = {
      dto,
      startS,
      endS,
      gates: [],
      sign: new Sign(8, dto.sequence.length > 5 ? 4.2 : 2.6, null),
      signPosition: new THREE.Vector3(),
      fakeSign: null,
      group,
    }

    // Main sign on the left side of the walkway, angled toward the runner.
    const signZ = sToZ(startS + layout.signAt)
    const signX = -(TRACK_HALF + 4.4)
    const signH = dto.sequence.length > 5 ? 4.2 : 2.6
    const signY = 1.8 + signH / 2
    round.sign.mesh.position.set(signX, signY, signZ)
    round.sign.mesh.rotation.y = 0.42
    round.sign.show(dto.sequence)
    round.signPosition.set(signX + 1.2, signY, signZ + 2)
    group.add(round.sign.mesh)
    const frame = new THREE.Group()
    frame.position.copy(round.sign.mesh.position)
    frame.rotation.y = 0.42
    this.mesh(this.geo.box(8.3, 0.14, 0.25), this.mats.steel, 0, signH / 2 + 0.08, -0.05, frame)
    this.mesh(this.geo.box(8.3, 0.14, 0.25), this.mats.steel, 0, -signH / 2 - 0.08, -0.05, frame)
    for (const sx of [-1, 1]) this.mesh(this.geo.box(0.2, signY + signH / 2 + 2, 0.2), this.mats.steel, sx * 4.1, -(signY - signH / 2) / 2 - 1, -0.1, frame)
    group.add(frame)
    // Catwalk out to the sign so it reads as part of the structure.
    this.mesh(this.geo.box(4.5, 0.08, 0.6), this.mats.darkSteel, -(TRACK_HALF + 2.2), -0.1, signZ + 0.6, group)

    if (dto.modifiers.fakeSign) {
      const fake = new Sign(4.6, 2, '#ff5a3c')
      fake.mesh.position.set(TRACK_HALF + 3.4, 3, sToZ(startS + layout.signAt * 0.8))
      fake.mesh.rotation.y = -0.45
      fake.show(dto.modifiers.fakeSign as BaseFace[])
      group.add(fake.mesh)
      this.mesh(this.geo.box(0.14, 3, 0.14), this.mats.steel, TRACK_HALF + 3.4, 0.5, sToZ(startS + layout.signAt * 0.8) - 0.1, group)
      round.fakeSign = fake
    }

    dto.steps.forEach((step, index) => {
      const s = startS + layout.firstGateAt + index * layout.gateGap
      this.holes.push([s, s + TRAP_DEPTH])
      round.gates.push(this.buildGate(round, index, s, step.faces, step.preSwap, group))
    })

    this.group.add(group)
    this.rounds.push(round)
    this.extendDeck(endS)
    return round
  }

  private buildGate(round: TrackRound, index: number, s: number, faces: Face[], preSwap: Face[] | null, parent: THREE.Object3D): TrackGate {
    const m = this.mats
    const lanes = faces.length
    const laneW = (TRACK_HALF * 2) / lanes
    const doorW = doorwayWidth(lanes)
    const z = sToZ(s)
    const g = new THREE.Group()
    g.position.z = z
    const thickness = 0.35
    const edge = TRACK_HALF + 0.5

    // Wall pieces: outer edges, posts between doorways, and the lintel above.
    const centers = faces.map((_, lane) => laneCenter(lane, lanes))
    const xs = [-edge, ...centers.flatMap((c) => [c - doorW / 2, c + doorW / 2]), edge]
    for (let i = 0; i < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i]
      if (w > 0.01) this.mesh(this.geo.box(w, DOOR_HEIGHT, thickness, 0.5), m.wall, (xs[i] + xs[i + 1]) / 2, DOOR_HEIGHT / 2, 0, g)
    }
    this.mesh(this.geo.box(edge * 2, WALL_HEIGHT - DOOR_HEIGHT, thickness, 0.5), m.wall, 0, (WALL_HEIGHT + DOOR_HEIGHT) / 2, 0, g)
    this.mesh(this.geo.box(edge * 2 + 0.1, 0.14, thickness + 0.04), m.hazard, 0, DOOR_HEIGHT + 0.02, 0, g)
    this.mesh(this.geo.box(edge * 2 + 0.2, 0.2, thickness + 0.1), m.steel, 0, WALL_HEIGHT + 0.1, 0, g)

    const icons: GateIcon[] = []
    const doors: TrackGate['doors'] = []
    const traps: TrackGate['traps'] = []
    const lamps: THREE.MeshStandardMaterial[] = []
    faces.forEach((face, lane) => {
      const x = centers[lane]
      const fromLane = preSwap ? preSwap.indexOf(face) : lane
      const fromX = laneCenter(fromLane, lanes)
      const mat = new THREE.MeshStandardMaterial({
        color: 0x020202,
        emissive: 0xffffff,
        emissiveMap: faceTexture(face),
        emissiveIntensity: 2.6,
        roughness: 0.3,
      })
      const size = lanes === 3 ? 0.9 : 1.0
      const icon = new THREE.Mesh(this.geo.plane(size, size), mat)
      icon.position.set(fromX, (WALL_HEIGHT + DOOR_HEIGHT) / 2 + 0.05, thickness / 2 + 0.02)
      g.add(icon)
      icons.push({ mesh: icon, mat, lane, x, fromX })

      // Door frame and panel, hinged on the left jamb, swinging away from the runner.
      for (const side of [-1, 1]) this.mesh(this.geo.box(0.08, DOOR_HEIGHT, thickness + 0.06), m.steel, x + side * (doorW / 2 + 0.02), DOOR_HEIGHT / 2, 0, g)
      const pivot = new THREE.Group()
      pivot.position.set(x - doorW / 2, 0, -0.02)
      this.mesh(this.geo.box(doorW, DOOR_HEIGHT - 0.05, 0.06, 0.6), m.doorSteel, doorW / 2, (DOOR_HEIGHT - 0.05) / 2, 0, pivot)
      this.mesh(this.geo.box(0.04, 0.2, 0.08), m.darkSteel, doorW - 0.14, 1.05, 0.03, pivot)
      g.add(pivot)
      doors.push({ pivot, openT: 0 })

      const lampMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff8a2a, emissiveIntensity: 1.6 })
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lampMat)
      lamp.position.set(x + doorW / 2 - 0.1, DOOR_HEIGHT - 0.14, thickness / 2 + 0.05)
      g.add(lamp)
      lamps.push(lampMat, mat)

      // Trap floor beyond the doorway, hinged at the wall, dropping into the void.
      const trap = new THREE.Group()
      trap.position.set(-TRACK_HALF + laneW * (lane + 0.5), 0, -thickness / 2)
      const panel = new THREE.Mesh(this.geo.floor(laneW - 0.03, TRAP_DEPTH), m.grating)
      panel.position.z = -TRAP_DEPTH / 2
      trap.add(panel)
      this.mesh(this.geo.box(laneW - 0.03, 0.02, 0.06), m.hazard, 0, -0.012, -TRAP_DEPTH + 0.03, trap)
      g.add(trap)
      traps.push({ pivot: trap, t: 0 })
    })

    parent.add(g)
    return { index, round, s, lanes, faces, icons, doors, traps, lamps, swapT: preSwap ? 0 : 1, swapping: false, passed: false, passedLane: -1, blackoutDone: false }
  }

  /** Keeps deck built ahead of the runner when the next round has not arrived yet. */
  ensureAhead(playerS: number, distance = 30) {
    const last = this.rounds[this.rounds.length - 1]
    const reserved = last ? last.endS : 0
    if (playerS + distance > Math.max(this.deckEnd, reserved)) this.extendDeck(playerS + distance)
  }

  /** Disposes everything well behind the runner. */
  prune(playerS: number, behind = 45) {
    const limit = playerS - behind
    this.rounds = this.rounds.filter((round) => {
      if (round.endS >= limit) return true
      round.sign.dispose()
      round.fakeSign?.dispose()
      for (const gate of round.gates) gate.lamps.forEach((mat) => mat.dispose())
      round.group.removeFromParent()
      return false
    })
    this.holes = this.holes.filter(([, b]) => b >= limit)
    this.chunks = this.chunks.filter((chunk) => {
      if (chunk.toS >= limit) return true
      chunk.group.removeFromParent()
      return false
    })
    this.lamps = this.lamps.filter((lamp) => {
      if (-lamp.position.z >= limit) return true
      lamp.mat.dispose()
      lamp.group.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh && (mesh.geometry.type === 'CylinderGeometry' || mesh.geometry.type === 'SphereGeometry')) mesh.geometry.dispose()
      })
      return false
    })
  }

  roundAt(s: number) {
    for (let i = this.rounds.length - 1; i >= 0; i--) if (this.rounds[i].startS <= s) return this.rounds[i]
    return null
  }

  /** Half width of solid floor at a track distance, for edge shake and fall checks. */
  halfWidthAt(s: number) {
    if (s < START_PLATFORM.to) return START_PLATFORM.half
    return TRACK_HALF
  }

  dispose() {
    this.prune(Number.POSITIVE_INFINITY, 0)
    this.group.removeFromParent()
    this.geo.dispose()
  }
}
