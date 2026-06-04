import { useRef, useEffect, useCallback } from 'react'
import { AudioEngine } from '../modules/audio/AudioEngine'
import type { DeckId } from '../types'

interface Props {
  deckId: DeckId
  duration: number
  currentTime: number
  isLoaded: boolean
  onSeek?: (time: number) => void
  color: string
}

export function Waveform({ deckId, duration, currentTime, isLoaded, onSeek, color }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waveformRef = useRef<Float32Array | null>(null)
  const animFrameRef = useRef<number>(0)

  const buildStaticWaveform = useCallback(() => {
    const engine = AudioEngine.getInstance()
    const deck = engine.getDeck(deckId)
    const buffer = deck.buffer_
    if (!buffer || !canvasRef.current) return

    const canvas = canvasRef.current
    const width = canvas.width
    const data = buffer.getChannelData(0)
    const step = Math.ceil(data.length / width)
    const peaks = new Float32Array(width * 2)

    for (let i = 0; i < width; i++) {
      let min = 1, max = -1
      const start = i * step
      const end = Math.min(start + step, data.length)
      for (let j = start; j < end; j++) {
        if (data[j] < min) min = data[j]
        if (data[j] > max) max = data[j]
      }
      peaks[i * 2] = min
      peaks[i * 2 + 1] = max
    }
    waveformRef.current = peaks
  }, [deckId])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { width, height } = canvas
    const mid = height / 2

    ctx.fillStyle = '#111118'
    ctx.fillRect(0, 0, width, height)

    if (waveformRef.current && duration > 0) {
      const peaks = waveformRef.current
      const playheadX = (currentTime / duration) * width
      const pixelsPerSecond = width / duration

      for (let x = 0; x < width; x++) {
        const min = peaks[x * 2]
        const max = peaks[x * 2 + 1]
        const y1 = mid - max * mid
        const y2 = mid - min * mid

        if (x < playheadX - 1) {
          ctx.fillStyle = color + '60'
        } else if (x <= playheadX + 1) {
          ctx.fillStyle = '#ffffff'
        } else {
          ctx.fillStyle = color
        }
        ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1))
      }

      // Grid lines every 4 beats (approximate)
      ctx.strokeStyle = '#ffffff18'
      ctx.lineWidth = 1
      const beatPx = pixelsPerSecond * (60 / 120)
      for (let bx = 0; bx < width; bx += beatPx * 4) {
        ctx.beginPath()
        ctx.moveTo(bx, 0)
        ctx.lineTo(bx, height)
        ctx.stroke()
      }

      // Playhead
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, height)
      ctx.stroke()
    } else if (!isLoaded) {
      ctx.fillStyle = '#2a2a3a'
      ctx.fillRect(0, mid - 1, width, 2)
      ctx.fillStyle = '#3a3a4a'
      ctx.font = '12px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Drop a track to load', width / 2, mid + 5)
    }
  }, [color, currentTime, duration, isLoaded])

  useEffect(() => {
    if (isLoaded) {
      buildStaticWaveform()
    } else {
      waveformRef.current = null
    }
  }, [isLoaded, buildStaticWaveform])

  useEffect(() => {
    cancelAnimationFrame(animFrameRef.current)
    const loop = () => {
      draw()
      animFrameRef.current = requestAnimationFrame(loop)
    }
    animFrameRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [draw])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isLoaded || duration === 0 || !onSeek) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = (x / rect.width) * duration
    onSeek(time)
  }

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={80}
      className="w-full h-20 rounded cursor-pointer"
      style={{ imageRendering: 'pixelated' }}
      onClick={handleClick}
    />
  )
}
