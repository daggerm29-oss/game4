/**
 * Fully procedural Web Audio soundscape: no external samples, so nothing to license.
 * Graph: sources -> bus -> muffle (lowpass) -> compressor -> master -> destination.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private muffle!: BiquadFilterNode
  private bus!: GainNode
  private noise!: AudioBuffer
  private brown!: AudioBuffer
  private windGains: GainNode[] = []
  private whistle!: BiquadFilterNode
  private fallGain!: GainNode
  private fallFilter!: BiquadFilterNode
  private heartbeatTimer = 0
  private creakTimer = 0
  private heartRate = 0
  private windLevel = 0.4
  private muted = false

  get ready() {
    return this.ctx !== null
  }

  /** Must be called from a user gesture (Telegram webviews enforce autoplay rules). */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor({ latencyHint: 'interactive' })
    this.ctx = ctx

    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.9
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 4
    this.muffle = ctx.createBiquadFilter()
    this.muffle.type = 'lowpass'
    this.muffle.frequency.value = 18000
    this.muffle.Q.value = 0.5
    this.bus = ctx.createGain()
    this.bus.connect(this.muffle).connect(comp).connect(this.master).connect(ctx.destination)

    this.noise = this.makeNoise(false)
    this.brown = this.makeNoise(true)
    this.buildWind()
    this.buildFall()
    this.scheduleCreak()

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) void this.ctx.suspend()
      else void this.ctx.resume()
    })
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05)
  }

  private makeNoise(brown: boolean) {
    const ctx = this.ctx!
    const length = ctx.sampleRate * 3
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      if (brown) {
        last = (last + 0.02 * white) / 1.02
        data[i] = last * 3.5
      } else data[i] = white
    }
    return buffer
  }

  private loopSource(buffer: AudioBuffer) {
    const src = this.ctx!.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.loopStart = Math.random()
    src.start(0, Math.random() * 2)
    return src
  }

  private lfo(freq: number, depth: number, target: AudioParam) {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    osc.frequency.value = freq
    const gain = ctx.createGain()
    gain.gain.value = depth
    osc.connect(gain).connect(target)
    osc.start()
  }

  private buildWind() {
    const ctx = this.ctx!
    // Low rumble layer.
    const rumble = this.loopSource(this.brown)
    const rumbleFilter = ctx.createBiquadFilter()
    rumbleFilter.type = 'lowpass'
    rumbleFilter.frequency.value = 220
    const rumbleGain = ctx.createGain()
    rumbleGain.gain.value = 0.5
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(this.bus)
    this.lfo(0.07, 0.25, rumbleGain.gain)

    // Mid gusts.
    const gust = this.loopSource(this.noise)
    const gustFilter = ctx.createBiquadFilter()
    gustFilter.type = 'bandpass'
    gustFilter.frequency.value = 480
    gustFilter.Q.value = 0.6
    const gustGain = ctx.createGain()
    gustGain.gain.value = 0.12
    gust.connect(gustFilter).connect(gustGain).connect(this.bus)
    this.lfo(0.13, 0.08, gustGain.gain)
    this.lfo(0.05, 220, gustFilter.frequency)

    // Whistling through the steel.
    const whistleSrc = this.loopSource(this.noise)
    this.whistle = ctx.createBiquadFilter()
    this.whistle.type = 'bandpass'
    this.whistle.frequency.value = 900
    this.whistle.Q.value = 14
    const whistleGain = ctx.createGain()
    whistleGain.gain.value = 0.18
    whistleSrc.connect(this.whistle).connect(whistleGain).connect(this.bus)
    this.lfo(0.09, 260, this.whistle.frequency)
    this.lfo(0.21, 0.1, whistleGain.gain)

    this.windGains = [rumbleGain, gustGain, whistleGain]
    this.setWind(this.windLevel)
  }

  private buildFall() {
    const ctx = this.ctx!
    const src = this.loopSource(this.noise)
    this.fallFilter = ctx.createBiquadFilter()
    this.fallFilter.type = 'bandpass'
    this.fallFilter.frequency.value = 400
    this.fallFilter.Q.value = 1.2
    this.fallGain = ctx.createGain()
    this.fallGain.gain.value = 0
    src.connect(this.fallFilter).connect(this.fallGain).connect(this.bus)
  }

  /** 0..1 wind intensity; grows with level. */
  setWind(intensity: number) {
    this.windLevel = intensity
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const [rumble, gust, whistle] = this.windGains
    rumble.gain.setTargetAtTime(0.35 + intensity * 0.5, t, 0.8)
    gust.gain.setTargetAtTime(0.08 + intensity * 0.22, t, 0.8)
    whistle.gain.setTargetAtTime(0.06 + intensity * 0.22, t, 0.8)
  }

  /** Underwater-style muffling during the memorize phase. */
  setMuffled(muffled: boolean) {
    if (!this.ctx) return
    this.muffle.frequency.setTargetAtTime(muffled ? 520 : 18000, this.ctx.currentTime, muffled ? 0.25 : 0.4)
    this.muffle.Q.setTargetAtTime(muffled ? 4 : 0.5, this.ctx.currentTime, 0.3)
  }

  /** Heartbeat in BPM; 0 stops it. */
  setHeartRate(bpm: number) {
    const next = Math.round(bpm / 4) * 4
    if (next === this.heartRate) return
    this.heartRate = next
    window.clearTimeout(this.heartbeatTimer)
    if (!this.ctx || next <= 0) return
    const beat = () => {
      if (!this.ctx || this.heartRate <= 0) return
      this.thump(0, 1)
      this.thump(0.16, 0.7)
      this.heartbeatTimer = window.setTimeout(beat, 60000 / this.heartRate)
    }
    beat()
  }

  private thump(delay: number, strength: number) {
    const ctx = this.ctx!
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(70, t)
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.14)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    // Bypass the muffle filter; the heartbeat is "inside your head".
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.25)
  }

  private scheduleCreak() {
    window.clearTimeout(this.creakTimer)
    this.creakTimer = window.setTimeout(
      () => {
        this.creak()
        this.scheduleCreak()
      },
      3500 + Math.random() * 6500,
    )
  }

  creak(intensity = 1) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const dur = 0.6 + Math.random() * 1.2
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const base = 45 + Math.random() * 60
    osc.frequency.setValueAtTime(base, t)
    osc.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.8), t + dur)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 500 + Math.random() * 900
    filter.Q.value = 18
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.35 * intensity, t + 0.08)
    gain.gain.setValueAtTime(0.3 * intensity, t + dur * 0.7)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    const am = ctx.createOscillator()
    am.frequency.value = 18 + Math.random() * 25
    const amGain = ctx.createGain()
    amGain.gain.value = 0.15 * intensity
    am.connect(amGain).connect(gain.gain)
    osc.connect(filter).connect(gain).connect(this.bus)
    osc.start(t)
    am.start(t)
    osc.stop(t + dur + 0.05)
    am.stop(t + dur + 0.05)
  }

  private noiseBurst(opts: {
    delay?: number
    duration: number
    type: BiquadFilterType
    freq: number
    q?: number
    gain: number
    attack?: number
    buffer?: AudioBuffer
    toMaster?: boolean
  }) {
    const ctx = this.ctx!
    const t = ctx.currentTime + (opts.delay ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = opts.buffer ?? this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = opts.type
    filter.frequency.value = opts.freq
    filter.Q.value = opts.q ?? 0.7
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.005))
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration)
    src.connect(filter).connect(gain).connect(opts.toMaster ? this.master : this.bus)
    src.start(t, Math.random() * 1.5)
    src.stop(t + opts.duration + 0.05)
    return { filter, t }
  }

  /** distance 0 = overhead crack, 1 = far rumble. */
  thunder(distance: number) {
    if (!this.ctx) return
    const delay = 0.2 + distance * 2.5
    if (distance < 0.35) {
      this.noiseBurst({ delay, duration: 0.5, type: 'highpass', freq: 1800, gain: 0.6 })
    }
    const rumble = this.noiseBurst({
      delay: delay + 0.05,
      duration: 3.5 + Math.random() * 2,
      type: 'lowpass',
      freq: 260 - distance * 120,
      gain: 1.1 - distance * 0.5,
      attack: 0.15,
      buffer: this.brown,
    })
    rumble.filter.frequency.linearRampToValueAtTime(70, rumble.t + 4)
  }

  footstep() {
    if (!this.ctx) return
    this.noiseBurst({ duration: 0.09, type: 'bandpass', freq: 2400 + Math.random() * 800, q: 3, gain: 0.12 })
    this.metal(0.08, 0.05, 1400 + Math.random() * 300)
  }

  private metal(gainValue: number, decay: number, base: number, delay = 0, toMaster = false) {
    const ctx = this.ctx!
    const t = ctx.currentTime + delay
    for (const ratio of [1, 2.76, 5.4, 8.93]) {
      const osc = ctx.createOscillator()
      osc.frequency.value = base * ratio
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(gainValue / ratio, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay * (1 + 3 / ratio))
      osc.connect(gain).connect(toMaster ? this.master : this.bus)
      osc.start(t)
      osc.stop(t + decay * 4 + 0.1)
    }
  }

  signOn() {
    if (!this.ctx) return
    this.noiseBurst({ duration: 0.25, type: 'bandpass', freq: 120, q: 6, gain: 0.4 })
    const ctx = this.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 100
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.03, t)
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.6)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.65)
  }

  signOff() {
    if (!this.ctx) return
    this.noiseBurst({ duration: 0.12, type: 'bandpass', freq: 3000, q: 2, gain: 0.25 })
  }

  doorOpen() {
    if (!this.ctx) return
    this.metal(0.25, 0.25, 220, 0, true)
    this.creak(0.6)
  }

  correct() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    ;[523.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, t + i * 0.09)
      gain.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.5)
      osc.connect(gain).connect(this.master)
      osc.start(t + i * 0.09)
      osc.stop(t + i * 0.09 + 0.55)
    })
  }

  wrong() {
    if (!this.ctx) return
    this.metal(0.6, 0.4, 140, 0, true)
    this.noiseBurst({ duration: 0.35, type: 'lowpass', freq: 400, gain: 0.8, toMaster: true })
    const ctx = this.ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(90, t)
    osc.frequency.linearRampToValueAtTime(60, t + 0.5)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.12, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + 0.65)
  }

  /** Rushing, screaming wind swell for the fall. */
  fall() {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    this.setHeartRate(0)
    this.setMuffled(false)
    this.fallGain.gain.cancelScheduledValues(t)
    this.fallGain.gain.setValueAtTime(0.0001, t)
    this.fallGain.gain.exponentialRampToValueAtTime(1.4, t + 1.8)
    this.fallFilter.frequency.cancelScheduledValues(t)
    this.fallFilter.frequency.setValueAtTime(300, t)
    this.fallFilter.frequency.exponentialRampToValueAtTime(2600, t + 2.6)
    this.whistle.Q.setTargetAtTime(30, t, 0.4)

    // Shrieking resonance riding on the wind.
    const scream = ctx.createOscillator()
    scream.type = 'sawtooth'
    scream.frequency.setValueAtTime(600, t)
    scream.frequency.exponentialRampToValueAtTime(1900, t + 2.6)
    const screamFilter = ctx.createBiquadFilter()
    screamFilter.type = 'bandpass'
    screamFilter.frequency.value = 1400
    screamFilter.Q.value = 9
    const screamGain = ctx.createGain()
    screamGain.gain.setValueAtTime(0.0001, t)
    screamGain.gain.exponentialRampToValueAtTime(0.12, t + 1.6)
    screamGain.gain.exponentialRampToValueAtTime(0.0001, t + 3)
    scream.connect(screamFilter).connect(screamGain).connect(this.bus)
    scream.start(t)
    scream.stop(t + 3.1)
  }

  /** Called when the fall cuts to black. */
  impact() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.fallGain.gain.cancelScheduledValues(t)
    this.fallGain.gain.setTargetAtTime(0.0001, t, 0.05)
    this.whistle.Q.setTargetAtTime(14, t, 0.5)
    this.noiseBurst({ duration: 1.4, type: 'lowpass', freq: 160, gain: 1.2, buffer: this.brown, toMaster: true })
  }

  resetAfterFall() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.fallGain.gain.cancelScheduledValues(t)
    this.fallGain.gain.setValueAtTime(0.0001, t)
  }
}
