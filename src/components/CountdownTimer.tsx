import { useEffect, useState } from 'react'

interface CountdownTimerProps {
  endsAt: number
  onExpire?: () => void
  className?: string
  showLabel?: boolean
  variant?: 'compact' | 'display'
}

function fmtTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function CountdownTimer({
  endsAt,
  onExpire,
  className = '',
  showLabel = false,
  variant = 'compact',
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(() => Math.max(0, endsAt - Date.now()))

  useEffect(() => {
    const interval = setInterval(() => {
      const rem = Math.max(0, endsAt - Date.now())
      setRemaining(rem)
      if (rem === 0) { clearInterval(interval); onExpire?.() }
    }, 500)
    return () => clearInterval(interval)
  }, [endsAt, onExpire])

  const isCritical = remaining < 5 * 60 * 1000    // < 5 min
  const isLow      = remaining < 15 * 60 * 1000   // < 15 min
  const color = isCritical ? '#ef4444' : isLow ? '#ff9500' : '#00d2ff'

  if (variant === 'display') {
    return (
      <div className={`text-center ${className}`}>
        {showLabel && (
          <div className="text-[10px] font-mono tracking-widest mb-2" style={{ color: '#475569' }}>
            TIME REMAINING
          </div>
        )}
        <span
          className={`font-mono font-black tabular-nums ${isCritical ? 'animate-pulse' : ''}`}
          style={{ fontSize: '2.5rem', lineHeight: 1, color, letterSpacing: '-0.02em' }}
        >
          {fmtTime(remaining)}
        </span>
      </div>
    )
  }

  return (
    <span
      className={`font-mono font-bold tabular-nums ${isCritical ? 'animate-pulse' : ''} ${className}`}
      style={{ color }}
    >
      {showLabel && <span style={{ color: '#475569', fontWeight: 400 }}>LEFT </span>}
      {fmtTime(remaining)}
    </span>
  )
}
