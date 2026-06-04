import { useRef, useCallback } from 'react'
import { useDJStore } from '../store/djStore'
import { Waveform } from './Waveform'
import { EQKnob } from './EQKnob'
import type { DeckId } from '../types'

interface Props {
  deckId: DeckId
}

const COLORS = { A: '#00d2ff', B: '#ff6b35' }

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  const ms = Math.floor((secs % 1) * 100)
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

export function DeckPanel({ deckId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const color = COLORS[deckId]

  const deck = useDJStore((s) => (deckId === 'A' ? s.deckA : s.deckB))
  const loadTrack = useDJStore((s) => s.loadTrack)
  const togglePlay = useDJStore((s) => s.togglePlay)
  const cue = useDJStore((s) => s.cue)
  const sync = useDJStore((s) => s.sync)
  const setVolume = useDJStore((s) => s.setVolume)
  const setEQ = useDJStore((s) => s.setEQ)
  const setTempo = useDJStore((s) => s.setTempo)
  const seekTo = useDJStore((s) => s.seekTo)

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) await loadTrack(deckId, file)
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [deckId, loadTrack],
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file && file.type.startsWith('audio/')) await loadTrack(deckId, file)
    },
    [deckId, loadTrack],
  )

  const tempoPercent = ((deck.tempo - 1) * 100).toFixed(1)

  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-xl border"
      style={{ background: '#111118', borderColor: color + '30' }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-mono font-bold px-2 py-0.5 rounded"
            style={{ background: color + '20', color }}
          >
            DECK {deckId}
          </span>
          {deck.isLoaded && (
            <span className="text-xs font-mono" style={{ color: '#6a6a8a' }}>
              {deck.bpm.toFixed(1)} BPM
            </span>
          )}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs font-mono px-2 py-1 rounded border transition-colors"
          style={{ borderColor: color + '40', color: color + 'aa' }}
        >
          LOAD
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Track name */}
      <div
        className="text-xs font-mono truncate px-2 py-1 rounded"
        style={{ background: '#0a0a0f', color: deck.isLoaded ? '#ccc' : '#3a3a5a' }}
      >
        {deck.isLoaded ? deck.fileName : 'No track loaded — drag & drop or click LOAD'}
      </div>

      {/* Waveform */}
      <Waveform
        deckId={deckId}
        duration={deck.duration}
        currentTime={deck.currentTime}
        isLoaded={deck.isLoaded}
        onSeek={(t) => seekTo(deckId, t)}
        color={color}
      />

      {/* Time display */}
      <div className="flex justify-between font-mono text-sm">
        <span style={{ color }}>{formatTime(deck.currentTime)}</span>
        <span style={{ color: '#3a3a5a' }}>
          -{formatTime(Math.max(0, deck.duration - deck.currentTime))}
        </span>
        <span style={{ color: '#6a6a8a' }}>{formatTime(deck.duration)}</span>
      </div>

      {/* Transport controls */}
      <div className="flex gap-2 justify-center">
        <TransportButton
          label="CUE"
          onClick={() => cue(deckId)}
          disabled={!deck.isLoaded}
          color="#facc15"
        />
        <TransportButton
          label={deck.isPlaying ? '⏸' : '▶'}
          onClick={() => togglePlay(deckId)}
          disabled={!deck.isLoaded}
          color={color}
          primary
        />
        <TransportButton
          label="SYNC"
          onClick={() => sync(deckId)}
          disabled={!deck.isLoaded}
          color="#a78bfa"
        />
      </div>

      {/* EQ section */}
      <div className="flex justify-around items-end pt-1">
        <EQKnob
          label="HI"
          value={deck.eq.high}
          onChange={(v) => setEQ(deckId, 'high', v)}
          color={color}
        />
        <EQKnob
          label="MID"
          value={deck.eq.mid}
          onChange={(v) => setEQ(deckId, 'mid', v)}
          color={color}
        />
        <EQKnob
          label="LOW"
          value={deck.eq.low}
          onChange={(v) => setEQ(deckId, 'low', v)}
          color={color}
        />

        {/* Volume fader */}
        <div className="flex flex-col items-center gap-1">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={deck.volume}
            onChange={(e) => setVolume(deckId, parseFloat(e.target.value))}
            className="h-20 appearance-none cursor-pointer"
            style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: color }}
          />
          <span className="text-[9px] font-mono" style={{ color: '#6a6a8a' }}>VOL</span>
        </div>
      </div>

      {/* Tempo slider */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[10px] font-mono" style={{ color: '#6a6a8a' }}>TEMPO</span>
        <input
          type="range"
          min={0.85}
          max={1.15}
          step={0.001}
          value={deck.tempo}
          onChange={(e) => setTempo(deckId, parseFloat(e.target.value))}
          className="flex-1 cursor-pointer"
          style={{ accentColor: color }}
        />
        <span className="text-[10px] font-mono w-12 text-right" style={{ color }}>
          {tempoPercent}%
        </span>
        <button
          onClick={() => setTempo(deckId, 1.0)}
          className="text-[10px] font-mono px-1 rounded"
          style={{ color: '#6a6a8a', background: '#1a1a25' }}
        >
          RST
        </button>
      </div>
    </div>
  )
}

interface TransportButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  color: string
  primary?: boolean
}

function TransportButton({ label, onClick, disabled, color, primary }: TransportButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="font-mono text-sm px-4 py-2 rounded-lg border transition-all active:scale-95 disabled:opacity-30"
      style={{
        borderColor: color + (primary ? 'cc' : '40'),
        color: primary ? '#000' : color,
        background: primary ? color : color + '15',
        minWidth: primary ? '64px' : '56px',
      }}
    >
      {label}
    </button>
  )
}
