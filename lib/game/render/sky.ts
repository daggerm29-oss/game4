import * as THREE from 'three'

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashDir;
uniform float uIntensity;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zenith = vec3(0.012, 0.016, 0.03);
  vec3 horizon = vec3(0.07, 0.08, 0.1);
  // Sodium light pollution bleeding up from the city.
  vec3 cityGlow = vec3(0.32, 0.17, 0.07);
  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
  col += cityGlow * pow(1.0 - clamp(abs(h + 0.03), 0.0, 1.0), 9.0) * 0.6;
  col = mix(col, vec3(0.03, 0.03, 0.035), smoothstep(0.0, -0.25, h));

  vec2 drift = vec2(uTime * 0.004, uTime * 0.0015);
  vec3 cp = vec3(d.x / max(h + 0.25, 0.08), d.z / max(h + 0.25, 0.08), 0.0) * 1.3;
  cp.xy += drift;
  float clouds = fbm(cp + vec3(0.0, 0.0, uTime * 0.01));
  float cover = smoothstep(0.35, 0.8, clouds) * smoothstep(-0.05, 0.2, h);
  vec3 cloudCol = mix(vec3(0.05, 0.055, 0.07), vec3(0.13, 0.11, 0.1), clouds);
  col = mix(col, cloudCol, cover * 0.9);

  float toFlash = max(dot(d, normalize(uFlashDir)), 0.0);
  float flashGlow = uFlash * (pow(toFlash, 6.0) * 3.5 + 0.35) * (0.4 + clouds);
  col += vec3(0.7, 0.75, 1.0) * flashGlow;

  gl_FragColor = vec4(col * uIntensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function createSky() {
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(0.3, 0.6, -1) },
      uIntensity: { value: 1 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material)
  mesh.scale.setScalar(3000)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  return { mesh, uniforms: material.uniforms as Record<'uTime' | 'uFlash' | 'uIntensity', { value: number }> & { uFlashDir: { value: THREE.Vector3 } } }
}

/** Bakes the storm sky into a PMREM HDR environment for PBR reflections. */
export function bakeEnvironment(renderer: THREE.WebGLRenderer) {
  const sky = createSky()
  sky.uniforms.uIntensity.value = 4
  sky.mesh.scale.setScalar(100)
  const scene = new THREE.Scene()
  scene.add(sky.mesh)
  // A few warm "work lamp" panels give the steel some highlights to catch.
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.5, 3) })
  for (const [x, y, z] of [
    [30, 20, -40],
    [-50, 15, 10],
    [10, 40, 60],
  ]) {
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), lampMat)
    lamp.position.set(x, y, z)
    lamp.lookAt(0, 0, 0)
    scene.add(lamp)
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(scene, 0.02)
  pmrem.dispose()
  sky.mesh.geometry.dispose()
  ;(sky.mesh.material as THREE.Material).dispose()
  lampMat.dispose()
  return target.texture
}
