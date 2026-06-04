import { useState, useEffect, useRef } from 'react'
import { useDJStore } from '../store/djStore'
import { MIDIManager } from '../modules/midi/MIDIManager'

function hex(n: number): string {
  return '0x' + n.toString(16).toUpperCase().padStart(2, '0')
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

const TYPE_COLORS: Record<string, string> = {
  'Note On': '#22c55e',
  'Note Off': '#ef4444',
  'CC': '#00d2ff',
  'Program': '#facc15',
  'Pitch Bend': '#a78bfa',
}

export function MIDIMonitor() {
  const [isOpen, setIsOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const pausedMessagesRef = useRef<typeof messages>([])

  const midi = useDJStore((s) => s.midi)
  const initMIDI = useDJStore((s) => s.initMIDI)
  const messages = midi.messages

  const displayMessages = paused ? pausedMessagesRef.current : messages

  useEffect(() => {
    if (!paused) {
      pausedMessagesRef.current = messages
    }
  }, [paused, messages])

  const filteredMessages = filter
    ? displayMessages.filter(
        (m) =>
          m.type.toLowerCase().includes(filter.toLowerCase()) ||
          m.deviceName.toLowerCase().includes(filter.toLowerCase()) ||
          hex(m.data1).includes(filter.toUpperCase()) ||
          hex(m.statusByte).includes(filter.toUpperCase()),
      )
    : displayMessages

  const handleConnect = async () => {
    await initMIDI()
  }

  const handleClear = () => {
    useDJStore.setState((s) => ({ midi: { ...s.midi, messages: [] } }))
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: '#111118', borderColor: '#2a2a3a' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer"
        style={{ background: '#0a0a0f' }}
        onClick={() => setIsOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-bold tracking-widest" style={{ color: '#6a6a8a' }}>
            MIDI MONITOR
          </span>
          <StatusDot connected={midi.isConnected} />
          {midi.isConnected && (
            <span className="text-xs font-mono" style={{ color: '#22c55e' }}>
              {midi.devices.map((d) => d.name).join(', ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono" style={{ color: '#3a3a5a' }}>
            {messages.length} msgs
          </span>
          <span className="text-[10px]" style={{ color: '#6a6a8a' }}>
            {isOpen ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {isOpen && (
        <div className="flex flex-col gap-2 p-3">
          {/* Controls */}
          <div className="flex gap-2 items-center">
            {!midi.isConnected && (
              <button
                onClick={handleConnect}
                className="text-xs font-mono px-3 py-1 rounded border transition-colors"
                style={{ borderColor: '#22c55e40', color: '#22c55e', background: '#22c55e15' }}
              >
                {midi.isSupported ? 'CONNECT MIDI' : 'NOT SUPPORTED'}
              </button>
            )}
            <input
              type="text"
              placeholder="Filter (type, CC, 0xB0...)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs font-mono px-2 py-1 rounded flex-1"
              style={{ background: '#0a0a0f', border: '1px solid #2a2a3a', color: '#ccc' }}
            />
            <button
              onClick={() => setPaused((v) => !v)}
              className="text-xs font-mono px-2 py-1 rounded border"
              style={{
                borderColor: paused ? '#facc1540' : '#3a3a4a',
                color: paused ? '#facc15' : '#6a6a8a',
                background: paused ? '#facc1515' : 'transparent',
              }}
            >
              {paused ? 'RESUME' : 'PAUSE'}
            </button>
            <button
              onClick={handleClear}
              className="text-xs font-mono px-2 py-1 rounded border"
              style={{ borderColor: '#3a3a4a', color: '#6a6a8a' }}
            >
              CLR
            </button>
          </div>

          {/* Device list */}
          {midi.devices.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {midi.devices.map((d) => (
                <span
                  key={d.id}
                  className="text-[10px] font-mono px-2 py-0.5 rounded"
                  style={{
                    background: d.connected ? '#22c55e15' : '#3a3a3a',
                    color: d.connected ? '#22c55e' : '#6a6a8a',
                    border: `1px solid ${d.connected ? '#22c55e30' : '#2a2a3a'}`,
                  }}
                >
                  {d.name} {d.manufacturer && `(${d.manufacturer})`}
                </span>
              ))}
            </div>
          )}

          {/* Message log */}
          <div
            ref={listRef}
            className="overflow-y-auto rounded font-mono text-[10px]"
            style={{ maxHeight: '240px', background: '#0a0a0f' }}
          >
            {filteredMessages.length === 0 ? (
              <div className="p-4 text-center" style={{ color: '#3a3a5a' }}>
                {midi.isConnected
                  ? 'Waiting for MIDI messages…'
                  : 'Connect a MIDI device to start monitoring.'}
              </div>
            ) : (
              filteredMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="flex items-center gap-3 px-3 py-1 border-b"
                  style={{ borderColor: '#1a1a25' }}
                >
                  <span style={{ color: '#3a3a5a', minWidth: '80px' }}>
                    {formatTimestamp(msg.timestamp)}
                  </span>
                  <span
                    className="px-1 rounded text-[9px]"
                    style={{
                      background: (TYPE_COLORS[msg.type] ?? '#6a6a8a') + '20',
                      color: TYPE_COLORS[msg.type] ?? '#6a6a8a',
                      minWidth: '52px',
                      textAlign: 'center',
                    }}
                  >
                    {msg.type}
                  </span>
                  <span style={{ color: '#6a6a8a', minWidth: '20px' }}>ch{msg.channel}</span>
                  <span style={{ color: '#00d2ff' }}>{hex(msg.statusByte)}</span>
                  <span style={{ color: '#a78bfa' }}>{hex(msg.data1)}</span>
                  <span style={{ color: '#facc15' }}>{hex(msg.data2)}</span>
                  <span style={{ color: '#ccc' }}>
                    {msg.note !== undefined && `note=${msg.note}`}
                    {msg.cc !== undefined && `cc=${msg.cc}`}
                    {' '}val={msg.value}
                  </span>
                  <span className="truncate" style={{ color: '#3a3a5a' }}>
                    {msg.deviceName}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <div
      className="w-2 h-2 rounded-full"
      style={{
        background: connected ? '#22c55e' : '#3a3a5a',
        boxShadow: connected ? '0 0 6px #22c55e' : 'none',
      }}
    />
  )
}
