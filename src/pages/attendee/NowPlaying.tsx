import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePartySocket } from '../../hooks/useSocket'
import { CountdownTimer } from '../../components/CountdownTimer'
import type { MixTrack } from '../../modules/mixing/MixingEngine'

interface Particle { id: number; x: number; y: number; emoji: string }
interface StoredPass { id: string; attendee_name: string }

const REACTION_EMOJIS = ['🔥', '🔥', '🔥', '💥', '🎵', '⚡']
let particleId = 0

export default function NowPlaying() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()
  const [current, setCurrent] = useState<MixTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [durationMin, setDurationMin] = useState<number | null>(null)
  const [reactionCount, setReactionCount] = useState(0)
  const [particles, setParticles] = useState<Particle[]>([])
  const [timeUp, setTimeUp] = useState(false)
  const lastReactAt = useRef(0)

  const socket = usePartySocket(partyId ?? '')

  const pass: StoredPass | null = (() => {
    try { return partyId ? JSON.parse(localStorage.getItem(`bambata_pass_${partyId}`) ?? 'null') : null }
    catch { return null }
  })()

  // Fetch initial state
  useEffect(() => {
    if (!partyId) return
    fetch(`/api/parties/${partyId}/now`)
      .then(r => r.ok ? r.json() as Promise<{ current: MixTrack | null; startedAt: number | null; durationMin: number }> : Promise.reject())
      .then(d => {
        if (d.current) {
          setCurrent(d.current)
          fetch(`/api/parties/${partyId}/reactions/${d.current.id}`)
            .then(r => r.ok ? r.json() as Promise<{ count: number }> : Promise.reject())
            .then(r => setReactionCount(r.count))
            .catch(() => {})
        }
        if (d.startedAt) setStartedAt(d.startedAt)
        setDurationMin(d.durationMin)
      })
      .catch(() => {})
  }, [partyId])

  useEffect(() => {
    socket.on('player:track', (data: { current: MixTrack | null }) => {
      setCurrent(data.current)
      setReactionCount(0)
    })
    socket.on('player:state', (data: { playing: boolean }) => setPlaying(data.playing))
    socket.on('player:started', (data: { startedAt: number }) => setStartedAt(data.startedAt))
    socket.on('track:reacted', (data: { trackId: string; count: number }) => {
      if (current?.id === data.trackId) setReactionCount(data.count)
    })
    socket.on('party:done', () => navigate(`/party/${partyId}/closed`))
    return () => {
      socket.off('player:track'); socket.off('player:state'); socket.off('player:started')
      socket.off('track:reacted'); socket.off('party:done')
    }
  }, [socket, partyId, navigate, current?.id])

  const handleTap = useCallback((e: React.PointerEvent) => {
    if (!playing || !current) return
    const now = Date.now()
    if (now - lastReactAt.current < 1200) return  // rate limit: 1 per 1.2s
    lastReactAt.current = now

    const emoji = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)]
    const pid = ++particleId
    const x = e.clientX + (Math.random() - 0.5) * 30
    const y = e.clientY

    setParticles(prev => [...prev, { id: pid, x, y, emoji }])
    setTimeout(() => setParticles(prev => prev.filter(p => p.id !== pid)), 1300)

    socket.emit('track:react', {
      partyId,
      trackId: current.id,
      passId: pass?.id,
      attendeeName: pass?.attendee_name,
    })
  }, [playing, current, socket, partyId, pass])

  const endsAt = startedAt && durationMin ? startedAt + durationMin * 60 * 1000 : null
  const elapsed = startedAt ? Date.now() - startedAt : 0
  const totalMs = durationMin ? durationMin * 60 * 1000 : 1
  const progressPct = Math.min(100, (elapsed / totalMs) * 100)
  const remainingMs = endsAt ? Math.max(0, endsAt - Date.now()) : null
  const isNearEnd = remainingMs !== null && remainingMs < 15 * 60 * 1000
  const isCritical = remainingMs !== null && remainingMs < 5 * 60 * 1000

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: '#050508', userSelect: 'none' }}
      onPointerDown={handleTap}
    >
      {/* Floating reaction particles */}
      {particles.map(p => (
        <span
          key={p.id}
          className="react-float"
          style={{ left: p.x - 14, top: p.y - 20 }}
        >
          {p.emoji}
        </span>
      ))}

      {/* Header: logo + timer */}
      <div className="flex items-center justify-between px-5 pt-6 pb-2 flex-shrink-0 safe-top">
        <span className="text-xs font-mono tracking-[0.3em]" style={{ color: '#1e1e2e' }}>
          BAMBATA
        </span>
        <div className="flex items-center gap-3">
          {reactionCount > 0 && (
            <span className="text-xs font-mono" style={{ color: '#ff6b35' }}>
              🔥 {reactionCount}
            </span>
          )}
          {endsAt && (
            <div className="flex items-center gap-1.5">
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: isCritical ? '#ef4444' : isNearEnd ? '#ff9500' : '#22c55e' }}
              />
              <CountdownTimer endsAt={endsAt} showLabel className="text-xs" onExpire={() => setTimeUp(true)} />
            </div>
          )}
          <button
            onPointerDown={e => { e.stopPropagation(); navigate(`/party/${partyId}/leaderboard`) }}
            className="text-xs font-mono px-2 py-1 rounded-lg"
            style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', color: '#a78bfa' }}
          >
            TOP
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        {current ? (
          <>
            {playing && (
              <div className="relative flex items-center justify-center mx-auto mb-10" style={{ width: 80, height: 80 }}>
                <div className="absolute w-20 h-20 rounded-full" style={{ background: 'rgba(0,210,255,0.04)', animation: 'ping 2s ease-in-out infinite' }} />
                <div className="absolute w-12 h-12 rounded-full" style={{ background: 'rgba(0,210,255,0.07)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,210,255,0.12)', border: '1px solid rgba(0,210,255,0.25)' }}>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#00d2ff' }}>
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
              </div>
            )}

            <p className="text-xs font-mono tracking-widest mb-4" style={{ color: '#475569' }}>
              {playing ? 'NOW PLAYING' : 'PAUSED'}
            </p>
            <h1
              className="font-black leading-tight mb-3"
              style={{ color: '#e2e8f0', fontSize: current.title.length > 24 ? '1.75rem' : '2.25rem' }}
            >
              {current.title}
            </h1>
            <p className="text-lg mb-8" style={{ color: '#64748b' }}>
              {current.artist}
            </p>

            {/* Energy dots */}
            <div className="flex gap-0.5 justify-center mb-10">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="rounded-full" style={{ width: 6, height: 6, background: i < current.energy ? '#ff6b35' : '#1e1e2e' }} />
              ))}
            </div>

            {/* Tap hint */}
            {playing && (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="px-5 py-2.5 rounded-full text-xs font-mono tracking-widest"
                  style={{ background: 'rgba(255,107,53,0.12)', border: '1px solid rgba(255,107,53,0.25)', color: '#ff6b35' }}
                >
                  TAP TO REACT 🔥
                </div>
                <p className="text-[10px] font-mono" style={{ color: '#3a3a5a' }}>
                  tap anywhere on screen
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="relative flex items-center justify-center mx-auto mb-10" style={{ width: 80, height: 80 }}>
              <div className="absolute w-20 h-20 rounded-full" style={{ background: 'rgba(0,210,255,0.02)', animation: 'ping 3s ease-in-out infinite' }} />
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,210,255,0.06)', border: '1px solid rgba(0,210,255,0.15)' }}>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#1e1e2e' }}>
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            </div>
            <p className="text-sm" style={{ color: '#3a3a5a' }}>Waiting for the mix to start…</p>
          </>
        )}
      </div>

      {/* Time-up overlay — prompt to extend */}
      {timeUp && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
          style={{ background: 'rgba(5,5,8,0.96)' }}
        >
          <div className="text-4xl mb-4">⏱</div>
          <h2 className="text-2xl font-black tracking-wider mb-2" style={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono, monospace' }}>
            TIME'S UP
          </h2>
          <p className="text-sm mb-8" style={{ color: '#475569' }}>
            Your free session ended. Extend the party to keep the music going.
          </p>
          <div className="w-full max-w-xs flex flex-col gap-3">
            {[
              { label: '30 MIN', price: '$2', color: '#00d2ff' },
              { label: '1 HOUR', price: '$4', color: '#a78bfa' },
              { label: '3 HOURS', price: '$10', color: '#ff6b35' },
            ].map(opt => (
              <button
                key={opt.label}
                className="w-full py-4 rounded-xl font-bold text-sm tracking-wider flex items-center justify-between px-5"
                style={{ background: `rgba(${opt.color === '#00d2ff' ? '0,210,255' : opt.color === '#a78bfa' ? '167,139,250' : '255,107,53'},0.1)`, border: `1px solid ${opt.color}40`, color: opt.color, fontFamily: 'JetBrains Mono, monospace' }}
                onClick={() => alert('Payments coming soon — ask the creator to extend!')}
              >
                <span>{opt.label}</span>
                <span>{opt.price}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] font-mono mt-6" style={{ color: '#3a3a5a' }}>
            Payments launching soon
          </p>
        </div>
      )}

      {/* Party progress + end warning */}
      {endsAt && (
        <div className="px-5 pb-8 safe-bottom flex-shrink-0">
          {isNearEnd && (
            <p className="text-center text-xs font-mono mb-3" style={{ color: isCritical ? '#ef4444' : '#ff9500' }}>
              {isCritical ? 'PARTY ENDING SOON' : 'LAST 15 MINUTES'}
            </p>
          )}
          <div className="rounded-full overflow-hidden" style={{ height: 3, background: '#0f0f17' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${progressPct}%`,
                background: isCritical ? 'linear-gradient(90deg,#ef4444,#ff6b35)' : isNearEnd ? 'linear-gradient(90deg,#ff9500,#ffcc00)' : 'linear-gradient(90deg,#00d2ff,#a78bfa)',
                transition: 'width 1s linear',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
