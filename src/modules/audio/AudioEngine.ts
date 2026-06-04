import { Deck } from './Deck'
import { detectBPM } from './BPMDetector'
import type { DeckId, EQBand } from '../../types'

export class AudioEngine {
  private static instance: AudioEngine | null = null

  readonly context: AudioContext
  readonly masterGain: GainNode
  readonly deckA: Deck
  readonly deckB: Deck

  private constructor() {
    this.context = new AudioContext()
    this.masterGain = this.context.createGain()
    this.masterGain.connect(this.context.destination)

    this.deckA = new Deck(this.context, this.masterGain)
    this.deckB = new Deck(this.context, this.masterGain)

    this.deckA.xfadeGain.gain.value = 1
    this.deckB.xfadeGain.gain.value = 1
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine()
    }
    return AudioEngine.instance
  }

  resume() {
    if (this.context.state === 'suspended') {
      return this.context.resume()
    }
    return Promise.resolve()
  }

  getDeck(id: DeckId): Deck {
    return id === 'A' ? this.deckA : this.deckB
  }

  async loadFile(id: DeckId, file: File): Promise<{ bpm: number; duration: number }> {
    await this.resume()
    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer)
    const deck = this.getDeck(id)
    deck.loadBuffer(audioBuffer)
    const bpm = detectBPM(audioBuffer)
    return { bpm, duration: audioBuffer.duration }
  }

  play(id: DeckId) {
    this.resume().then(() => this.getDeck(id).play())
  }

  pause(id: DeckId) {
    this.getDeck(id).pause()
  }

  stop(id: DeckId) {
    this.getDeck(id).stop()
  }

  cue(id: DeckId) {
    this.getDeck(id).cue()
  }

  setVolume(id: DeckId, value: number) {
    this.getDeck(id).setVolume(value)
  }

  setEQ(id: DeckId, band: EQBand, gainDb: number) {
    this.getDeck(id).setEQ(band, gainDb)
  }

  setCrossfader(value: number) {
    // value: 0 = full A, 0.5 = center, 1 = full B
    const angle = value * (Math.PI / 2)
    this.deckA.xfadeGain.gain.setTargetAtTime(Math.cos(angle), this.context.currentTime, 0.01)
    this.deckB.xfadeGain.gain.setTargetAtTime(Math.sin(angle), this.context.currentTime, 0.01)
  }

  setMasterVolume(value: number) {
    this.masterGain.gain.setTargetAtTime(value, this.context.currentTime, 0.01)
  }

  setPlaybackRate(id: DeckId, rate: number) {
    this.getDeck(id).setPlaybackRate(rate)
  }

  syncTempo(sourceDeck: DeckId, bpmSource: number, bpmTarget: number) {
    if (bpmTarget === 0 || bpmSource === 0) return
    const targetDeck: DeckId = sourceDeck === 'A' ? 'B' : 'A'
    const rate = bpmSource / bpmTarget
    this.getDeck(targetDeck).setPlaybackRate(rate)
    return rate
  }
}
