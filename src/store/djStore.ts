import { create } from 'zustand'
import { AudioEngine } from '../modules/audio/AudioEngine'
import { MIDIManager } from '../modules/midi/MIDIManager'
import { StemEngine } from '../modules/stems/StemEngine'
import type { StemName, StemSet } from '../modules/stems/StemEngine'
import type {
  DeckId, DeckState, MixerState, MIDIState, StemState,
  MIDIMessage, EQBand,
} from '../types'

const DEFAULT_DECK = (id: DeckId): DeckState => ({
  id,
  isPlaying: false,
  isLoaded: false,
  fileName: '',
  bpm: 0,
  detectedBpm: 0,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  eq: { low: 0, mid: 0, high: 0 },
  tempo: 1.0,
  isCued: false,
})

const DEFAULT_STEMS: StemState = {
  isModelLoaded: false,
  isModelCached: false,
  isProcessing: false,
  progress: 0,
  hasStemsA: false,
  hasStemsB: false,
  steamModeA: false,
  steamModeB: false,
  gains: { drums: 1, bass: 1, other: 1, vocals: 1 },
}

interface DJStore {
  deckA: DeckState
  deckB: DeckState
  mixer: MixerState
  midi: MIDIState
  stems: StemState

  // Deck actions
  loadTrack: (deck: DeckId, file: File) => Promise<void>
  togglePlay: (deck: DeckId) => void
  cue: (deck: DeckId) => void
  sync: (deck: DeckId) => void
  setVolume: (deck: DeckId, value: number) => void
  setEQ: (deck: DeckId, band: EQBand, gainDb: number) => void
  setTempo: (deck: DeckId, rate: number) => void
  seekTo: (deck: DeckId, time: number) => void

  // Mixer actions
  setCrossfader: (value: number) => void
  setMasterVolume: (value: number) => void

  // MIDI actions
  initMIDI: () => Promise<void>
  addMIDIMessage: (msg: MIDIMessage) => void

  // Stem actions
  initStems: () => Promise<void>
  loadStemModel: (file: File) => Promise<void>
  separateStems: (deck: DeckId) => Promise<void>
  setStemMode: (deck: DeckId, enabled: boolean) => void
  setStemGain: (stem: StemName, value: number) => void

  tick: () => void
}

export const useDJStore = create<DJStore>((set, get) => ({
  deckA: DEFAULT_DECK('A'),
  deckB: DEFAULT_DECK('B'),
  mixer: { crossfader: 0.5, masterVolume: 0.8 },
  midi: {
    isSupported: 'requestMIDIAccess' in navigator,
    isConnected: false,
    devices: [],
    messages: [],
    maxMessages: 200,
  },
  stems: DEFAULT_STEMS,

  // ── Deck ──────────────────────────────────────────────
  loadTrack: async (deck, file) => {
    const engine = AudioEngine.getInstance()
    const { bpm, duration } = await engine.loadFile(deck, file)
    const key = deck === 'A' ? 'deckA' : 'deckB'
    const stemKey = deck === 'A' ? 'hasStemsA' : 'hasStemsB'
    const modeKey = deck === 'A' ? 'steamModeA' : 'steamModeB'
    set((s) => ({
      [key]: {
        ...s[key],
        isLoaded: true,
        fileName: file.name,
        bpm,
        detectedBpm: bpm,
        duration,
        currentTime: 0,
        isPlaying: false,
        tempo: 1.0,
      },
      stems: { ...s.stems, [stemKey]: false, [modeKey]: false },
    }))
    engine.setVolume(deck, get()[key].volume)
  },

  togglePlay: (deck) => {
    const engine = AudioEngine.getInstance()
    const key = deck === 'A' ? 'deckA' : 'deckB'
    const state = get()[key]
    if (!state.isLoaded) return
    if (state.isPlaying) {
      engine.pause(deck)
      set({ [key]: { ...state, isPlaying: false } })
    } else {
      engine.play(deck)
      set({ [key]: { ...state, isPlaying: true } })
    }
  },

  cue: (deck) => {
    const engine = AudioEngine.getInstance()
    const key = deck === 'A' ? 'deckA' : 'deckB'
    engine.cue(deck)
    set((s) => ({ [key]: { ...s[key], isPlaying: false, currentTime: 0 } }))
  },

  sync: (deck) => {
    const engine = AudioEngine.getInstance()
    const { deckA, deckB } = get()
    const thisDeck = deck === 'A' ? deckA : deckB
    const otherDeck = deck === 'A' ? deckB : deckA
    if (!thisDeck.isLoaded || otherDeck.bpm === 0 || thisDeck.bpm === 0) return
    const rate = otherDeck.bpm / thisDeck.bpm
    engine.setPlaybackRate(deck, rate)
    const key = deck === 'A' ? 'deckA' : 'deckB'
    set((s) => ({ [key]: { ...s[key], tempo: rate, bpm: thisDeck.detectedBpm * rate } }))
  },

  setVolume: (deck, value) => {
    AudioEngine.getInstance().setVolume(deck, value)
    const key = deck === 'A' ? 'deckA' : 'deckB'
    set((s) => ({ [key]: { ...s[key], volume: value } }))
  },

  setEQ: (deck, band, gainDb) => {
    AudioEngine.getInstance().setEQ(deck, band, gainDb)
    const key = deck === 'A' ? 'deckA' : 'deckB'
    set((s) => ({ [key]: { ...s[key], eq: { ...s[key].eq, [band]: gainDb } } }))
  },

  setTempo: (deck, rate) => {
    AudioEngine.getInstance().setPlaybackRate(deck, rate)
    const key = deck === 'A' ? 'deckA' : 'deckB'
    set((s) => ({ [key]: { ...s[key], tempo: rate } }))
  },

  seekTo: (deck, time) => {
    AudioEngine.getInstance().getDeck(deck).seekTo(time)
  },

  // ── Mixer ─────────────────────────────────────────────
  setCrossfader: (value) => {
    AudioEngine.getInstance().setCrossfader(value)
    set((s) => ({ mixer: { ...s.mixer, crossfader: value } }))
  },

  setMasterVolume: (value) => {
    AudioEngine.getInstance().setMasterVolume(value)
    set((s) => ({ mixer: { ...s.mixer, masterVolume: value } }))
  },

  // ── MIDI ──────────────────────────────────────────────
  initMIDI: async () => {
    const manager = MIDIManager.getInstance()
    const devices = await manager.connect()
    set((s) => ({ midi: { ...s.midi, isConnected: devices.length > 0, devices } }))
    manager.onMessage((msg) => get().addMIDIMessage(msg))
    manager.onDeviceChange((devices) =>
      set((s) => ({ midi: { ...s.midi, devices, isConnected: devices.length > 0 } })),
    )
    manager.onAction((action) => {
      const store = get()
      const deckId: DeckId =
        action.type !== 'crossfader' && 'deck' in action
          ? action.deck === 0 ? 'A' : 'B'
          : 'A'
      switch (action.type) {
        case 'play': store.togglePlay(deckId); break
        case 'cue': store.cue(deckId); break
        case 'sync': store.sync(deckId); break
        case 'volume': store.setVolume(deckId, action.value); break
        case 'crossfader': store.setCrossfader(action.value); break
        case 'eq': store.setEQ(deckId, action.band, action.value); break
        case 'tempo': store.setTempo(deckId, 0.85 + action.value * 0.3); break
      }
    })
  },

  addMIDIMessage: (msg) => {
    set((s) => {
      const messages = [msg, ...s.midi.messages].slice(0, s.midi.maxMessages)
      return { midi: { ...s.midi, messages } }
    })
  },

  // ── Stems ─────────────────────────────────────────────
  initStems: async () => {
    const engine = StemEngine.getInstance()
    const cached = await engine.hasCachedModel()
    set((s) => ({ stems: { ...s.stems, isModelCached: cached } }))
    if (cached) {
      const ok = await engine.loadModelFromCache()
      set((s) => ({ stems: { ...s.stems, isModelLoaded: ok, isModelCached: ok } }))
    }
    engine.onProgress((percent) =>
      set((s) => ({ stems: { ...s.stems, progress: percent } })),
    )
    engine.onSeparated((stemSet: StemSet) => {
      // Figure out which deck was being processed (we track it in isProcessingDeck)
      const processingDeck = (get() as DJStore & { _processingDeck?: DeckId })._processingDeck
      if (!processingDeck) return
      const audioEngine = AudioEngine.getInstance()
      audioEngine.getDeck(processingDeck).loadStems(stemSet, 44100)
      const stemKey = processingDeck === 'A' ? 'hasStemsA' : 'hasStemsB'
      set((s) => ({
        stems: { ...s.stems, isProcessing: false, progress: 100, [stemKey]: true },
      }))
    })
    engine.onError((err) => {
      console.error('Stem error:', err)
      set((s) => ({ stems: { ...s.stems, isProcessing: false, progress: 0 } }))
    })
  },

  loadStemModel: async (file) => {
    const engine = StemEngine.getInstance()
    set((s) => ({ stems: { ...s.stems, isModelLoaded: false } }))
    await engine.loadModelFromFile(file)
    set((s) => ({ stems: { ...s.stems, isModelLoaded: true, isModelCached: true } }))
  },

  separateStems: async (deck) => {
    const stemEngine = StemEngine.getInstance()
    const audioEngine = AudioEngine.getInstance()
    if (!stemEngine.isModelLoaded) throw new Error('Model not loaded')
    const buffer = audioEngine.getDeck(deck).buffer_
    if (!buffer) throw new Error('No track loaded')
    ;(get() as DJStore & { _processingDeck?: DeckId })._processingDeck = deck
    set((s) => ({ stems: { ...s.stems, isProcessing: true, progress: 0 } }))
    await stemEngine.separate(buffer)
  },

  setStemMode: (deck, enabled) => {
    AudioEngine.getInstance().getDeck(deck).setStemMode(enabled)
    const key = deck === 'A' ? 'steamModeA' : 'steamModeB'
    set((s) => ({ stems: { ...s.stems, [key]: enabled } }))
  },

  setStemGain: (stem, value) => {
    const engine = AudioEngine.getInstance()
    engine.getDeck('A').setStemGain(stem, value)
    engine.getDeck('B').setStemGain(stem, value)
    set((s) => ({
      stems: { ...s.stems, gains: { ...s.stems.gains, [stem]: value } },
    }))
  },

  // ── RAF ticker ────────────────────────────────────────
  tick: () => {
    const engine = AudioEngine.getInstance()
    const { deckA, deckB } = get()
    const updates: Partial<DJStore> = {}
    if (deckA.isPlaying)
      updates.deckA = { ...deckA, currentTime: engine.getDeck('A').currentTime }
    if (deckB.isPlaying)
      updates.deckB = { ...deckB, currentTime: engine.getDeck('B').currentTime }
    if (Object.keys(updates).length) set(updates)
  },
}))
