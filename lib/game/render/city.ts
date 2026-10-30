import * as THREE from 'three'
import { MAX_BUILDINGS, MAX_VEHICLES } from '../quality'
import { makeWindowTile } from './textures'

export const GROUND_Y = -340
const BLOCK = 30
const EXTENT = 720

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function createBuildings() {
  const rand = rng(1337)
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.translate(0, 0.5, 0)

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.4,
    emissive: 0xffffff,
    emissiveIntensity: 2.2,
    emissiveMap: makeWindowTile(),
    envMapIntensity: 0.6,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aScale;
attribute float aSeed;
varying vec2 vWinUv;
varying float vSeed;
varying float vRoof;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float side = abs(objectNormal.x) > 0.5 ? aScale.z : aScale.x;
vWinUv = uv * vec2(side / 3.2, aScale.y / 3.6);
vSeed = aSeed;
vRoof = step(0.5, abs(objectNormal.y));`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vWinUv;
varying float vSeed;
varying float vRoof;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `vec2 cell = floor(vWinUv);
float h = fract(sin(dot(cell + vSeed * 31.7, vec2(12.9898, 78.233))) * 43758.5453);
float floorBand = fract(sin((cell.y + vSeed * 7.0) * 91.3) * 3758.5);
float lit = step(0.58 - floorBand * 0.25, h);
vec3 winCol = mix(vec3(1.0, 0.72, 0.42), vec3(0.62, 0.78, 1.0), step(0.86, h));
vec4 em = texture2D(emissiveMap, vWinUv);
totalEmissiveRadiance *= em.rgb * winCol * lit * (1.0 - vRoof) * (0.35 + h * 0.9);`,
      )
  }

  const mesh = new THREE.InstancedMesh(geometry, material, MAX_BUILDINGS)
  const scales = new Float32Array(MAX_BUILDINGS * 3)
  const seeds = new Float32Array(MAX_BUILDINGS)
  const color = new THREE.Color()
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()

  const lots: { x: number; z: number; d: number }[] = []
  for (let gx = -EXTENT; gx <= EXTENT; gx += BLOCK) {
    for (let gz = -EXTENT; gz <= EXTENT; gz += BLOCK) {
      const x = gx + BLOCK / 2
      const z = gz + BLOCK / 2
      lots.push({ x, z, d: Math.hypot(x, z * 0.8) + rand() * 40 })
    }
  }
  // Nearest first, so lower tiers simply render fewer instances.
  lots.sort((a, b) => a.d - b.d)

  let count = 0
  for (const lot of lots) {
    if (count >= MAX_BUILDINGS) break
    if (rand() < 0.08) continue
    const w = 9 + rand() * 13
    const dpt = 9 + rand() * 13
    const nearCorridor = Math.abs(lot.x) < 40 && lot.z < 30 && lot.z > -160
    const tall = rand() < 0.12
    let h = tall ? 160 + rand() * 140 : 25 + Math.pow(rand(), 1.6) * 140
    // Keep the drop beneath the walkway deep and clear.
    if (nearCorridor) h = Math.min(h, 90 + rand() * 50)
    h = Math.min(h, -GROUND_Y - 45)
    const ox = (rand() - 0.5) * (BLOCK - 8 - w) * 0.5
    const oz = (rand() - 0.5) * (BLOCK - 8 - dpt) * 0.5
    m.compose(new THREE.Vector3(lot.x + ox, GROUND_Y, lot.z + oz), q, new THREE.Vector3(w, h, dpt))
    mesh.setMatrixAt(count, m)
    scales.set([w, h, dpt], count * 3)
    seeds[count] = rand() * 100
    const tone = 0.05 + rand() * 0.08
    color.setRGB(tone, tone * 1.03, tone * 1.12)
    mesh.setColorAt(count, color)
    count++
  }
  geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 3))
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.frustumCulled = false
  return { mesh, total: count }
}

function createStreets() {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, size, size)
  const street = (size * 8) / BLOCK
  ctx.fillStyle = '#1a120b'
  ctx.fillRect(0, 0, size, street / 2)
  ctx.fillRect(0, size - street / 2, size, street / 2)
  ctx.fillRect(0, 0, street / 2, size)
  ctx.fillRect(size - street / 2, 0, street / 2, size)
  ctx.fillStyle = '#ff9a3c'
  for (let i = 4; i < size; i += 16) {
    ctx.fillRect(i, street / 2 - 1, 2, 2)
    ctx.fillRect(street / 2 - 1, i, 2, 2)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set((EXTENT * 2) / BLOCK, (EXTENT * 2) / BLOCK)
  tex.offset.set(0.0, 0.0)
  tex.anisotropy = 8
  const material = new THREE.MeshStandardMaterial({
    color: 0x0b0b0c,
    roughness: 0.3,
    metalness: 0,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 1.6,
  })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2), material)
  plane.rotation.x = -Math.PI / 2
  plane.position.set(0, GROUND_Y, 0)
  // Align texture block edges with street lines at multiples of BLOCK.
  tex.offset.set(0.5 - (EXTENT % BLOCK) / BLOCK, 0.5 - (EXTENT % BLOCK) / BLOCK)
  return plane
}

function createVehicles() {
  const rand = rng(99)
  const lanes = new Float32Array(MAX_VEHICLES)
  const axis = new Float32Array(MAX_VEHICLES)
  const speed = new Float32Array(MAX_VEHICLES)
  const offset = new Float32Array(MAX_VEHICLES)
  const colors = new Float32Array(MAX_VEHICLES * 3)
  const positions = new Float32Array(MAX_VEHICLES * 3)
  for (let i = 0; i < MAX_VEHICLES; i++) {
    const street = Math.round((rand() * 2 - 1) * (EXTENT / BLOCK)) * BLOCK
    const dir = rand() < 0.5 ? 1 : -1
    lanes[i] = street + dir * 1.8
    axis[i] = rand() < 0.5 ? 0 : 1
    speed[i] = dir * (8 + rand() * 14)
    offset[i] = rand() * EXTENT * 2
    // Moving toward the camera shows headlights, away shows tail lights.
    const head = dir > 0
    colors.set(head ? [1, 0.92, 0.75] : [1, 0.12, 0.05], i * 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aLane', new THREE.BufferAttribute(lanes, 1))
  geometry.setAttribute('aAxis', new THREE.BufferAttribute(axis, 1))
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1))
  geometry.setAttribute('aOffset', new THREE.BufferAttribute(offset, 1))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGround: { value: GROUND_Y + 0.8 }, uExtent: { value: EXTENT }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
attribute float aLane; attribute float aAxis; attribute float aSpeed; attribute float aOffset; attribute vec3 aColor;
uniform float uTime; uniform float uGround; uniform float uExtent; uniform float uScale;
varying vec3 vColor; varying float vFade;
void main() {
  float t = mod(aOffset + uTime * aSpeed, uExtent * 2.0) - uExtent;
  vec3 p = aAxis < 0.5 ? vec3(t, uGround, aLane) : vec3(aLane, uGround, t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uScale * 900.0 / -mv.z, 1.0, 6.0);
  vFade = exp(-length(mv.xyz) * 0.0019);
  vColor = aColor;
}`,
    fragmentShader: /* glsl */ `
varying vec3 vColor; varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * a * vFade * 3.0, a * vFade);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return { points, uniforms: material.uniforms }
}

export function createCity() {
  const group = new THREE.Group()
  const buildings = createBuildings()
  const streets = createStreets()
  const vehicles = createVehicles()
  group.add(buildings.mesh, streets, vehicles.points)
  return {
    group,
    setBudget(buildingCount: number, vehicleCount: number, pixelRatio: number) {
      buildings.mesh.count = Math.min(buildingCount, buildings.total)
      vehicles.points.geometry.setDrawRange(0, vehicleCount)
      vehicles.points.visible = vehicleCount > 0
      vehicles.uniforms.uScale.value = pixelRatio
    },
    update(time: number) {
      vehicles.uniforms.uTime.value = time
    },
  }
}
