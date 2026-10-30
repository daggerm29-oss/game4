import type { Tier } from './store'

export interface TierConfig {
  maxPixelRatio: number
  minPixelRatio: number
  targetFps: number
  buildings: number
  vehicles: number
  postprocessing: boolean
  bloom: boolean
  bloomScale: number
  dof: boolean
  textureSize: number
  fogLayers: number
  rivets: boolean
  pointLights: number
}

export const TIERS: Record<Tier, TierConfig> = {
  low: {
    maxPixelRatio: 1,
    minPixelRatio: 0.6,
    targetFps: 30,
    buildings: 380,
    vehicles: 0,
    postprocessing: false,
    bloom: false,
    bloomScale: 0.25,
    dof: false,
    textureSize: 128,
    fogLayers: 1,
    rivets: false,
    pointLights: 2,
  },
  medium: {
    maxPixelRatio: 1.5,
    minPixelRatio: 0.75,
    targetFps: 50,
    buildings: 900,
    vehicles: 700,
    postprocessing: true,
    bloom: true,
    bloomScale: 0.35,
    dof: false,
    textureSize: 256,
    fogLayers: 2,
    rivets: true,
    pointLights: 3,
  },
  high: {
    maxPixelRatio: 2,
    minPixelRatio: 1,
    targetFps: 58,
    buildings: 1600,
    vehicles: 1800,
    postprocessing: true,
    bloom: true,
    bloomScale: 0.5,
    dof: true,
    textureSize: 512,
    fogLayers: 3,
    rivets: true,
    pointLights: 4,
  },
}

export const MAX_BUILDINGS = TIERS.high.buildings
export const MAX_VEHICLES = TIERS.high.vehicles

/** First guess from hardware hints; refined by a short in-scene benchmark. */
export function guessTier(gl: WebGLRenderingContext | WebGL2RenderingContext): Tier {
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  let gpu = ''
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase()
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent)

  const weakGpu =
    /mali-(t|g3|g5[0-2])|adreno \(tm\) [2-5]\d\d|adreno [2-5]\d\d|powervr|sgx|swiftshader|llvmpipe|intel\(r\) hd graphics [2-5]/.test(
      gpu,
    )
  if (weakGpu || memory <= 2 || cores <= 4) return 'low'
  if (mobile) {
    const strong = /adreno.*(7[3-9]\d|8\d\d)|apple|mali-g7[1-9]|mali-g[6-9]1[0-9]|immortalis|xclipse/.test(gpu)
    return strong && memory >= 6 ? 'high' : 'medium'
  }
  return memory >= 8 && cores >= 8 ? 'high' : 'medium'
}

export function downgrade(tier: Tier): Tier {
  return tier === 'high' ? 'medium' : 'low'
}

/** FPS-aware resolution scaling: nudges the pixel ratio to stay near the tier's target frame rate. */
export class ResolutionScaler {
  private frames = 0
  private elapsed = 0
  fps = 60
  pixelRatio: number
  slowStreak = 0

  constructor(private config: TierConfig) {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, config.maxPixelRatio)
  }

  setConfig(config: TierConfig) {
    this.config = config
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, config.maxPixelRatio)
    this.slowStreak = 0
  }

  /** Returns a new pixel ratio when it should change, otherwise null. */
  sample(dt: number): number | null {
    this.frames += 1
    this.elapsed += dt
    if (this.elapsed < 1) return null
    this.fps = this.frames / this.elapsed
    this.frames = 0
    this.elapsed = 0
    const { targetFps, minPixelRatio, maxPixelRatio } = this.config
    const ceiling = Math.min(window.devicePixelRatio || 1, maxPixelRatio)
    let next = this.pixelRatio
    if (this.fps < targetFps * 0.9) {
      next = Math.max(minPixelRatio, this.pixelRatio - (this.fps < targetFps * 0.6 ? 0.2 : 0.1))
      this.slowStreak = next === minPixelRatio ? this.slowStreak + 1 : 0
    } else if (this.fps > targetFps * 1.02 && this.pixelRatio < ceiling) {
      next = Math.min(ceiling, this.pixelRatio + 0.05)
      this.slowStreak = 0
    } else {
      this.slowStreak = 0
    }
    if (Math.abs(next - this.pixelRatio) < 0.001) return null
    this.pixelRatio = next
    return next
  }
}
