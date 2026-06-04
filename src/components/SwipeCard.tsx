import { useRef, useState } from 'react'
import type { Track } from '../types/party'

interface SwipeCardProps {
  track: Track
  onSwipe: (direction: 'left' | 'right') => void
  isTop: boolean
}

const THRESHOLD = 80

export function SwipeCard({ track, onSwipe, isTop }: SwipeCardProps) {
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false })
  const startRef = useRef({ x: 0, y: 0 })
  const cardRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isTop) return
    startRef.current = { x: e.clientX, y: e.clientY }
    setDrag({ x: 0, y: 0, active: true })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag.active || !isTop) return
    setDrag((d) => ({
      ...d,
      x: e.clientX - startRef.current.x,
      y: e.clientY - startRef.current.y,
    }))
  }

  const handlePointerUp = () => {
    if (!drag.active || !isTop) return
    setDrag((d) => {
      if (Math.abs(d.x) >= THRESHOLD) {
        onSwipe(d.x > 0 ? 'right' : 'left')
      }
      return { x: 0, y: 0, active: false }
    })
  }

  const rotation = drag.x * 0.1
  const clampedRot = Math.max(-15, Math.min(15, rotation))
  const rightOpacity = Math.min(1, Math.max(0, drag.x / THRESHOLD))
  const leftOpacity = Math.min(1, Math.max(0, -drag.x / THRESHOLD))

  const transform = isTop
    ? `translateX(${drag.x}px) translateY(${drag.y * 0.3}px) rotate(${clampedRot}deg)`
    : 'scale(0.96) translateY(8px)'

  const transition = drag.active ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'

  return (
    <div
      ref={cardRef}
      className={`absolute inset-0 rounded-2xl flex flex-col justify-end p-6 select-none ${isTop ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{
        background: 'linear-gradient(135deg, #0f0f17 0%, #181825 100%)',
        border: '1px solid #1e1e2e',
        transform,
        transition,
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* YEAH overlay */}
      <div
        className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
        style={{
          opacity: rightOpacity,
          background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, transparent 100%)',
          border: '2px solid rgba(34, 197, 94, 0.8)',
        }}
      >
        <span
          className="font-black text-5xl tracking-widest"
          style={{ color: '#22c55e', textShadow: '0 0 20px rgba(34,197,94,0.5)' }}
        >
          YEAH
        </span>
      </div>

      {/* SKIP overlay */}
      <div
        className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
        style={{
          opacity: leftOpacity,
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, transparent 100%)',
          border: '2px solid rgba(239, 68, 68, 0.8)',
        }}
      >
        <span
          className="font-black text-5xl tracking-widest"
          style={{ color: '#ef4444', textShadow: '0 0 20px rgba(239,68,68,0.5)' }}
        >
          SKIP
        </span>
      </div>

      {/* Track info */}
      <div className="relative z-10">
        <div className="mb-4">
          {track.energy != null && (
            <div className="flex gap-1 mb-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 h-1 rounded-full"
                  style={{
                    background: i < track.energy ? '#ff6b35' : '#1e1e2e',
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <h2 className="text-2xl font-bold text-slate-100 leading-tight">{track.title}</h2>
        <p className="text-slate-400 mt-1 text-lg">{track.artist}</p>
        <div className="flex items-center gap-4 mt-3">
          {track.bpm && (
            <span className="text-xs font-mono text-cyan-400">{track.bpm} BPM</span>
          )}
          {track.musical_key && (
            <span className="text-xs font-mono text-slate-500">{track.musical_key}</span>
          )}
          {track.duration_sec && (
            <span className="text-xs font-mono text-slate-500">
              {Math.floor(track.duration_sec / 60)}:{String(track.duration_sec % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      {/* Swipe hint buttons */}
      {isTop && (
        <div className="flex justify-between mt-6 gap-4">
          <button
            onClick={() => onSwipe('left')}
            className="flex-1 py-3 rounded-xl font-bold text-sm tracking-wider transition-all"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
            }}
          >
            SKIP
          </button>
          <button
            onClick={() => onSwipe('right')}
            className="flex-1 py-3 rounded-xl font-bold text-sm tracking-wider transition-all"
            style={{
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#22c55e',
            }}
          >
            YEAH
          </button>
        </div>
      )}
    </div>
  )
}
