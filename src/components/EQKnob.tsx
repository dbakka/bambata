import { useRef, useCallback } from 'react'

interface Props {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  color?: string
}

export function EQKnob({ label, value, min = -12, max = 12, onChange, color = '#00d2ff' }: Props) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null)

  const normalized = (value - min) / (max - min)
  const angle = -135 + normalized * 270

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startValue: value }

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const dy = dragRef.current.startY - me.clientY
      const range = max - min
      const newValue = Math.max(min, Math.min(max, dragRef.current.startValue + (dy / 100) * range))
      onChange(Math.round(newValue * 10) / 10)
    }

    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [value, min, max, onChange])

  const handleDoubleClick = () => onChange(0)

  const cx = 20, cy = 20, r = 14
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const kx = cx + r * Math.cos(toRad(angle - 90))
  const ky = cy + r * Math.sin(toRad(angle - 90))

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <svg
        width="40"
        height="40"
        className="cursor-ns-resize"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <circle cx={cx} cy={cy} r={r + 4} fill="#1a1a25" stroke="#2a2a3a" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={r} fill="#111118" stroke="#2a2a3a" strokeWidth="1.5" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={value === 0 ? '#3a3a5a' : color}
          strokeWidth="2"
          strokeDasharray={`${normalized * (2 * Math.PI * r * 0.75)} ${2 * Math.PI * r}`}
          strokeDashoffset={2 * Math.PI * r * 0.125}
          transform={`rotate(-135 ${cx} ${cy})`}
          opacity={0.7}
        />
        <line
          x1={cx}
          y1={cy}
          x2={kx}
          y2={ky}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: '#6a6a8a' }}>
        {label}
      </span>
      <span className="text-[9px] font-mono" style={{ color }}>
        {value > 0 ? '+' : ''}{value.toFixed(0)}
      </span>
    </div>
  )
}
