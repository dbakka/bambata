export type MIDIAction =
  | { type: 'play'; deck: 0 | 1 }
  | { type: 'pause'; deck: 0 | 1 }
  | { type: 'cue'; deck: 0 | 1 }
  | { type: 'sync'; deck: 0 | 1 }
  | { type: 'volume'; deck: 0 | 1; value: number }
  | { type: 'crossfader'; value: number }
  | { type: 'eq'; deck: 0 | 1; band: 'low' | 'mid' | 'high'; value: number }
  | { type: 'jog'; deck: 0 | 1; delta: number }
  | { type: 'tempo'; deck: 0 | 1; value: number }

interface MIDIBinding {
  status: number
  data1: number
  action: (data2: number) => MIDIAction | null
}

// DDJ-FL4 MIDI mapping (Pioneer DJ protocol)
// Status bytes: 0x90/0x91 = Note On ch1/2, 0xB0/0xB1 = CC ch1/2
const DDJ_FL4_BINDINGS: MIDIBinding[] = [
  // Deck 1 transport
  { status: 0x90, data1: 0x0B, action: (v) => v ? { type: 'play', deck: 0 } : null },
  { status: 0x90, data1: 0x0C, action: (v) => v ? { type: 'cue', deck: 0 } : null },
  { status: 0x90, data1: 0x58, action: (v) => v ? { type: 'sync', deck: 0 } : null },

  // Deck 2 transport
  { status: 0x91, data1: 0x0B, action: (v) => v ? { type: 'play', deck: 1 } : null },
  { status: 0x91, data1: 0x0C, action: (v) => v ? { type: 'cue', deck: 1 } : null },
  { status: 0x91, data1: 0x58, action: (v) => v ? { type: 'sync', deck: 1 } : null },

  // Deck 1 volume fader
  { status: 0xB0, data1: 0x13, action: (v) => ({ type: 'volume', deck: 0, value: v / 127 }) },
  // Deck 2 volume fader
  { status: 0xB1, data1: 0x13, action: (v) => ({ type: 'volume', deck: 1, value: v / 127 }) },

  // Crossfader
  { status: 0xB6, data1: 0x1F, action: (v) => ({ type: 'crossfader', value: v / 127 }) },

  // Deck 1 EQ
  { status: 0xB0, data1: 0x3F, action: (v) => ({ type: 'eq', deck: 0, band: 'high', value: (v - 64) / 64 * 12 }) },
  { status: 0xB0, data1: 0x3A, action: (v) => ({ type: 'eq', deck: 0, band: 'mid', value: (v - 64) / 64 * 12 }) },
  { status: 0xB0, data1: 0x39, action: (v) => ({ type: 'eq', deck: 0, band: 'low', value: (v - 64) / 64 * 12 }) },

  // Deck 2 EQ
  { status: 0xB1, data1: 0x3F, action: (v) => ({ type: 'eq', deck: 1, band: 'high', value: (v - 64) / 64 * 12 }) },
  { status: 0xB1, data1: 0x3A, action: (v) => ({ type: 'eq', deck: 1, band: 'mid', value: (v - 64) / 64 * 12 }) },
  { status: 0xB1, data1: 0x39, action: (v) => ({ type: 'eq', deck: 1, band: 'low', value: (v - 64) / 64 * 12 }) },

  // Deck 1 Jog (CC 33 = outer ring, CC 34 = touch/scratch)
  {
    status: 0xB0, data1: 0x21,
    action: (v) => ({ type: 'jog', deck: 0, delta: v > 64 ? v - 128 : v }),
  },
  {
    status: 0xB1, data1: 0x21,
    action: (v) => ({ type: 'jog', deck: 1, delta: v > 64 ? v - 128 : v }),
  },

  // Deck 1/2 Tempo sliders
  { status: 0xB0, data1: 0x00, action: (v) => ({ type: 'tempo', deck: 0, value: v / 127 }) },
  { status: 0xB1, data1: 0x00, action: (v) => ({ type: 'tempo', deck: 1, value: v / 127 }) },
]

export function parseMIDIAction(statusByte: number, data1: number, data2: number): MIDIAction | null {
  for (const binding of DDJ_FL4_BINDINGS) {
    if (binding.status === statusByte && binding.data1 === data1) {
      return binding.action(data2)
    }
  }
  return null
}

export function parseMIDIMessageType(statusByte: number): string {
  const type = statusByte & 0xF0
  switch (type) {
    case 0x80: return 'Note Off'
    case 0x90: return 'Note On'
    case 0xA0: return 'Aftertouch'
    case 0xB0: return 'CC'
    case 0xC0: return 'Program'
    case 0xD0: return 'Ch Pressure'
    case 0xE0: return 'Pitch Bend'
    default: return `SysEx/0x${statusByte.toString(16).toUpperCase()}`
  }
}
