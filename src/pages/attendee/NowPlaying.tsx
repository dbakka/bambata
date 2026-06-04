import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePartySocket } from '../../hooks/useSocket'
import { CountdownTimer } from '../../components/CountdownTimer'
import type { MixTrack } from '../../modules/mixing/MixingEngine'

interface StoredPass { id: string; attendee_name: string }
interface SearchResult { title: string; artist: string; previewUrl: string }

export default function NowPlaying() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()

  const [current, setCurrent] = useState<MixTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [durationMin, setDurationMin] = useState<number | null>(null)
  const [avgRating, setAvgRating] = useState<number | null>(null)
  const [ratingCount, setRatingCount] = useState(0)
  const [myRating, setMyRating] = useState(0)
  const [hoverStar, setHoverStar] = useState(0)
  const [timeUp, setTimeUp] = useState(false)

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
  const [tokenCode, setTokenCode] = useState('')
  const [redeemMsg, setRedeemMsg] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [extCode, setExtCode] = useState('')
  const [extMsg, setExtMsg] = useState('')
  const [extending, setExtending] = useState(false)
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

  useEffect(() => {
    if (!partyId) return
    fetch(`/api/parties/${partyId}/now`)
      .then(r => r.ok ? r.json() as Promise<{ current: MixTrack | null; startedAt: number | null; durationMin: number; playing: boolean }> : Promise.reject())
      .then(d => {
        if (d.current) {
          setCurrent(d.current)
          setPlaying(d.playing)
          fetch(`/api/parties/${partyId}/reactions/${d.current.id}`)
            .then(r => r.ok ? r.json() as Promise<{ avgRating: number | null; ratingCount: number }> : Promise.reject())
            .then(r => { setAvgRating(r.avgRating); setRatingCount(r.ratingCount) })
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
      setMyRating(0)
      setAvgRating(null)
      setRatingCount(0)
    })
    socket.on('player:state', (data: { playing: boolean }) => setPlaying(data.playing))
    socket.on('player:started', (data: { startedAt: number }) => setStartedAt(data.startedAt))
    socket.on('track:reacted', (data: { trackId: string; avgRating?: number | null; ratingCount?: number }) => {
      if (current?.id === data.trackId) {
        setAvgRating(data.avgRating ?? null)
        setRatingCount(data.ratingCount ?? 0)
      }
    })
    socket.on('wallet:updated', (data: { passId: string; balance: number }) => {
      if (data.passId === pass?.id) setTokenBalance(data.balance)
    })
    socket.on('party:done', () => navigate(`/party/${partyId}/ended`))
    socket.on('party:extended', (data: { durationMin: number }) => {
      setDurationMin(data.durationMin)
      setTimeUp(false)
      setExtMsg('')
      setExtCode('')
    })
    return () => {
      socket.off('player:track'); socket.off('player:state'); socket.off('player:started')
      socket.off('track:reacted'); socket.off('wallet:updated'); socket.off('party:done')
      socket.off('party:extended')
    }
  }, [socket, partyId, navigate, current?.id, pass?.id])

  const handleRate = useCallback((stars: number) => {
    if (!current) return
    setMyRating(stars)
    socket.emit('track:react', {
      partyId,
      trackId: current.id,
      passId: pass?.id,
      attendeeName: pass?.attendee_name,
      rating: stars,
    })
  }, [current, socket, partyId, pass])

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
        body: JSON.stringify({ passId: pass.id, trackTitle: selectedTrack.title, trackArtist: selectedTrack.artist, tokensSpent: tokensToSpend }),
      })
      if (!res.ok) { const d = await res.json() as { error: string }; setRequestMsg(d.error ?? 'Failed'); return }
      fetchWallet()
      setRequestMsg('Request sent!')
      setTimeout(() => { setShowRequest(false); setSearchQuery(''); setSearchResults([]); setSelectedTrack(null); setTokensToSpend(1); setRequestMsg('') }, 1500)
    } catch { setRequestMsg('Something went wrong') }
    finally { setSubmitting(false) }
  }

  const handleRedeemCode = async () => {
    if (!tokenCode.trim() || !pass?.id) return
    setRedeeming(true); setRedeemMsg('')
    try {
      const res = await fetch(`/api/parties/${partyId}/tokens/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passId: pass.id, code: tokenCode.trim() }),
      })
      const d = await res.json() as { balance?: number; error?: string }
      if (!res.ok) { setRedeemMsg(d.error ?? 'Invalid code'); return }
      setTokenBalance(d.balance ?? 0); setTokensToSpend(1); setTokenCode('')
      setRedeemMsg(`✓ ${d.balance} tokens added!`)
    } catch { setRedeemMsg('Something went wrong') }
    finally { setRedeeming(false) }
  }

  const handleExtend = async () => {
    if (!extCode.trim()) return
    setExtending(true); setExtMsg('')
    try {
      const res = await fetch(`/api/parties/${partyId}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: extCode.trim() }),
      })
      const d = await res.json() as { extraMin?: number; error?: string }
      if (!res.ok) { setExtMsg(d.error ?? 'Invalid code'); return }
      setExtMsg(`✓ +${d.extraMin} minutes added!`)
    } catch { setExtMsg('Something went wrong') }
    finally { setExtending(false) }
  }

  const endsAt = startedAt && durationMin ? startedAt + durationMin * 60 * 1000 : null
  const elapsed = startedAt ? Date.now() - startedAt : 0
  const totalMs = durationMin ? durationMin * 60 * 1000 : 1
  const progressPct = Math.min(100, (elapsed / totalMs) * 100)
  const remainingMs = endsAt ? Math.max(0, endsAt - Date.now()) : null
  const isNearEnd = remainingMs !== null && remainingMs < 15 * 60 * 1000
  const isCritical = remainingMs !== null && remainingMs < 5 * 60 * 1000

  const displayStar = hoverStar || myRating

  return (
    <div className="min-h-screen flex flex-col safe-top safe-bottom" style={{ background: '#050508', userSelect: 'none' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
        <span className="text-xs font-mono tracking-[0.3em]" style={{ color: '#1e1e2e' }}>BAMBATA</span>
        <div className="flex items-center gap-2">
          {avgRating !== null && avgRating > 0 && (
            <span className="text-xs font-mono" style={{ color: '#fbbf24' }}>★ {avgRating}</span>
          )}
          {tokenBalance > 0 && (
            <span className="text-xs font-mono" style={{ color: '#a78bfa' }}>◈ {tokenBalance}</span>
          )}
          {endsAt && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: isCritical ? '#ef4444' : isNearEnd ? '#ff9500' : '#22c55e' }} />
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

      {/* Main */}
      <div className="flex-1 flex flex-col items-center justify-between px-6 pb-4 min-h-0">

        {/* Track info */}
        <div className="flex-1 flex flex-col items-center justify-center text-center w-full min-h-0 gap-3">
          {current ? (
            <>
              {/* Pulsing icon */}
              <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 64, height: 64 }}>
                <div className="absolute w-16 h-16 rounded-full"
                  style={{ background: 'rgba(0,210,255,0.04)', animation: playing ? 'ping 2s ease-in-out infinite' : 'none' }} />
                <div className="absolute w-10 h-10 rounded-full"
                  style={{ background: 'rgba(0,210,255,0.07)', animation: playing ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
                <div className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(0,210,255,0.12)', border: '1px solid rgba(0,210,255,0.25)' }}>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#00d2ff' }}>
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
              </div>

              <p className="text-[10px] font-mono tracking-widest" style={{ color: '#475569' }}>
                {playing ? 'NOW PLAYING' : 'PAUSED'}
              </p>

              <div className="w-full min-w-0">
                <h1
                  className="font-black leading-tight truncate"
                  style={{
                    color: '#e2e8f0',
                    fontSize: current.title.length > 28 ? '1.4rem' : current.title.length > 20 ? '1.75rem' : '2.25rem',
                  }}
                >
                  {current.title}
                </h1>
                <p className="text-base mt-1 truncate" style={{ color: '#64748b' }}>{current.artist}</p>
              </div>

              {/* Energy dots */}
              <div className="flex gap-0.5 justify-center">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="rounded-full"
                    style={{ width: 5, height: 5, background: i < current.energy ? '#ff6b35' : '#1e1e2e' }} />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 64, height: 64 }}>
                <div className="absolute w-16 h-16 rounded-full"
                  style={{ background: 'rgba(0,210,255,0.02)', animation: 'ping 3s ease-in-out infinite' }} />
                <div className="w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(0,210,255,0.06)', border: '1px solid rgba(0,210,255,0.15)' }}>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#1e1e2e' }}>
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
              </div>
              <p className="text-sm" style={{ color: '#3a3a5a' }}>Waiting for the mix to start…</p>
            </>
          )}
        </div>

        {/* Star rating + actions */}
        {current && (
          <div className="w-full flex flex-col items-center gap-4 flex-shrink-0">
            {/* Stars */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-3">
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    onPointerDown={e => { e.stopPropagation(); handleRate(star) }}
                    onPointerEnter={() => setHoverStar(star)}
                    onPointerLeave={() => setHoverStar(0)}
                    className="transition-transform active:scale-90 touch-none"
                    style={{ fontSize: '2rem', lineHeight: 1, color: star <= displayStar ? '#fbbf24' : '#2a2a3a' }}
                  >
                    ★
                  </button>
                ))}
              </div>
              <p className="text-[10px] font-mono" style={{ color: '#3a3a5a' }}>
                {myRating > 0
                  ? `You rated ${myRating}★${ratingCount > 1 ? ` · avg ${avgRating}★ from ${ratingCount}` : ''}`
                  : ratingCount > 0
                    ? `${avgRating}★ avg · ${ratingCount} rating${ratingCount !== 1 ? 's' : ''}`
                    : 'Rate this track'}
              </p>
            </div>

            {/* Request button */}
            {pass?.id && (
              <button
                onPointerDown={e => { e.stopPropagation(); setShowRequest(true) }}
                className="w-full max-w-xs py-3 rounded-full text-xs font-mono tracking-widest"
                style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa' }}
              >
                + REQUEST A TRACK
              </button>
            )}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {endsAt && (
        <div className="px-5 pb-2 flex-shrink-0">
          {isNearEnd && (
            <p className="text-center text-[10px] font-mono mb-2" style={{ color: isCritical ? '#ef4444' : '#ff9500' }}>
              {isCritical ? 'PARTY ENDING SOON' : 'LAST 15 MINUTES'}
            </p>
          )}
          <div className="rounded-full overflow-hidden" style={{ height: 3, background: '#0f0f17' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${progressPct}%`,
                background: isCritical ? 'linear-gradient(90deg,#ef4444,#ff6b35)'
                  : isNearEnd ? 'linear-gradient(90deg,#ff9500,#ffcc00)'
                  : 'linear-gradient(90deg,#00d2ff,#a78bfa)',
                transition: 'width 1s linear',
              }}
            />
          </div>
        </div>
      )}

      {/* Time's Up overlay */}
      {timeUp && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center safe-top safe-bottom"
          style={{ background: 'rgba(5,5,8,0.97)' }}>
          <div className="text-4xl mb-4">⏱</div>
          <h2 className="text-2xl font-black tracking-wider mb-2"
            style={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono, monospace' }}>TIME'S UP</h2>
          <p className="text-sm mb-8" style={{ color: '#475569' }}>
            Ask the creator for an extension code to keep the music going.
          </p>
          <div className="w-full max-w-xs flex flex-col gap-3">
            <div className="flex gap-2">
              <input type="text" value={extCode} onChange={e => setExtCode(e.target.value.toUpperCase())}
                placeholder="EXTENSION CODE"
                className="flex-1 px-4 py-3 rounded-xl text-sm font-mono outline-none tracking-widest"
                style={{ background: '#0f0f17', border: '1px solid #2a2a3a', color: '#e2e8f0' }}
                onPointerDown={e => e.stopPropagation()} />
              <button onPointerDown={e => { e.stopPropagation(); handleExtend() }}
                disabled={extending || !extCode.trim()}
                className="px-4 py-3 rounded-xl text-sm font-mono font-bold disabled:opacity-40"
                style={{ background: 'rgba(0,210,255,0.15)', border: '1px solid rgba(0,210,255,0.4)', color: '#00d2ff' }}>
                {extending ? '…' : 'APPLY'}
              </button>
            </div>
            {extMsg && (
              <p className="text-xs font-mono text-center"
                style={{ color: extMsg.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{extMsg}</p>
            )}
          </div>
          <p className="text-[10px] font-mono mt-6" style={{ color: '#3a3a5a' }}>
            Extension codes are issued by the party creator
          </p>
        </div>
      )}

      {/* Request modal */}
      {showRequest && (
        <div className="fixed inset-0 z-40 flex flex-col safe-top safe-bottom"
          style={{ background: 'rgba(5,5,8,0.97)' }}
          onPointerDown={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
            <p className="text-xs font-mono font-bold tracking-widest" style={{ color: '#e2e8f0' }}>REQUEST A TRACK</p>
            <button
              onPointerDown={() => { setShowRequest(false); setSearchQuery(''); setSearchResults([]); setSelectedTrack(null); setRequestMsg(''); setTokenCode(''); setRedeemMsg('') }}
              className="text-xs font-mono" style={{ color: '#475569' }}>✕ CLOSE</button>
          </div>

          <div className="mx-5 mb-3 px-4 py-2 rounded-xl flex items-center justify-between flex-shrink-0"
            style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}>
            <span className="text-[10px] font-mono" style={{ color: '#475569' }}>YOUR TOKENS</span>
            <span className="text-sm font-mono font-bold" style={{ color: '#a78bfa' }}>◈ {tokenBalance}</span>
          </div>

          <div className="px-5 mb-3 flex-shrink-0">
            <input autoFocus type="text" value={searchQuery} onChange={e => handleSearch(e.target.value)}
              placeholder="Search by song or artist…"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono"
              style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#e2e8f0' }} />
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-3 min-h-0">
            {searching && <p className="text-xs font-mono text-center py-8 animate-pulse" style={{ color: '#475569' }}>SEARCHING…</p>}
            {!searching && searchResults.length === 0 && searchQuery.trim() && <p className="text-xs font-mono text-center py-8" style={{ color: '#3a3a5a' }}>No results</p>}
            {!searching && searchResults.length === 0 && !searchQuery.trim() && <p className="text-xs font-mono text-center py-8" style={{ color: '#3a3a5a' }}>Type to search for a track to request</p>}
            <div className="space-y-2">
              {searchResults.map((r, i) => (
                <button key={i} onPointerDown={() => setSelectedTrack(r)}
                  className="w-full text-left px-4 py-3 rounded-xl"
                  style={{ background: selectedTrack === r ? 'rgba(167,139,250,0.15)' : '#0a0a0f', border: selectedTrack === r ? '1px solid rgba(167,139,250,0.4)' : '1px solid #1e1e2e' }}>
                  <div className="text-sm font-bold truncate" style={{ color: '#e2e8f0' }}>{r.title}</div>
                  <div className="text-xs font-mono mt-0.5 truncate" style={{ color: '#64748b' }}>{r.artist}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedTrack && (
            <div className="flex-shrink-0 px-5 pb-6 pt-3 border-t" style={{ borderColor: '#1e1e2e', background: '#050508' }}>
              <p className="text-[10px] font-mono mb-3" style={{ color: '#475569' }}>
                REQUESTING: <span style={{ color: '#e2e8f0' }}>{selectedTrack.title}</span>
              </p>
              {tokenBalance === 0 ? (
                <div>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <div className="text-xl">◈</div>
                    <div>
                      <p className="text-xs font-mono font-bold" style={{ color: '#e2e8f0' }}>NO TOKENS LEFT</p>
                      <p className="text-[10px] font-mono mt-0.5" style={{ color: '#475569' }}>Enter a token code from the creator</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input type="text" value={tokenCode} onChange={e => setTokenCode(e.target.value.toUpperCase())}
                      placeholder="TOKEN CODE"
                      className="flex-1 px-3 py-2.5 rounded-xl text-sm font-mono outline-none tracking-widest"
                      style={{ background: '#0f0f17', border: '1px solid #2a2a3a', color: '#e2e8f0' }} />
                    <button onPointerDown={handleRedeemCode} disabled={redeeming || !tokenCode.trim()}
                      className="px-4 py-2.5 rounded-xl text-xs font-mono font-bold disabled:opacity-40"
                      style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}>
                      {redeeming ? '…' : 'APPLY'}
                    </button>
                  </div>
                  {redeemMsg && <p className="text-xs font-mono mb-2 text-center" style={{ color: redeemMsg.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{redeemMsg}</p>}
                  <p className="text-[10px] font-mono text-center" style={{ color: '#3a3a5a' }}>Ask the creator for a token top-up code</p>
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono" style={{ color: '#475569' }}>TOKENS TO SPEND</span>
                      <span className="text-xs font-mono font-bold" style={{ color: '#a78bfa' }}>◈ {tokensToSpend}</span>
                    </div>
                    <input type="range" min={1} max={tokenBalance} value={tokensToSpend}
                      onChange={e => setTokensToSpend(Number(e.target.value))}
                      className="w-full" style={{ color: '#a78bfa' }} />
                    <p className="text-[10px] font-mono mt-1" style={{ color: '#3a3a5a' }}>More tokens = higher priority</p>
                  </div>
                  {requestMsg && <p className="text-xs font-mono mb-3 text-center" style={{ color: requestMsg === 'Request sent!' ? '#22c55e' : '#ef4444' }}>{requestMsg}</p>}
                  <button onPointerDown={handleSubmitRequest} disabled={submitting}
                    className="w-full py-3.5 rounded-xl text-sm font-mono font-bold tracking-wider disabled:opacity-40"
                    style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa' }}>
                    {submitting ? 'SENDING…' : `REQUEST · ◈ ${tokensToSpend}`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
