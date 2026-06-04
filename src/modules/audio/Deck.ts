import type { EQBand } from '../../types'
import type { StemName, StemSet } from '../stems/StemEngine'

const STEM_NAMES: StemName[] = ['drums', 'bass', 'other', 'vocals']

export class Deck {
  private context: AudioContext
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private playOffset: number = 0
  private playStartContextTime: number = 0
  private _playbackRate: number = 1.0

  // Stem support
  private stemBuffers: Partial<Record<StemName, AudioBuffer>> = {}
  private stemSources: Partial<Record<StemName, AudioBufferSourceNode>> = {}
  private stemGains: Record<StemName, GainNode>
  private trackGain: GainNode   // gates the original source in/out
  private _stemMode: boolean = false

  readonly gainNode: GainNode   // master volume fader (sums track + stems)
  readonly xfadeGain: GainNode
  readonly eqLow: BiquadFilterNode
  readonly eqMid: BiquadFilterNode
  readonly eqHigh: BiquadFilterNode
  readonly analyser: AnalyserNode

  isPlaying: boolean = false
  onEnded: (() => void) | null = null

  constructor(context: AudioContext, masterGain: GainNode) {
    this.context = context

    this.gainNode  = context.createGain()
    this.trackGain = context.createGain()   // 1.0 = full track, 0.0 = stems only
    this.xfadeGain = context.createGain()
    this.eqLow     = context.createBiquadFilter()
    this.eqMid     = context.createBiquadFilter()
    this.eqHigh    = context.createBiquadFilter()
    this.analyser  = context.createAnalyser()
    this.analyser.fftSize = 2048

    this.eqLow.type = 'lowshelf'
    this.eqLow.frequency.value = 320

    this.eqMid.type = 'peaking'
    this.eqMid.frequency.value = 1000
    this.eqMid.Q.value = 0.8

    this.eqHigh.type = 'highshelf'
    this.eqHigh.frequency.value = 3200

    // Both trackGain and all stemGains feed into the same gainNode (volume fader)
    this.trackGain.connect(this.gainNode)
    this.gainNode.connect(this.eqLow)
    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.analyser)
    this.analyser.connect(this.xfadeGain)
    this.xfadeGain.connect(masterGain)

    // Create stem gain nodes (all connected to gainNode, sources connected on demand)
    this.stemGains = {
      drums:  context.createGain(),
      bass:   context.createGain(),
      other:  context.createGain(),
      vocals: context.createGain(),
    }
    for (const g of Object.values(this.stemGains)) {
      g.connect(this.gainNode)
    }
  }

  loadBuffer(buffer: AudioBuffer) {
    this.stop()
    this.buffer = buffer
    this.playOffset = 0
    this.stemBuffers = {}
    this._stemMode = false
    this.trackGain.gain.value = 1
  }

  play() {
    if (!this.buffer || this.isPlaying) return

    if (this._stemMode && Object.keys(this.stemBuffers).length === 4) {
      this.startStems(this.playOffset)
    } else {
      this.startSource(this.playOffset)
    }

    this.playStartContextTime = this.context.currentTime
    this.isPlaying = true
  }

  private startSource(offset: number) {
    this.source = this.context.createBufferSource()
    this.source.buffer = this.buffer!
    this.source.playbackRate.value = this._playbackRate
    this.source.connect(this.trackGain)
    this.source.start(0, offset)

    this.source.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false
        this.playOffset = 0
        this.onEnded?.()
      }
    }
  }

  private startStems(offset: number) {
    // All 4 stem sources start at the same scheduled time for perfect sync
    const when = this.context.currentTime + 0.015
    for (const name of STEM_NAMES) {
      const buf = this.stemBuffers[name]
      if (!buf) continue
      const src = this.context.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = this._playbackRate
      src.connect(this.stemGains[name])
      src.start(when, offset)
      this.stemSources[name] = src
    }
    this.playStartContextTime = when
  }

  pause() {
    if (!this.isPlaying) return
    const elapsed = (this.context.currentTime - this.playStartContextTime) * this._playbackRate
    this.playOffset = Math.min(this.playOffset + elapsed, this.buffer?.duration ?? 0)
    this.stopAllSources()
    this.isPlaying = false
  }

  stop() {
    this.stopAllSources()
    this.playOffset = 0
    this.isPlaying = false
  }

  private stopAllSources() {
    if (this.source) {
      this.source.onended = null
      try { this.source.stop() } catch { /* already stopped */ }
      this.source = null
    }
    for (const name of STEM_NAMES) {
      const src = this.stemSources[name]
      if (src) {
        try { src.stop() } catch { /* already stopped */ }
        delete this.stemSources[name]
      }
    }
  }

  cue() {
    this.stop()
  }

  seekTo(time: number) {
    const wasPlaying = this.isPlaying
    if (wasPlaying) this.pause()
    this.playOffset = Math.max(0, Math.min(time, this.buffer?.duration ?? 0))
    if (wasPlaying) this.play()
  }

  // Load stem AudioBuffers (called after StemEngine finishes separation)
  loadStems(stemSet: StemSet, sampleRate: number) {
    for (const name of STEM_NAMES) {
      const channels = stemSet[name]
      const buf = this.context.createBuffer(2, channels.left.length, sampleRate)
      buf.copyToChannel(new Float32Array(channels.left), 0)
      buf.copyToChannel(new Float32Array(channels.right), 1)
      this.stemBuffers[name] = buf
    }
  }

  setStemMode(enabled: boolean) {
    if (this._stemMode === enabled) return
    this._stemMode = enabled

    if (enabled && Object.keys(this.stemBuffers).length < 4) return // not ready yet

    const wasPlaying = this.isPlaying
    const pos = this.currentTime
    if (wasPlaying) this.pause()

    this.trackGain.gain.setTargetAtTime(enabled ? 0 : 1, this.context.currentTime, 0.02)
    this.playOffset = pos
    if (wasPlaying) this.play()
  }

  setStemGain(name: StemName, value: number) {
    this.stemGains[name].gain.setTargetAtTime(Math.max(0, value), this.context.currentTime, 0.01)
  }

  get stemMode(): boolean {
    return this._stemMode
  }

  get hasStemsLoaded(): boolean {
    return Object.keys(this.stemBuffers).length === 4
  }

  get currentTime(): number {
    if (!this.buffer) return 0
    if (this.isPlaying) {
      const elapsed = (this.context.currentTime - this.playStartContextTime) * this._playbackRate
      return Math.min(this.playOffset + elapsed, this.buffer.duration)
    }
    return this.playOffset
  }

  get duration(): number {
    return this.buffer?.duration ?? 0
  }

  get buffer_(): AudioBuffer | null {
    return this.buffer
  }

  setVolume(value: number) {
    this.gainNode.gain.setTargetAtTime(Math.max(0, value), this.context.currentTime, 0.01)
  }

  setEQ(band: EQBand, gainDb: number) {
    const node = band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh
    node.gain.setTargetAtTime(gainDb, this.context.currentTime, 0.01)
  }

  setPlaybackRate(rate: number) {
    this._playbackRate = rate
    if (this.source) {
      this.source.playbackRate.setTargetAtTime(rate, this.context.currentTime, 0.02)
    }
    for (const name of STEM_NAMES) {
      const src = this.stemSources[name]
      if (src) src.playbackRate.setTargetAtTime(rate, this.context.currentTime, 0.02)
    }
  }

  get playbackRate(): number {
    return this._playbackRate
  }
}
