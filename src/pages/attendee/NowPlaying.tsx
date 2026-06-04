import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePartySocket } from '../../hooks/useSocket'
import { CountdownTimer } from '../../components/CountdownTimer'
import type { MixTrack } from '../../modules/mixing/MixingEngine'

interface Particle { id: number; x: number; y: number; emoji: string }
interface StoredPass { id: string; attendee_name: string }
interface SearchResult { title: string; artist: string; previewUrl: string }

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

  // Token + request states
  const [tokenBalance, setTokenBalance] = useState(0)
  const [showRequest, setShowRequest] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedTrack, setSelectedTrack] = useState<SearchResult | null>(null)
  const [tokensToSpend, setTokensToSpend] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [requestMsg, setRequestMsg] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const socket = usePartySocket(partyId ?? '')

  const pass: StoredPass | null = (() => {
    try { return partyId ? JSON.parse(localStorage.getItem(`bambata_pass_${partyId}`) ?? 'null') : null }
    catch { return null }
  })()

  const fetchWallet = useCallback(() => {
    if (!partyId || !pass?.id) return
    fetch(`/api/parties/${partyId}/wallet/${pass.id}`)
      .then(r => r.ok ? r.json() as Promise<{ balance: number }> : Promise.reject())
      .then(d => setTokenBalance(d.balance))
      .catch(() => {})
  }, [partyId, pass?.id])

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

  useEffect(() => { fetchWallet() }, [fetchWallet])

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
    socket.on('wallet:updated', (data: { passId: string; balance: number }) => {
      if (data.passId === pass?.id) setTokenBalance(data.balance)
    })
    socket.on('party:done', () => navigate(`/party/${partyId}/closed`))
    return () => {
      socket.off('player:track'); socket.off('player:state'); socket.off('player:started')
      socket.off('track:reacted'); socket.off('wallet:updated'); socket.off('party:done')
    }
  }, [socket, partyId, navigate, current?.id, pass?.id])

  const handleTap = useCallback((e: React.PointerEvent) => {
    if (!playing || !current || showRequest) return
    const now = Date.now()
    if (now - lastReactAt.current < 1200) return
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
  }, [playing, current, socket, partyId, pass, showRequest])

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    setSelectedTrack(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!q.trim()) { setSearchResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/parties/${partyId}/search?q=${encodeURIComponent(q)}`)
        const data = await res.json() as SearchResult[]
        setSearchResults(data)
      } catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 500)
  }

  const handleSubmitRequest = async () => {
    if (!selectedTrack || !pass?.id) return
    setSubmitting(true)
    setRequestMsg('')
    try {
      const res = await fetch(`/api/parties/${partyId}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passId: pass.id,
          trackTitle: selectedTrack.title,
          trackArtist: selectedTrack.artist,
          tokensSpent: tokensToSpend,
        }),
      })
      if (!res.ok) {
        const d = await res.json() as { error: string }
        setRequestMsg(d.error ?? 'Failed to submit')
        return
      }
      fetchWallet()
      setRequestMsg('Request sent!')
      setTimeout(() => {
        setShowRequest(false)
        setSearchQuery('')
        setSearchResults([])
        setSelectedTrack(null)
        setTokensToSpend(1)
        setRequestMsg('')
      }, 1500)
    } catch { setRequestMsg('Something went wrong') }
    finally { setSubmitting(false) }
  }

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
          {tokenBalance > 0 && (
            <span className="text-xs font-mono" style={{ color: '#a78bfa' }}>
              ◈ {tokenBalance}
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

            {/* Action buttons */}
            {playing && (
              <div className="flex flex-col items-center gap-3 w-full max-w-xs">
                <div className="flex gap-3 w-full">
                  {/* Tap to react */}
                  <div
                    className="flex-1 px-4 py-3 rounded-full text-xs font-mono tracking-widest text-center"
                    style={{ background: 'rgba(255,107,53,0.12)', border: '1px solid rgba(255,107,53,0.25)', color: '#ff6b35' }}
                  >
                    TAP TO REACT 🔥
                  </div>

                  {/* Request track */}
                  {pass?.id && (
                    <button
                      onPointerDown={e => { e.stopPropagation(); setShowRequest(true) }}
                      className="px-4 py-3 rounded-full text-xs font-mono tracking-widest"
                      style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}
                    >
                      + REQUEST
                    </button>
                  )}
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

      {/* Time-up overlay */}
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

      {/* Request modal */}
      {showRequest && (
        <div
          className="fixed inset-0 z-40 flex flex-col"
          style={{ background: 'rgba(5,5,8,0.97)' }}
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 pt-6 pb-4 safe-top flex-shrink-0">
            <p className="text-xs font-mono font-bold tracking-widest" style={{ color: '#e2e8f0' }}>REQUEST A TRACK</p>
            <button
              onPointerDown={() => { setShowRequest(false); setSearchQuery(''); setSearchResults([]); setSelectedTrack(null); setRequestMsg('') }}
              className="text-xs font-mono"
              style={{ color: '#475569' }}
            >
              ✕ CLOSE
            </button>
          </div>

          {/* Token balance strip */}
          <div className="mx-5 mb-4 px-4 py-2.5 rounded-xl flex items-center justify-between flex-shrink-0"
            style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}>
            <span className="text-[10px] font-mono" style={{ color: '#475569' }}>YOUR TOKENS</span>
            <span className="text-sm font-mono font-bold" style={{ color: '#a78bfa' }}>◈ {tokenBalance}</span>
          </div>

          {/* Search */}
          <div className="px-5 mb-4 flex-shrink-0">
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search by song or artist…"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono"
              style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
            />
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            {searching && (
              <p className="text-xs font-mono text-center py-8 animate-pulse" style={{ color: '#475569' }}>SEARCHING…</p>
            )}
            {!searching && searchResults.length === 0 && searchQuery.trim() && (
              <p className="text-xs font-mono text-center py-8" style={{ color: '#3a3a5a' }}>No results</p>
            )}
            {!searching && searchResults.length === 0 && !searchQuery.trim() && (
              <p className="text-xs font-mono text-center py-8" style={{ color: '#3a3a5a' }}>Type to search for a track to request</p>
            )}
            <div className="space-y-2">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  onPointerDown={() => setSelectedTrack(r)}
                  className="w-full text-left px-4 py-3 rounded-xl"
                  style={{
                    background: selectedTrack === r ? 'rgba(167,139,250,0.15)' : '#0a0a0f',
                    border: selectedTrack === r ? '1px solid rgba(167,139,250,0.4)' : '1px solid #1e1e2e',
                  }}
                >
                  <div className="text-sm font-bold truncate" style={{ color: '#e2e8f0' }}>{r.title}</div>
                  <div className="text-xs font-mono mt-0.5 truncate" style={{ color: '#64748b' }}>{r.artist}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Submit panel */}
          {selectedTrack && (
            <div
              className="flex-shrink-0 px-5 pb-8 pt-4 safe-bottom border-t"
              style={{ borderColor: '#1e1e2e', background: '#050508' }}
            >
              <p className="text-[10px] font-mono mb-3" style={{ color: '#475569' }}>
                REQUESTING: <span style={{ color: '#e2e8f0' }}>{selectedTrack.title}</span>
              </p>

              {tokenBalance > 0 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono" style={{ color: '#475569' }}>TOKENS TO SPEND</span>
                    <span className="text-xs font-mono font-bold" style={{ color: '#a78bfa' }}>◈ {tokensToSpend}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={tokenBalance}
                    value={tokensToSpend}
                    onChange={e => setTokensToSpend(Number(e.target.value))}
                    className="w-full"
                    style={{ color: '#a78bfa' }}
                  />
                  <p className="text-[10px] font-mono mt-1" style={{ color: '#3a3a5a' }}>
                    More tokens = higher priority in the queue
                  </p>
                </div>
              )}

              {requestMsg && (
                <p className="text-xs font-mono mb-3 text-center" style={{ color: requestMsg === 'Request sent!' ? '#22c55e' : '#ef4444' }}>
                  {requestMsg}
                </p>
              )}

              <button
                onPointerDown={handleSubmitRequest}
                disabled={submitting || (tokenBalance === 0)}
                className="w-full py-3.5 rounded-xl text-sm font-mono font-bold tracking-wider disabled:opacity-40"
                style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa' }}
              >
                {submitting ? 'SENDING…' : tokenBalance === 0 ? 'NO TOKENS — SWIPE TO EARN' : `REQUEST · ◈ ${tokensToSpend}`}
              </button>
            </div>
          )}
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
