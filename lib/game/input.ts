/** Meters of lateral movement for a drag across the full screen width. */
const DRAG_METERS_PER_SCREEN = 7.5
/** Lateral speed while A / D / arrow keys are held, meters per second. */
const KEY_STEER_SPEED = 6.5

/**
 * Steering input for the runner. Drag or swipe anywhere moves the steering target sideways
 * (1:1 with the finger), A / D / arrow keys slide it while held. The game applies inertia.
 */
export class Input {
  private keys = new Set<string>()
  private pointer: { id: number; lastX: number } | null = null
  private pendingDelta = 0
  /** Total meters steered, used to hide the level-1 hint once the player gets it. */
  steeredDistance = 0
  onAnyGesture: (() => void) | null = null
  private cleanup: (() => void)[] = []

  attach(el: HTMLElement) {
    const onKeyDown = (e: KeyboardEvent) => {
      this.onAnyGesture?.()
      this.keys.add(e.code)
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code)
    const onBlur = () => {
      this.keys.clear()
      this.pointer = null
    }

    const onPointerDown = (e: PointerEvent) => {
      this.onAnyGesture?.()
      if (this.pointer) return
      this.pointer = { id: e.pointerId, lastX: e.clientX }
      el.setPointerCapture?.(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!this.pointer || this.pointer.id !== e.pointerId) return
      const dx = e.clientX - this.pointer.lastX
      this.pointer.lastX = e.clientX
      this.pendingDelta += (dx / Math.max(el.clientWidth, 280)) * DRAG_METERS_PER_SCREEN
    }
    const onPointerUp = (e: PointerEvent) => {
      if (this.pointer?.id === e.pointerId) this.pointer = null
    }

    // Stops pull-to-refresh, pinch zoom and overscroll inside the Telegram webview.
    const preventTouch = (e: TouchEvent) => {
      if (e.touches.length > 1 || (e.target as HTMLElement)?.closest?.('[data-scrollable]') === null) e.preventDefault()
    }
    const preventGesture = (e: Event) => e.preventDefault()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    document.addEventListener('touchmove', preventTouch, { passive: false })
    document.addEventListener('gesturestart', preventGesture)

    this.cleanup.push(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('touchmove', preventTouch)
      document.removeEventListener('gesturestart', preventGesture)
    })
  }

  /** Lateral steering delta (meters) accumulated since the last call. */
  consumeSteer(dt: number) {
    let delta = this.pendingDelta
    this.pendingDelta = 0
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft')
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight')
    if (left !== right) delta += (right ? 1 : -1) * KEY_STEER_SPEED * dt
    this.steeredDistance += Math.abs(delta)
    return delta
  }

  /** Drops any input gathered while the runner could not steer. */
  flush() {
    this.pendingDelta = 0
  }

  dispose() {
    this.cleanup.forEach((fn) => fn())
    this.cleanup = []
  }
}
