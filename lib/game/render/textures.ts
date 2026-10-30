import * as THREE from 'three'

/** Seeded PRNG so textures are identical between sessions. */
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

/** Tileable fractal value noise sampled into a Float32Array of size*size. */
function fbm(size: number, seed: number, octaves = 5, baseCells = 4) {
  const rand = mulberry32(seed)
  const out = new Float32Array(size * size)
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o
    const lattice = new Float32Array(cells * cells)
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells
      const y0 = Math.floor(fy)
      const ty = fy - y0
      const sy = ty * ty * (3 - 2 * ty)
      const y1 = (y0 + 1) % cells
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const x0 = Math.floor(fx)
        const tx = fx - x0
        const sx = tx * tx * (3 - 2 * tx)
        const x1 = (x0 + 1) % cells
        const a = lattice[y0 * cells + x0]
        const b = lattice[y0 * cells + x1]
        const c = lattice[y1 * cells + x0]
        const d = lattice[y1 * cells + x1]
        out[y * size + x] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp
      }
    }
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

function canvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  return { c, ctx }
}

function texture(c: HTMLCanvasElement, srgb: boolean, repeat = 1) {
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

function normalFromHeight(height: Float32Array, size: number, strength: number) {
  const { c, ctx } = canvas(size)
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)]
      const r = height[y * size + ((x + 1) % size)]
      const u = height[((y - 1 + size) % size) * size + x]
      const d = height[((y + 1) % size) * size + x]
      const nx = (l - r) * strength
      const ny = (u - d) * strength
      const len = Math.hypot(nx, ny, 1)
      const i = (y * size + x) * 4
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export interface PBRSet {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
}

/** Wet, rusty painted steel. */
export function makeSteel(size: number, seed = 7): PBRSet {
  const rust = fbm(size, seed, 5, 4)
  const grain = fbm(size, seed + 11, 3, 32)
  const height = new Float32Array(size * size)
  const color = canvas(size)
  const rough = canvas(size)
  const cimg = color.ctx.createImageData(size, size)
  const rimg = rough.ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const r = Math.min(1, Math.max(0, (rust[i] - 0.48) * 4))
    const streak = grain[i]
    const base = 0.16 + streak * 0.06
    const p = i * 4
    // Gunmetal paint blending into orange-brown rust.
    cimg.data[p] = (base + r * 0.32) * 255
    cimg.data[p + 1] = (base + 0.01 + r * 0.13) * 255
    cimg.data[p + 2] = (base + 0.03 + r * 0.02) * 255
    cimg.data[p + 3] = 255
    // Rust is rough; wet paint is glossy.
    const roughness = 0.28 + r * 0.6 + streak * 0.1
    rimg.data[p] = rimg.data[p + 1] = rimg.data[p + 2] = Math.min(1, roughness) * 255
    rimg.data[p + 3] = 255
    height[i] = r * 0.6 + streak * 0.4
  }
  color.ctx.putImageData(cimg, 0, 0)
  rough.ctx.putImageData(rimg, 0, 0)
  return {
    map: texture(color.c, true),
    roughnessMap: texture(rough.c, false),
    normalMap: texture(normalFromHeight(height, size, 6), false),
  }
}

/** Open steel grating with alpha holes so you can see the drop through the floor. */
export function makeGrating(size: number): PBRSet & { alphaMap: THREE.Texture } {
  const cells = 8
  const bar = size / cells
  const rust = fbm(size, 3, 4, 4)
  const color = canvas(size)
  const rough = canvas(size)
  const alpha = canvas(size)
  const height = new Float32Array(size * size)
  const cimg = color.ctx.createImageData(size, size)
  const rimg = rough.ctx.createImageData(size, size)
  const aimg = alpha.ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const p = i * 4
      const bx = (x % bar) / bar
      const by = (y % (bar * 0.5)) / (bar * 0.5)
      const bearing = bx < 0.22
      const cross = by < 0.16
      const solid = bearing || cross
      const r = Math.min(1, Math.max(0, (rust[i] - 0.5) * 3.5))
      const edge = bearing ? 1 - Math.abs(bx / 0.22 - 0.5) * 2 : 1 - Math.abs(by / 0.16 - 0.5) * 2
      const shade = 0.22 + edge * 0.12
      cimg.data[p] = (shade + r * 0.25) * 255
      cimg.data[p + 1] = (shade + r * 0.1) * 255
      cimg.data[p + 2] = (shade + 0.02) * 255
      cimg.data[p + 3] = 255
      rimg.data[p] = rimg.data[p + 1] = rimg.data[p + 2] = (0.35 + r * 0.5) * 255
      rimg.data[p + 3] = 255
      aimg.data[p] = aimg.data[p + 1] = aimg.data[p + 2] = solid ? 255 : 0
      aimg.data[p + 3] = 255
      height[i] = solid ? 0.4 + edge * 0.6 : 0
    }
  }
  color.ctx.putImageData(cimg, 0, 0)
  rough.ctx.putImageData(rimg, 0, 0)
  alpha.ctx.putImageData(aimg, 0, 0)
  return {
    map: texture(color.c, true),
    roughnessMap: texture(rough.c, false),
    alphaMap: texture(alpha.c, false),
    normalMap: texture(normalFromHeight(height, size, 3), false),
  }
}

/** Single lit window per tile; the building shader randomizes which ones are on. */
export function makeWindowTile() {
  const size = 64
  const { c, ctx } = canvas(size)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)
  const grad = ctx.createLinearGradient(0, 14, 0, 50)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(1, '#9a9a9a')
  ctx.fillStyle = grad
  ctx.fillRect(14, 14, 36, 34)
  ctx.fillStyle = '#000'
  ctx.fillRect(31, 14, 2, 34)
  const tex = texture(c, true)
  tex.anisotropy = 1
  return tex
}

export function makeHazardStripes() {
  const size = 128
  const { c, ctx } = canvas(size)
  ctx.fillStyle = '#d9a514'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#111'
  for (let i = -size; i < size * 2; i += 32) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + 16, 0)
    ctx.lineTo(i + 16 - size, size)
    ctx.lineTo(i - size, size)
    ctx.closePath()
    ctx.fill()
  }
  const dirt = fbm(size, 21, 4, 4)
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < size * size; i++) {
    const k = 0.55 + dirt[i] * 0.45
    img.data[i * 4] *= k
    img.data[i * 4 + 1] *= k
    img.data[i * 4 + 2] *= k
  }
  ctx.putImageData(img, 0, 0)
  return texture(c, true)
}

/** Soft cloudy alpha for the layered fog planes. */
export function makeFogTexture(size: number) {
  const n = fbm(size, 99, 5, 3)
  const { c, ctx } = canvas(size)
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const v = Math.min(1, Math.max(0, (n[i] - 0.35) * 2.2))
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = v * 255
  }
  ctx.putImageData(img, 0, 0)
  return texture(c, false)
}

export function makeConcrete(size: number): PBRSet {
  const n = fbm(size, 41, 5, 6)
  const color = canvas(size)
  const rough = canvas(size)
  const cimg = color.ctx.createImageData(size, size)
  const rimg = rough.ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const v = 0.2 + n[i] * 0.16
    cimg.data[i * 4] = v * 255
    cimg.data[i * 4 + 1] = v * 255
    cimg.data[i * 4 + 2] = (v + 0.015) * 255
    cimg.data[i * 4 + 3] = 255
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = (0.75 + n[i] * 0.2) * 255
    rimg.data[i * 4 + 3] = 255
  }
  color.ctx.putImageData(cimg, 0, 0)
  rough.ctx.putImageData(rimg, 0, 0)
  return {
    map: texture(color.c, true),
    roughnessMap: texture(rough.c, false),
    normalMap: texture(normalFromHeight(n, size, 4), false),
  }
}
