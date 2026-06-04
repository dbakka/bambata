import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { type MixingEngine, type MixTrack, type MixProgress, type MixState } from '../../modules/mixing/MixingEngine'
import { getOrCreateEngine } from '../../modules/mixing/engineSingleton'
import { useCreatorSocket } from '../../hooks/useSocket'
import { CountdownTimer } from '../../components/CountdownTimer'
import type { Party } from '../../types/party'

function fmtTime(sec: number): string {
  if (!isFinite(sec) || isNaN(sec)) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function PlayerPage() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()
  const creatorToken = partyId ? localStorage.getItem(`bambata_creator_${partyId}`) ?? '' : ''

  const engineRef = useRef<MixingEngine | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  const [queue, setQueue] = useState<MixTrack[]>([])
  const [partyName, setPartyName] = useState('')
  const [currentTrack, setCurrentTrack] = useState<MixTrack | null>(null)
  const [nextTrack, setNextTrack] = useState<MixTrack | null>(null)
  const [engineState, setEngineState] = useState<MixState>('idle')
  const [progress, setProgress] = useState<MixProgress>({ currentTime: 0, duration: 0, buffered: 0 })
  const [error, setError] = useState('')
  const [loadingQueue, setLoadingQueue] = useState(true)
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [playedIds, setPlayedIds] = useState<Set<string>>(new Set())
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [activeTechnique, setActiveTechnique] = useState('')
  const [cachedCount, setCachedCount] = useState(0)
  const [durationMin, setDurationMin] = useState(120)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const hasEmittedStart = useRef(false)

  const socket = useCreatorSocket(partyId ?? '', creatorToken)

  // Network status
  useEffect(() => {
    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Broadcast current track to attendees whenever it changes
  useEffect(() => {
    if (!partyId) return
    socket.emit('player:track', { partyId, current: currentTrack, next: nextTrack })
  }, [currentTrack, nextTrack, partyId, socket])

  // Broadcast play/pause state; emit player:started once when first play begins
  useEffect(() => {
    if (!partyId) return
    socket.emit('player:state', {
      partyId,
      playing: engineState === 'playing' || engineState === 'crossfading',
    })
    if ((engineState === 'playing' || engineState === 'crossfading') && !hasEmittedStart.current) {
      hasEmittedStart.current = true
      const now = Date.now()
      setStartedAt(prev => {
        if (prev) return prev  // already set from server (party resumed)
        socket.emit('player:started', { partyId, startedAt: now })
        return now
      })
    }
  }, [engineState, partyId, socket])

  // Listen for accepted token requests appended to queue
  useEffect(() => {
    socket.on('queue:updated', (data: { track: MixTrack }) => {
      setQueue((prev) => {
        if (prev.find((t) => t.id === data.track.id)) return prev
        const updated = [...prev, data.track]
        engineRef.current?.appendToQueue([data.track])
        return updated
      })
    })
    return () => { socket.off('queue:updated') }
  }, [socket])

  // Attach to singleton engine — survives navigation to/from Dashboard
  useEffect(() => {
    const engine = getOrCreateEngine(partyId ?? '')
    engineRef.current = engine

    // Restore UI state immediately if engine is already playing
    if (engine.getState() !== 'idle') {
      setCurrentTrack(engine.getCurrentTrack())
      setEngineState(engine.getState())
      setQueue(engine.getQueue())
      setCachedCount(engine.getCachedCount())
      setLoadingQueue(false)
    }

    engine.onTrackChange = (cur, nxt) => {
      setCurrentTrack(prev => {
        if (prev) setPlayedIds(p => new Set([...p, prev.id]))
        return cur
      })
      setNextTrack(nxt)
    }
    engine.onProgress = setProgress
    engine.onStateChange = setEngineState
    engine.onError = setError
    engine.onSkip = (track, reason) => {
      setSkippedIds((prev) => new Set([...prev, track.id]))
      socket.emit('player:skip', { partyId, trackId: track.id, reason })
    }
    engine.onTechniqueChange = (t) => {
      setActiveTechnique(t.toUpperCase().replace('-', ' '))
      setTimeout(() => setActiveTechnique(''), 5000)
    }
    engine.onQueueChange = (q) => setQueue([...q])
    engine.onPrefetchChange = (count) => setCachedCount(count)

    // Auto-fill: when the queue runs low, fetch more tracks from the server
    engine.onQueueLow = async (remainingSec) => {
      console.log(`[Bambata] Queue low (${Math.round(remainingSec)}s remain) — auto-filling…`)
      try {
        const cur = engineRef.current?.getCurrentTrack()
        const res = await fetch(`/api/parties/${partyId}/autofill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentArtist: cur?.artist, currentEnergy: cur?.energy }),
        })
        if (!res.ok) return
        const { added } = await res.json() as { added: MixTrack[] }
        if (added.length > 0) {
          engineRef.current?.appendToQueue(added)
          console.log(`[Bambata] Added ${added.length} tracks to keep the party going`)
        }
      } catch { /* silent — party continues with what's there */ }
    }

    return () => {
      // Detach callbacks only — engine keeps playing while on Dashboard
      engine.onTrackChange = undefined
      engine.onProgress = undefined
      engine.onStateChange = undefined
      engine.onError = undefined
      engine.onSkip = undefined
      engine.onTechniqueChange = undefined
      engine.onQueueChange = undefined
      engine.onQueueLow = undefined
      engine.onPrefetchChange = undefined
      engineRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch queue
  useEffect(() => {
    if (!partyId || !creatorToken) { navigate('/'); return }

    fetch(`/api/parties/${partyId}`, { headers: { 'x-creator-token': creatorToken } })
      .then(r => r.json() as Promise<Party>)
      .then(p => {
        setPartyName(p.name)
        setDurationMin(p.duration_min)
        if (p.started_at) setStartedAt(p.started_at)
      })
      .catch(() => {})

    fetch(`/api/parties/${partyId}/queue`)
      .then(r => r.json() as Promise<MixTrack[]>)
      .then(q => {
        // Only load queue into engine on first visit — don't disrupt an already-playing mix
        if (engineRef.current?.getState() === 'idle') {
          setQueue(q)
          engineRef.current.setQueue(q)
        }
        setLoadingQueue(false)
      })
      .catch(() => { setLoadingQueue(false) })
  }, [partyId, creatorToken, navigate])

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const setSize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
    }
    setSize()
    window.addEventListener('resize', setSize)
    return () => window.removeEventListener('resize', setSize)
  }, [])

  // Waveform animation
  const animate = useCallback(() => {
    const canvas = canvasRef.current
    const engine = engineRef.current
    if (!canvas || !engine) return

    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const analyser = engine.getAnalyserNode()
    const W = canvas.width
    const H = canvas.height
    const bufLen = analyser.frequencyBinCount
    const data = new Uint8Array(bufLen)
    analyser.getByteFrequencyData(data)

    ctx2d.fillStyle = '#06060c'
    ctx2d.fillRect(0, 0, W, H)

    const barCount = 80
    const barW = Math.floor(W / barCount) - 1

    for (let i = 0; i < barCount; i++) {
      // Sample across the frequency range (focus on 0–8 kHz)
      const dataIdx = Math.floor((i / barCount) * (bufLen * 0.6))
      const v = data[dataIdx] / 255
      const h = Math.max(2, v * H)
      const hue = 180 + (i / barCount) * 90
      ctx2d.fillStyle = `hsla(${hue}, 100%, ${45 + v * 30}%, ${0.4 + v * 0.6})`
      ctx2d.fillRect(i * (barW + 1), H - h, barW, h)
    }

    animRef.current = requestAnimationFrame(animate)
  }, [])

  useEffect(() => {
    if (engineState === 'playing' || engineState === 'crossfading') {
      animRef.current = requestAnimationFrame(animate)
    } else {
      cancelAnimationFrame(animRef.current)
    }
    return () => cancelAnimationFrame(animRef.current)
  }, [engineState, animate])

  const handleStart = async () => {
    setError('')
    try {
      await engineRef.current?.start()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start')
    }
  }

  const handlePauseResume = async () => {
    if (engineState === 'paused') {
      await engineRef.current?.resume()
    } else {
      engineRef.current?.pause()
    }
  }

  const handleSkip = async () => {
    setError('')
    try {
      await engineRef.current?.skip()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Skip failed')
    }
  }

  const pct = progress.duration > 0 ? (progress.currentTime / progress.duration) * 100 : 0
  const bufferedPct = progress.duration > 0 ? (progress.buffered / progress.duration) * 100 : 0
  const isPlaying = engineState === 'playing' || engineState === 'crossfading'
  const isCrossfading = engineState === 'crossfading'

  if (loadingQueue) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050508' }}>
        <span className="text-xs font-mono animate-pulse" style={{ color: '#475569' }}>LOADING QUEUE…</span>
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-6" style={{ background: '#050508' }}>
        <span className="text-xs font-mono" style={{ color: '#00d2ff' }}>BAMBATA PLAYER</span>
        <p className="text-sm text-center" style={{ color: '#475569' }}>
          No queue built yet. Open a swipe window on the dashboard,<br />
          let the crowd vote, then close it to build the energy-arc queue.
        </p>
        <button
          onClick={() => navigate(`/creator/${partyId}`)}
          className="text-xs font-mono px-4 py-2 rounded-lg"
          style={{ background: 'rgba(0,210,255,0.1)', border: '1px solid rgba(0,210,255,0.3)', color: '#00d2ff' }}
        >
          ← DASHBOARD
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#050508', fontFamily: 'system-ui' }}>

      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid #1e1e2e' }}
      >
        <button onClick={() => navigate(`/creator/${partyId}`)} className="text-xs font-mono" style={{ color: '#475569' }}>
          ← DASHBOARD
        </button>
        <span className="text-xs font-mono font-bold" style={{ color: '#00d2ff' }}>
          {partyName.toUpperCase() || 'BAMBATA PLAYER'}
        </span>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded animate-pulse"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
              title="No internet — playing from cache"
            >
              OFFLINE
            </span>
          )}
          {cachedCount > 0 && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
              title={`${cachedCount} tracks buffered — safe to play offline`}
            >
              {cachedCount} CACHED
            </span>
          )}
          {activeTechnique && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}
            >
              {activeTechnique}
            </span>
          )}
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded"
            style={{
              background: isCrossfading ? 'rgba(167,139,250,0.15)' : isPlaying ? 'rgba(34,197,94,0.12)' : 'rgba(71,85,105,0.2)',
              color: isCrossfading ? '#a78bfa' : isPlaying ? '#22c55e' : '#475569',
            }}
          >
            {isCrossfading ? 'CROSSFADE' : isPlaying ? 'PLAYING' : engineState.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Party countdown strip */}
      {startedAt && (
        <div
          className="px-4 py-2 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid #0f0f17' }}
        >
          <div className="flex-1 mr-4">
            <div
              className="rounded-full overflow-hidden"
              style={{ height: 3, background: '#0f0f17' }}
            >
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(100, ((Date.now() - startedAt) / (durationMin * 60000)) * 100)}%`,
                  background: 'linear-gradient(90deg, #00d2ff, #a78bfa)',
                }}
              />
            </div>
          </div>
          <CountdownTimer
            endsAt={startedAt + durationMin * 60 * 1000}
            showLabel
            className="text-xs"
          />
        </div>
      )}

      {/* Now playing */}
      <div className="px-4 pt-6 pb-2 flex-shrink-0">
        {currentTrack ? (
          <div>
            <div className="text-[10px] font-mono tracking-widest mb-3" style={{ color: '#475569' }}>
              NOW PLAYING
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold leading-tight truncate" style={{ color: '#e2e8f0' }}>
                  {currentTrack.title}
                </h1>
                <p className="text-sm mt-0.5 truncate" style={{ color: '#64748b' }}>
                  {currentTrack.artist}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  {currentTrack.bpm && (
                    <span className="text-xs font-mono" style={{ color: '#00d2ff' }}>{currentTrack.bpm} BPM</span>
                  )}
                  <span className="text-xs font-mono" style={{ color: '#ff6b35' }}>
                    E{currentTrack.energy.toFixed(1)}
                  </span>
                  {progress.duration > 0 && (
                    <span className="text-xs font-mono" style={{ color: '#475569' }}>
                      {fmtTime(progress.currentTime)} / {fmtTime(progress.duration)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <span className="text-[10px] font-mono" style={{ color: '#475569' }}>
                  #{currentTrack.queue_position}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4 relative">
              <div className="w-full rounded-full overflow-hidden" style={{ background: '#1e1e2e', height: 4 }}>
                {/* Buffered */}
                <div
                  className="absolute h-full rounded-full"
                  style={{ width: `${bufferedPct}%`, background: '#1e1e2e', top: 0, left: 0 }}
                />
                {/* Played */}
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00d2ff, #a78bfa)' }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[10px] font-mono tracking-widest mb-2" style={{ color: '#475569' }}>
              READY TO MIX
            </div>
            <p className="text-sm" style={{ color: '#e2e8f0' }}>
              {queue.length} tracks in queue — hit START MIX to begin
            </p>
          </div>
        )}
      </div>

      {/* Waveform */}
      <div className="px-4 py-3 flex-shrink-0">
        <canvas
          ref={canvasRef}
          className="w-full rounded-xl"
          style={{ height: 80, background: '#06060c', border: '1px solid #1e1e2e' }}
        />
      </div>

      {/* Next track */}
      {nextTrack && (
        <div
          className="mx-4 px-4 py-3 rounded-xl flex-shrink-0"
          style={{ background: '#0a0a0f', border: '1px solid #1e1e2e' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono" style={{ color: '#3a3a5a' }}>NEXT</span>
            {isCrossfading && (
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded animate-pulse"
                style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}
              >
                FADING IN
              </span>
            )}
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium truncate" style={{ color: '#94a3b8' }}>
                {nextTrack.title}
              </span>
              <span className="text-xs ml-2" style={{ color: '#475569' }}>{nextTrack.artist}</span>
            </div>
            {nextTrack.bpm && (
              <span className="text-xs font-mono flex-shrink-0" style={{ color: '#475569' }}>
                {nextTrack.bpm} BPM
              </span>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="mx-4 mt-3 px-4 py-2.5 rounded-xl text-xs font-mono flex-shrink-0"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}
        >
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="px-4 py-4 flex items-center justify-center gap-4 flex-shrink-0">
        {engineState === 'idle' || engineState === 'ended' ? (
          <button
            onClick={handleStart}
            className="px-8 py-3.5 rounded-xl font-bold text-sm tracking-wider"
            style={{
              background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.1))',
              border: '1px solid rgba(34,197,94,0.5)',
              color: '#22c55e',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {engineState === 'ended' ? 'RESTART' : 'START MIX'}
          </button>
        ) : (
          <>
            <button
              onClick={handlePauseResume}
              disabled={engineState === 'loading'}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all disabled:opacity-40"
              style={{ background: isPlaying ? 'rgba(0,210,255,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${isPlaying ? 'rgba(0,210,255,0.3)' : 'rgba(34,197,94,0.3)'}` }}
            >
              {engineState === 'loading' ? (
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#00d2ff', borderTopColor: 'transparent' }} />
              ) : isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#00d2ff' }}>
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#22c55e' }}>
                  <path d="M8 5v14l11-7L8 5z" />
                </svg>
              )}
            </button>

            <button
              onClick={handleSkip}
              disabled={engineState === 'loading' || !nextTrack}
              className="w-12 h-12 rounded-full flex items-center justify-center transition-all disabled:opacity-30"
              style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
              title="Skip to next"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#475569' }}>
                <path d="M6 18l8.5-6L6 6v12zm2.5-6l5.5 3.9V8.1L8.5 12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 mb-3" style={{ borderTop: '1px solid #1e1e2e' }} />

      {/* Queue list */}
      <div className="px-4 pb-6 flex-1 overflow-y-auto">
        <div className="text-[10px] font-mono tracking-widest mb-3" style={{ color: '#3a3a5a' }}>
          QUEUE — {queue.filter(t => !playedIds.has(t.id) && !skippedIds.has(t.id)).length} REMAINING
        </div>
        <div className="space-y-1.5">
          {queue.map((track, qIdx) => {
            const isCurrent = currentTrack?.id === track.id
            const isNext = nextTrack?.id === track.id
            const isPlayed = playedIds.has(track.id)
            const isSkipped = skippedIds.has(track.id)
            // Position shown is brain-order index among non-played, non-skipped tracks
            const brainPos = queue.slice(0, qIdx + 1).filter(t => !playedIds.has(t.id) && !skippedIds.has(t.id)).length
            return (
              <div
                key={track.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={{
                  background: isCurrent ? 'rgba(0,210,255,0.06)' : isNext ? 'rgba(167,139,250,0.04)' : '#0a0a0f',
                  border: isCurrent ? '1px solid rgba(0,210,255,0.2)' : isNext ? '1px solid rgba(167,139,250,0.15)' : isSkipped ? '1px solid rgba(239,68,68,0.15)' : '1px solid transparent',
                  opacity: isPlayed || isSkipped ? 0.3 : 1,
                }}
              >
                <span
                  className="text-xs font-mono w-5 text-center flex-shrink-0"
                  style={{ color: isCurrent ? '#00d2ff' : '#3a3a5a' }}
                >
                  {isCurrent ? '▶' : isPlayed ? '✓' : isSkipped ? '✗' : brainPos}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: isCurrent ? '#e2e8f0' : '#94a3b8' }}>
                    {track.title}
                  </div>
                  <div className="text-xs truncate mt-0.5" style={{ color: '#475569' }}>
                    {track.artist}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {track.bpm && (
                    <span className="text-[10px] font-mono" style={{ color: isCurrent ? '#00d2ff' : '#3a3a5a' }}>
                      {track.bpm}
                    </span>
                  )}
                  <span className="text-[10px] font-mono" style={{ color: '#ff6b35' }}>
                    E{track.energy.toFixed(1)}
                  </span>
                  {isSkipped && (
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
                    >
                      NO STREAM
                    </span>
                  )}
                  {!isSkipped && !isPlayed && track.audiomack_url && track.audiomack_url.includes('itunes') && (
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(167,139,250,0.1)', color: '#a78bfa' }}
                      title="30-second iTunes preview"
                    >
                      30s
                    </span>
                  )}
                  {!track.audiomack_url && !isSkipped && !isPlayed && (
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                      title="No stream URL — will try iTunes on play"
                    >
                      NO URL
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
