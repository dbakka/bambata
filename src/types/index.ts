export type DeckId = 'A' | 'B'
export type EQBand = 'low' | 'mid' | 'high'

export interface EQState {
  low: number
  mid: number
  high: number
}

export interface DeckState {
  id: DeckId
  isPlaying: boolean
  isLoaded: boolean
  fileName: string
  bpm: number
  detectedBpm: number
  currentTime: number
  duration: number
  volume: number
  eq: EQState
  tempo: number
  isCued: boolean
}

export interface MixerState {
  crossfader: number
  masterVolume: number
}

export interface MIDIMessage {
  id: string
  timestamp: number
  deviceName: string
  statusByte: number
  data1: number
  data2: number
  type: string
  channel: number
  note?: number
  cc?: number
  value: number
}

export interface MIDIDevice {
  id: string
  name: string
  manufacturer: string
  connected: boolean
}

export type StemName = 'drums' | 'bass' | 'other' | 'vocals'

export interface StemGains {
  drums: number
  bass: number
  other: number
  vocals: number
}

export interface StemState {
  isModelLoaded: boolean
  isModelCached: boolean
  isProcessing: boolean
  progress: number
  hasStemsA: boolean
  hasStemsB: boolean
  steamModeA: boolean
  steamModeB: boolean
  gains: StemGains
}

export interface MIDIState {
  isSupported: boolean
  isConnected: boolean
  devices: MIDIDevice[]
  messages: MIDIMessage[]
  maxMessages: number
}
