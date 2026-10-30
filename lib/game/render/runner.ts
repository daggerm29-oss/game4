import * as THREE from 'three'

const LINKS = 26
const LINK_LENGTH = 0.16
const GRAVITY = -14
const FLOOR_Y = 0.035

function limb(w: number, h: number, d: number, mat: THREE.Material) {
  const pivot = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  mesh.position.y = -h / 2
  mesh.castShadow = false
  pivot.add(mesh)
  return { pivot, mesh }
}

/**
 * Low-poly chained runner: a prisoner in an orange jumpsuit with a heavy chain
 * shackled to the waist, simulated as a verlet rope that drags on the deck and sways on steering.
 */
export class Runner {
  group = new THREE.Group()
  private body = new THREE.Group()
  private legs: THREE.Group[] = []
  private arms: THREE.Group[] = []
  private head: THREE.Mesh
  private phase = 0
  private materials: THREE.Material[] = []
  private geometries: THREE.BufferGeometry[] = []

  private chain: THREE.InstancedMesh
  private points: THREE.Vector3[] = []
  private prev: THREE.Vector3[] = []
  private anchor = new THREE.Vector3()
  private tmp = new THREE.Vector3()
  private matrix = new THREE.Matrix4()
  private quat = new THREE.Quaternion()
  private up = new THREE.Vector3(0, 1, 0)
  private twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  private chainScene: THREE.Object3D | null = null

  constructor() {
    const suit = new THREE.MeshStandardMaterial({ color: 0xc4521c, roughness: 0.82, metalness: 0 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.7, metalness: 0.2 })
    const skin = new THREE.MeshStandardMaterial({ color: 0x9c6b50, roughness: 0.7 })
    const steel = new THREE.MeshStandardMaterial({ color: 0x8b9099, roughness: 0.35, metalness: 0.95 })
    this.materials.push(suit, dark, skin, steel)

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.26), suit)
    torso.position.y = 1.22
    this.body.add(torso)
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.28), dark)
    belt.position.y = 0.93
    this.body.add(belt)
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 12), steel)
    shackle.position.set(0, 0.93, 0.16)
    this.body.add(shackle)
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), skin)
    this.head.position.y = 1.68
    this.body.add(this.head)
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark)
    hair.position.y = 1.7
    this.body.add(hair)

    for (const side of [-1, 1]) {
      const leg = limb(0.15, 0.86, 0.16, suit)
      leg.pivot.position.set(side * 0.12, 0.9, 0)
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.26), dark)
      boot.position.set(0, -0.86, -0.04)
      leg.pivot.add(boot)
      this.body.add(leg.pivot)
      this.legs.push(leg.pivot)

      const arm = limb(0.11, 0.6, 0.12, suit)
      arm.pivot.position.set(side * 0.29, 1.5, 0)
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), skin)
      hand.position.y = -0.64
      arm.pivot.add(hand)
      this.body.add(arm.pivot)
      this.arms.push(arm.pivot)
    }
    this.group.add(this.body)

    const linkGeo = new THREE.TorusGeometry(0.05, 0.014, 5, 10)
    linkGeo.scale(1, 1.55, 1)
    this.geometries.push(linkGeo)
    this.chain = new THREE.InstancedMesh(linkGeo, steel, LINKS)
    this.chain.frustumCulled = false
    for (let i = 0; i < LINKS; i++) {
      this.points.push(new THREE.Vector3(0, FLOOR_Y, i * LINK_LENGTH))
      this.prev.push(new THREE.Vector3(0, FLOOR_Y, i * LINK_LENGTH))
    }
  }

  /** The chain is simulated in world space, so it lives directly in the scene. */
  attach(scene: THREE.Object3D) {
    scene.add(this.group)
    scene.add(this.chain)
    this.chainScene = scene
  }

  /** Snaps the chain behind the runner, e.g. at the start of a run. */
  reset(x: number, z: number) {
    for (let i = 0; i < LINKS; i++) {
      const p = this.points[i].set(x, i === 0 ? 0.93 : FLOOR_Y, z + 0.16 + i * LINK_LENGTH)
      this.prev[i].copy(p)
    }
  }

  /**
   * @param speed forward speed (m/s) drives the run cycle
   * @param lateral lateral velocity (m/s) drives lean
   * @param airborne true while falling, which flails the limbs
   * @param floorAt returns whether there is deck under a world position
   */
  update(dt: number, x: number, y: number, z: number, speed: number, lateral: number, airborne: boolean, floorAt: (x: number, z: number) => boolean) {
    this.group.position.set(x, y, z)
    const run = Math.min(1, speed / 6)
    this.phase += dt * (airborne ? 9 : 3.2 + speed * 1.05)
    const swing = Math.sin(this.phase)
    if (airborne) {
      this.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(this.phase + i * 2) * 0.9))
      this.arms.forEach((arm, i) => {
        arm.rotation.x = -2.4 + Math.sin(this.phase * 1.3 + i) * 0.6
        arm.rotation.z = (i === 0 ? -1 : 1) * 0.5
      })
      this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, -0.6, 1 - Math.exp(-dt * 3))
    } else {
      this.legs[0].rotation.x = swing * 0.95 * run
      this.legs[1].rotation.x = -swing * 0.95 * run
      this.arms[0].rotation.x = -swing * 0.85 * run
      this.arms[1].rotation.x = swing * 0.85 * run
      this.arms.forEach((arm, i) => (arm.rotation.z = (i === 0 ? -1 : 1) * 0.08))
      this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.07 * run
      this.body.rotation.x = -0.18 * run
    }
    this.body.rotation.z = THREE.MathUtils.clamp(-lateral * 0.06, -0.35, 0.35)
    this.body.rotation.y = THREE.MathUtils.clamp(lateral * 0.04, -0.3, 0.3)

    this.simulateChain(dt, floorAt)
  }

  private simulateChain(dt: number, floorAt: (x: number, z: number) => boolean) {
    // Anchor at the shackle on the runner's back.
    this.anchor.set(0, 0.93, 0.16)
    this.body.localToWorld(this.anchor)
    const steps = 2
    const h = Math.min(dt, 0.033) / steps
    for (let step = 0; step < steps; step++) {
      for (let i = 1; i < LINKS; i++) {
        const p = this.points[i]
        const q = this.prev[i]
        const onFloor = p.y <= FLOOR_Y + 0.002 && floorAt(p.x, p.z)
        const friction = onFloor ? 0.82 : 0.995
        this.tmp.subVectors(p, q).multiplyScalar(friction)
        q.copy(p)
        p.add(this.tmp)
        p.y += GRAVITY * h * h
        if (p.y < FLOOR_Y && floorAt(p.x, p.z)) p.y = FLOOR_Y
      }
      this.points[0].copy(this.anchor)
      this.prev[0].copy(this.anchor)
      for (let iter = 0; iter < 4; iter++) {
        for (let i = 0; i < LINKS - 1; i++) {
          const a = this.points[i]
          const b = this.points[i + 1]
          this.tmp.subVectors(b, a)
          const len = this.tmp.length() || 1e-4
          const diff = (len - LINK_LENGTH) / len
          if (i === 0) b.addScaledVector(this.tmp, -diff)
          else {
            a.addScaledVector(this.tmp, diff * 0.5)
            b.addScaledVector(this.tmp, -diff * 0.5)
          }
        }
      }
    }

    for (let i = 0; i < LINKS; i++) {
      const a = this.points[i]
      const b = this.points[Math.min(LINKS - 1, i + 1)]
      this.tmp.subVectors(b, a)
      if (this.tmp.lengthSq() < 1e-8) this.tmp.set(0, 0, 1)
      this.quat.setFromUnitVectors(this.up, this.tmp.normalize())
      if (i % 2 === 1) this.quat.multiply(this.twist)
      this.matrix.compose(this.tmp.copy(a).lerp(b, 0.5), this.quat, new THREE.Vector3(1, 1, 1))
      this.chain.setMatrixAt(i, this.matrix)
    }
    this.chain.instanceMatrix.needsUpdate = true
  }

  setVisible(visible: boolean) {
    this.group.visible = visible
    this.chain.visible = visible
  }

  dispose() {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.dispose()
    })
    this.geometries.forEach((g) => g.dispose())
    this.materials.forEach((m) => m.dispose())
    this.chain.dispose()
    this.group.removeFromParent()
    this.chain.removeFromParent()
    void this.chainScene
  }
}
