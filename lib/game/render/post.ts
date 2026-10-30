import * as THREE from 'three'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { TierConfig } from '../quality'

/** Film grain, vignette, stress-driven chromatic aberration and fade, applied in display space. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uStress: { value: 0 },
    uFade: { value: 0 },
    uGrain: { value: 0.06 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uStress;
uniform float uFade;
uniform float uGrain;
varying vec2 vUv;
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 c = vUv - 0.5;
  float dist = length(c);
  float ca = uStress * 0.012 * dist;
  vec3 col;
  col.r = texture2D(tDiffuse, vUv - c * ca * 2.0).r;
  col.g = texture2D(tDiffuse, vUv).g;
  col.b = texture2D(tDiffuse, vUv + c * ca * 2.0).b;
  float vig = smoothstep(0.85 - uStress * 0.25, 0.2 - uStress * 0.1, dist);
  col *= mix(0.25, 1.0, vig);
  col += (rand(vUv * 731.0 + fract(uTime * 13.0)) - 0.5) * uGrain;
  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
}`,
}

export class PostPipeline {
  composer: EffectComposer | null = null
  private finish: ShaderPass | null = null
  private bloom: UnrealBloomPass | null = null
  private bokeh: BokehPass | null = null

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {}

  configure(config: TierConfig, width: number, height: number) {
    this.dispose()
    if (!config.postprocessing) return
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: config.maxPixelRatio >= 2 ? 4 : 0,
    })
    const composer = new EffectComposer(this.renderer, target)
    composer.addPass(new RenderPass(this.scene, this.camera))
    if (config.dof) {
      // Keep the walkway sharp and soften the city far below.
      this.bokeh = new BokehPass(this.scene, this.camera, { focus: 9, aperture: 0.00012, maxblur: 0.004 })
      composer.addPass(this.bokeh)
    }
    if (config.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(Math.round(width * config.bloomScale), Math.round(height * config.bloomScale)),
        0.75,
        0.55,
        0.82,
      )
      composer.addPass(this.bloom)
    }
    composer.addPass(new OutputPass())
    this.finish = new ShaderPass(FinishShader)
    composer.addPass(this.finish)
    this.composer = composer
  }

  setSize(width: number, height: number, pixelRatio: number) {
    if (!this.composer) return
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
  }

  render(time: number, stress: number, fade: number, flash: number) {
    if (!this.composer || !this.finish) return false
    this.finish.uniforms.uTime.value = time
    this.finish.uniforms.uStress.value = stress
    this.finish.uniforms.uFade.value = fade
    if (this.bloom) this.bloom.strength = 0.7 + flash * 0.8 + stress * 0.25
    this.composer.render()
    return true
  }

  dispose() {
    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose?.()
      this.composer.dispose()
    }
    this.composer = null
    this.finish = null
    this.bloom = null
    this.bokeh = null
  }
}
