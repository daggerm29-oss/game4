import * as THREE from 'three'
import { TIERS, type TierConfig } from '../quality'
import type { Tier } from '../store'
import { Coaster } from './coaster'
import { createCity } from './city'
import { Runner } from './runner'
import { PostPipeline } from './post'
import { bakeEnvironment, createSky } from './sky'
import { makeFogTexture } from './textures'
import { Track, TrackMaterials, type TrackRound } from './track'

interface FogLayer {
  mesh: THREE.Mesh
  texture: THREE.Texture
  speed: THREE.Vector2
}

export class World {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 4000)
  track: Track | null = null
  coaster: Coaster | null = null
  /** Fog bank thickness around the cart, 0..1. */
  mist = 0
  runner = new Runner()
  /** Round whose sign drives the sign spotlight. */
  activeRound: TrackRound | null = null
  config: TierConfig
  tier: Tier
  blackout = false
  flash = 0
  onLightning: ((distance: number) => void) | null = null

  private sky = createSky()
  private city = createCity()
  private mats: TrackMaterials | null = null
  private doorLight = new THREE.PointLight(0xfff1d6, 0, 10, 2)
  private doorFlash = 0
  private post: PostPipeline
  private hemi = new THREE.HemisphereLight(0x2a3448, 0x2a1a10, 0.5)
  private moon = new THREE.DirectionalLight(0x9fb0d0, 0.35)
  private signLight = new THREE.PointLight(0xcfe0ff, 0, 9, 2)
  private lampLights: THREE.PointLight[] = []
  private fogLayers: FogLayer[] = []
  private bolt: THREE.Line
  private nextStrike = 4
  private strikeTime = -1
  private strikePattern: number[] = []
  private width = 1
  private height = 1
  pixelRatio = 1
  private resizeObserver: ResizeObserver

  constructor(
    private container: HTMLElement,
    tier: Tier,
  ) {
    this.tier = tier
    this.config = TIERS[tier]
    this.renderer = new THREE.WebGLRenderer({
      antialias: tier !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor(0x05070a)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.touchAction = 'none'
    container.appendChild(this.renderer.domElement)

    this.scene.fog = new THREE.FogExp2(0x0b0f15, 0.0031)
    this.scene.add(this.sky.mesh, this.city.group, this.hemi, this.moon, this.signLight, this.doorLight)
    this.runner.attach(this.scene)
    this.moon.position.set(-80, 120, -60)

    this.bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color(8, 8, 12), fog: false }))
    this.bolt.visible = false
    this.bolt.frustumCulled = false
    this.scene.add(this.bolt)

    this.post = new PostPipeline(this.renderer, this.scene, this.camera)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
  }

  get gl() {
    return this.renderer.getContext()
  }

  /** Heavy one-time setup, split so the loading screen can report progress between steps. */
  async init(progress: (fraction: number, label: string) => Promise<void>) {
    await progress(0.15, 'Baking storm sky')
    this.scene.environment = bakeEnvironment(this.renderer)
    this.scene.environmentIntensity = 0.7
    await progress(0.4, 'Forging steel')
    this.mats = new TrackMaterials(this.config.textureSize)
    await progress(0.6, 'Raising the city')
    this.applyTier(this.tier)
    await progress(0.75, 'Rolling in fog')
    this.buildFog()
  }

  applyTier(tier: Tier) {
    this.tier = tier
    this.config = TIERS[tier]
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.config.maxPixelRatio)
    this.renderer.setPixelRatio(this.pixelRatio)
    this.city.setBudget(this.config.buildings, this.config.vehicles, this.pixelRatio)

    for (const light of this.lampLights) light.removeFromParent()
    this.lampLights = []
    for (let i = 0; i < this.config.pointLights; i++) {
      const light = new THREE.PointLight(0xffa860, 9, 13, 2)
      this.scene.add(light)
      this.lampLights.push(light)
    }
    for (const layer of this.fogLayers) layer.mesh.visible = this.fogLayers.indexOf(layer) < this.config.fogLayers
    this.resize()
    this.post.configure(this.config, this.width, this.height)
    this.post.setSize(this.width, this.height, this.pixelRatio)
  }

  setPixelRatio(ratio: number) {
    this.pixelRatio = ratio
    this.renderer.setPixelRatio(ratio)
    this.post.setSize(this.width, this.height, ratio)
    this.city.setBudget(this.config.buildings, this.config.vehicles, ratio)
  }

  private buildFog() {
    const texture = makeFogTexture(256)
    const heights = [-60, -140, -230]
    heights.forEach((y, i) => {
      const tex = texture.clone()
      tex.needsUpdate = true
      tex.repeat.set(4 + i, 4 + i)
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.11, 0.12, 0.14),
        alphaMap: tex,
        transparent: true,
        opacity: 0.55 - i * 0.1,
        depthWrite: false,
        fog: false,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = y
      mesh.renderOrder = 2
      mesh.visible = i < this.config.fogLayers
      this.scene.add(mesh)
      this.fogLayers.push({ mesh, texture: tex, speed: new THREE.Vector2(0.004 + i * 0.002, 0.0015 * (i + 1)) })
    })
  }

  /** Throws away the current track and starts a fresh one at the start platform. */
  resetTrack() {
    this.track?.dispose()
    if (!this.mats) throw new Error('World not initialized')
    this.track = new Track(this.mats)
    this.activeRound = null
    this.scene.add(this.track.group)
    return this.track
  }

  /** Starts a fresh coaster line at a world position, heading along yaw (0 = -z). */
  resetCoaster(start: { x: number; y: number; z: number; yaw: number } | null) {
    this.coaster?.dispose()
    this.coaster = null
    this.mist = 0
    if (!start) return null
    if (!this.mats) throw new Error('World not initialized')
    this.coaster = new Coaster(this.mats, start)
    this.scene.add(this.coaster.group)
    return this.coaster
  }

  /** Bright burst at a doorway the runner just went through. */
  pulseDoor(x: number, z: number) {
    this.doorLight.position.set(x, 1.6, z - 0.8)
    this.doorFlash = 1
  }

  resize() {
    const rect = this.container.getBoundingClientRect()
    this.width = Math.max(1, Math.round(rect.width))
    this.height = Math.max(1, Math.round(rect.height))
    this.renderer.setSize(this.width, this.height, false)
    this.post.setSize(this.width, this.height, this.pixelRatio)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
  }

  /** Forces a lightning strike soon; used by blackouts. */
  strikeSoon(withinSec: number) {
    this.nextStrike = Math.min(this.nextStrike, withinSec)
  }

  private updateLightning(dt: number) {
    this.nextStrike -= dt
    if (this.nextStrike <= 0 && this.strikeTime < 0) {
      this.strikeTime = 0
      this.strikePattern = [0, 0.07, 0.16, 0.3].slice(0, 2 + Math.floor(Math.random() * 3))
      const distance = Math.random()
      this.nextStrike = this.blackout ? 0.6 + Math.random() * 0.9 : 6 + Math.random() * 11
      const angle = Math.random() * Math.PI * 2
      const dir = new THREE.Vector3(Math.cos(angle), 0.35 + Math.random() * 0.25, Math.sin(angle))
      this.sky.uniforms.uFlashDir.value.copy(dir)
      this.moon.position.copy(dir).multiplyScalar(200)
      this.buildBolt(dir, 450 + distance * 900)
      this.onLightning?.(distance)
    }
    if (this.strikeTime >= 0) {
      this.strikeTime += dt
      let f = 0
      for (const start of this.strikePattern) {
        const t = this.strikeTime - start
        if (t >= 0 && t < 0.35) f = Math.max(f, Math.exp(-t * 14))
      }
      this.flash = f
      this.bolt.visible = f > 0.35
      if (this.strikeTime > 0.8) {
        this.strikeTime = -1
        this.flash = 0
        this.bolt.visible = false
      }
    }
  }

  private buildBolt(dir: THREE.Vector3, distance: number) {
    const points: THREE.Vector3[] = []
    const base = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(distance)
    let p = base.clone().setY(260 + Math.random() * 100)
    for (let i = 0; i < 18; i++) {
      points.push(p.clone())
      p = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, -32 - Math.random() * 20, (Math.random() - 0.5) * 40))
    }
    this.bolt.geometry.dispose()
    this.bolt.geometry = new THREE.BufferGeometry().setFromPoints(points)
  }

  /** Lamp flicker, blackout, lightning and point light pool placement near the player. */
  private updateLights(time: number, playerZ: number, signLevel: number) {
    const track = this.track
    const lit = this.blackout ? 0 : 1
    this.hemi.intensity = (this.blackout ? 0.04 : 0.45) + this.flash * 2.5
    this.moon.intensity = 0.3 + this.flash * 9
    this.scene.environmentIntensity = (this.blackout ? 0.08 : 0.7) + this.flash * 1.6
    this.sky.uniforms.uFlash.value = this.flash

    if (!track) return
    const lamps = [...track.lamps].sort((a, b) => Math.abs(a.position.z - playerZ + 8) - Math.abs(b.position.z - playerZ + 8))
    track.lamps.forEach((lamp) => {
      const n = Math.sin(time * 9 + lamp.phase) * Math.sin(time * 23.7 + lamp.phase * 2)
      const flick = n > 0.82 ? 0.15 : 1
      lamp.mat.emissiveIntensity = 6 * flick * lit
    })
    this.lampLights.forEach((light, i) => {
      const lamp = lamps[i]
      if (!lamp) {
        light.intensity = 0
        return
      }
      light.position.copy(lamp.position)
      const n = Math.sin(time * 9 + lamp.phase) * Math.sin(time * 23.7 + lamp.phase * 2)
      light.intensity = (n > 0.82 ? 1.5 : 9) * lit
    })
    if (this.activeRound) this.signLight.position.copy(this.activeRound.signPosition)
    this.signLight.intensity = signLevel * 10 * lit

    for (const round of track.rounds) {
      for (const gate of round.gates) {
        for (const icon of gate.icons) icon.mat.emissiveIntensity = this.blackout ? 0.15 + this.flash * 1.8 : 2.6
      }
    }
  }

  update(dt: number, time: number, playerZ: number, playerX = 0) {
    this.sky.uniforms.uTime.value = time
    this.city.update(time)
    for (const layer of this.fogLayers) layer.texture.offset.addScaledVector(layer.speed, dt)
    this.updateLightning(dt)
    if (this.track) {
      for (const round of this.track.rounds) {
        round.sign.update(dt, time)
        round.fakeSign?.update(dt, time)
      }
    }
    this.doorFlash = Math.max(0, this.doorFlash - dt * 3.5)
    this.doorLight.intensity = this.doorFlash * this.doorFlash * 40
    this.updateLights(time, playerZ, this.activeRound ? this.activeRound.sign.intensity : 0)
    this.sky.mesh.position.copy(this.camera.position)
    // The city and fog drift along with the runner so the endless run never leaves them behind;
    // the slight lag keeps some parallax.
    this.city.group.position.z = playerZ * 0.92
    this.city.group.position.x = playerX * 0.92
    this.coaster?.updateBeacons(time, this.blackout ? 0.2 : 1)
    const fog = this.scene.fog as THREE.FogExp2
    if (this.coaster) {
      fog.density = THREE.MathUtils.lerp(0.0031, 0.085, this.mist * this.mist)
      fog.color.setRGB(0.043 + this.mist * 0.16, 0.059 + this.mist * 0.17, 0.082 + this.mist * 0.18)
      this.renderer.setClearColor(fog.color)
    } else if (fog.density !== 0.0031) {
      fog.density = 0.0031
      fog.color.set(0x0b0f15)
      this.renderer.setClearColor(0x05070a)
    }
    for (const layer of this.fogLayers) {
      layer.mesh.position.x = this.camera.position.x
      layer.mesh.position.z = this.camera.position.z
    }
  }

  render(time: number, stress: number, fade: number) {
    if (!this.post.render(time, stress, fade, this.flash)) {
      this.renderer.toneMappingExposure = 1.05 * (1 - fade)
      this.renderer.render(this.scene, this.camera)
    }
  }

  dispose() {
    this.resizeObserver.disconnect()
    this.track?.dispose()
    this.coaster?.dispose()
    this.runner.dispose()
    this.post.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
