import { MixingEngine } from './MixingEngine'

// Single engine instance that survives React navigation.
// Audio keeps playing when the creator moves between PlayerPage and Dashboard.
let _engine: MixingEngine | null = null
let _partyId: string | null = null

export function getOrCreateEngine(partyId: string): MixingEngine {
  if (!_engine || _partyId !== partyId) {
    _engine?.destroy()
    _engine = new MixingEngine()
    _partyId = partyId
  }
  return _engine
}

export function destroyEngine() {
  _engine?.destroy()
  _engine = null
  _partyId = null
}

export function engineForParty(partyId: string): MixingEngine | null {
  return _partyId === partyId ? _engine : null
}
