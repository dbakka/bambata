import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Party, Track, Pass } from '../../types/party'
import { SwipeCard } from '../../components/SwipeCard'
import { CountdownTimer } from '../../components/CountdownTimer'
import { usePartySocket } from '../../hooks/useSocket'

interface SearchResult {
  title: string
  artist: string
  album: string
  duration_sec: number | null
  artwork_url: string | null
}

export default function SwipeWindow() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()

  const [tracks, setTracks] = useState<Track[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [swipedCount, setSwipedCount] = useState(0)
  const [party, setParty] = useState<Party | null>(null)
  const [pass, setPass] = useState<Pass | null>(null)
  const [done, setDone] = useState(false)
  const [swipedIds, setSwipedIds] = useState<Set<string>>(new Set())

  // Suggest panel
  const [showSuggest, setShowSuggest] = useState(false)
  const [suggestSearch, setSuggestSearch] = useState('')
  const [suggestResults, setSuggestResults] = useState<SearchResult[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [justSuggested, setJustSuggested] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const socket = usePartySocket(partyId ?? '')

  const loadData = useCallback(async () => {
    if (!partyId) return

    const passStored = localStorage.getItem(`bambata_pass_${partyId}`)
    if (!passStored) { navigate(`/party/${partyId}`); return }
    const p = JSON.parse(passStored) as Pass
    setPass(p)

    const [partyRes, tracksRes] = await Promise.all([
      fetch(`/api/parties/${partyId}`),
      fetch(`/api/parties/${partyId}/tracks`),
    ])

    const partyData = await partyRes.json() as Party
    setParty(partyData)

    if (partyData.status !== 'swipe_open') {
      navigate(`/party/${partyId}/closed`)
      return
    }

    setTracks(await tracksRes.json() as Track[])
  }, [partyId, navigate])

  useEffect(() => { loadData() }, [loadData])

  // Socket: state changes + live track additions
  useEffect(() => {
    socket.on('swipe:closed', () => navigate(`/party/${partyId}/closed`))
    socket.on('party:done', () => navigate(`/party/${partyId}/closed`))
    socket.on('party:status', (data: { status: Party['status'] }) => {
      if (data.status === 'mixing') navigate(`/party/${partyId}/now`)
      else if (data.status !== 'swipe_open') navigate(`/party/${partyId}/closed`)
    })
    // Mix has started — go straight to the live room
    socket.on('player:started', () => navigate(`/party/${partyId}/now`))
    socket.on('player:track', (data: { current: unknown }) => {
      if (data.current) navigate(`/party/${partyId}/now`)
    })
    socket.on('track:added', (data: { track: Track }) => {
      setTracks((prev) => {
        if (prev.find((t) => t.id === data.track.id)) return prev
        return [...prev, data.track]
      })
    })
    socket.on('tracks:seeded', (data: { tracks: Track[] }) => {
      setTracks(data.tracks)
    })
    return () => {
      socket.off('swipe:closed')
      socket.off('party:done')
      socket.off('party:status')
      socket.off('player:started')
      socket.off('player:track')
      socket.off('track:added')
      socket.off('tracks:seeded')
    }
  }, [socket, partyId, navigate])

  // Debounced search for suggest panel
  useEffect(() => {
    if (suggestSearch.length < 1) { setSuggestResults([]); return }
    setSuggesting(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/tracks?q=${encodeURIComponent(suggestSearch)}`)
        if (res.ok) setSuggestResults(await res.json() as SearchResult[])
      } catch {}
      finally { setSuggesting(false) }
    }, 200)
    return () => clearTimeout(timer)
  }, [suggestSearch])

  const handleSwipe = useCallback(
    async (direction: 'left' | 'right') => {
      if (!partyId || !pass || currentIndex >= tracks.length) return
      const track = tracks[currentIndex]
      if (swipedIds.has(track.id)) { setCurrentIndex((i) => i + 1); return }

      setSwipedIds((prev) => new Set([...prev, track.id]))
      setCurrentIndex((i) => i + 1)
      setSwipedCount((c) => c + 1)

      try {
        await fetch(`/api/parties/${partyId}/swipe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passId: pass.id, trackId: track.id, direction }),
        })
      } catch {}
    },
    [partyId, pass, currentIndex, tracks, swipedIds],
  )

  const handleSuggest = async (result: SearchResult) => {
    if (!partyId || !pass || submitLoading) return
    setSubmitLoading(true)
    try {
      const res = await fetch(`/api/parties/${partyId}/tracks/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passId: pass.id,
          title: result.title,
          artist: result.artist,
          duration_sec: result.duration_sec,
        }),
      })
      if (res.ok) {
        setJustSuggested(result.title)
        setSuggestSearch('')
        setSuggestResults([])
        setTimeout(() => {
          setJustSuggested(null)
          setShowSuggest(false)
        }, 2000)
      }
    } catch {}
    finally { setSubmitLoading(false) }
  }

  const unanswered = tracks.filter((t) => !swipedIds.has(t.id))
  const progress = tracks.length > 0 ? swipedCount / tracks.length : 0

  if (!party && tracks.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050508' }}>
        <span className="text-xs font-mono animate-pulse" style={{ color: '#475569' }}>LOADING...</span>
      </div>
    )
  }

  // Deck is empty (swiped everything) — show brief confirmation then go to live room
  if (tracks.length > 0 && unanswered.length === 0 && !showSuggest) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center safe-top safe-bottom" style={{ background: '#050508' }}>
        {party?.name && (
          <p className="text-[10px] font-mono tracking-widest mb-6" style={{ color: '#3a3a5a' }}>
            {party.name.toUpperCase()}
          </p>
        )}
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}
          >
            <svg className="w-8 h-8" style={{ color: '#22c55e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>You're all voted!</h2>
            <p className="text-sm mt-2" style={{ color: '#475569' }}>
              Bambata is reading the room.
            </p>
          </div>
          <p className="text-xs font-mono" style={{ color: '#475569' }}>
            {swipedCount} tracks rated
          </p>

          {/* Go to the live room */}
          <button
            onClick={() => navigate(`/party/${partyId}/now`)}
            className="w-full py-4 rounded-xl font-bold text-sm tracking-wider"
            style={{ background: 'rgba(0,210,255,0.12)', border: '1px solid rgba(0,210,255,0.35)', color: '#00d2ff', fontFamily: 'JetBrains Mono, monospace' }}
          >
            ENTER THE MIX →
          </button>

          <button
            onClick={() => { setSuggestSearch(''); setShowSuggest(true); setTimeout(() => searchRef.current?.focus(), 100) }}
            className="text-sm font-mono px-5 py-2.5 rounded-xl"
            style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', color: '#a78bfa' }}
          >
            + Suggest a track first
          </button>
        </div>
      </div>
    )
  }

  const currentTrack = tracks[currentIndex] ?? unanswered[0] ?? null

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#050508' }}>
      {/* Party identity header */}
      <div className="px-5 pt-5 pb-3 safe-top" style={{ borderBottom: '1px solid #0f0f17' }}>
        <p className="text-[10px] font-mono tracking-widest mb-0.5" style={{ color: '#3a3a5a' }}>NOW VOTING FOR</p>
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-black leading-tight truncate" style={{ color: '#e2e8f0' }}>
              {party?.name ?? '—'}
            </h1>
            {party?.venue && (
              <p className="text-xs font-mono truncate" style={{ color: '#475569' }}>{party.venue}</p>
            )}
          </div>
          {party?.swipe_ends_at && (
            <div className="flex-shrink-0 ml-3">
              <CountdownTimer endsAt={party.swipe_ends_at} onExpire={() => navigate(`/party/${partyId}/closed`)} />
            </div>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid #1e1e2e' }}>
        <span className="text-xs font-mono" style={{ color: '#475569' }}>
          {swipedCount} voted
        </span>
        <button
          onClick={() => { setSuggestSearch(''); setShowSuggest(true); setTimeout(() => searchRef.current?.focus(), 100) }}
          className="text-xs font-mono px-3 py-1 rounded-lg"
          style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', color: '#a78bfa' }}
        >
          + Suggest
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5" style={{ background: '#1e1e2e' }}>
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${progress * 100}%`, background: 'linear-gradient(90deg, #a78bfa, #00d2ff)' }}
        />
      </div>

      {/* Card stack */}
      <div className="flex-1 flex items-center justify-center px-4 py-6">
        {tracks.length === 0 ? (
          <div className="text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'rgba(0,210,255,0.06)', border: '1px solid rgba(0,210,255,0.15)' }}
            >
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#00d2ff', borderTopColor: 'transparent' }} />
            </div>
            <p className="text-sm font-mono" style={{ color: '#475569' }}>
              Bambata is curating your set…
            </p>
          </div>
        ) : (
          <div className="relative w-full max-w-sm" style={{ height: '420px' }}>
            {tracks
              .slice(currentIndex, currentIndex + 2)
              .reverse()
              .map((track, idx, arr) => {
                const isTop = idx === arr.length - 1
                return <SwipeCard key={track.id} track={track} onSwipe={handleSwipe} isTop={isTop} />
              })}
          </div>
        )}
      </div>

      {/* Legend */}
      {unanswered.length > 0 && (
        <div
          className="px-6 py-4 flex items-center justify-between text-xs font-mono"
          style={{ borderTop: '1px solid #1e1e2e', color: '#475569' }}
        >
          <span style={{ color: '#ef4444' }}>← SKIP</span>
          <span>{unanswered.length} left</span>
          <span style={{ color: '#22c55e' }}>YEAH →</span>
        </div>
      )}

      {/* Suggest panel (bottom sheet) */}
      {showSuggest && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSuggest(false) }}
        >
          <div
            className="w-full rounded-t-2xl flex flex-col"
            style={{ background: '#0f0f17', border: '1px solid #1e1e2e', maxHeight: '80vh' }}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <h3 className="text-sm font-mono font-bold" style={{ color: '#a78bfa' }}>
                SUGGEST A TRACK
              </h3>
              <button onClick={() => setShowSuggest(false)} style={{ color: '#475569' }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {justSuggested ? (
              <div className="px-5 py-10 text-center">
                <div className="text-3xl mb-3">🎵</div>
                <p className="font-bold" style={{ color: '#22c55e' }}>Added to the deck!</p>
                <p className="text-sm mt-1" style={{ color: '#475569' }}>{justSuggested}</p>
              </div>
            ) : (
              <>
                <div className="px-5 pb-3 flex-shrink-0">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                      {suggesting ? (
                        <div className="w-3.5 h-3.5 rounded-full border border-t-transparent animate-spin" style={{ borderColor: '#a78bfa', borderTopColor: 'transparent' }} />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#475569' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      )}
                    </div>
                    <input
                      ref={searchRef}
                      placeholder="Search by title or artist…"
                      value={suggestSearch}
                      onChange={(e) => setSuggestSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: '#181825', border: '1px solid rgba(167,139,250,0.2)', color: '#e2e8f0' }}
                    />
                  </div>
                </div>

                <div className="overflow-y-auto flex-1 px-5 pb-5">
                  {suggestResults.length === 0 && suggestSearch.length >= 1 && !suggesting && (
                    <p className="text-xs font-mono text-center py-4" style={{ color: '#3a3a5a' }}>
                      No results found
                    </p>
                  )}
                  <div className="space-y-1">
                    {suggestResults.map((result, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSuggest(result)}
                        disabled={submitLoading}
                        className="w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 disabled:opacity-50"
                        style={{ background: '#181825' }}
                      >
                        {result.artwork_url ? (
                          <img src={result.artwork_url} alt="" className="w-10 h-10 rounded-lg flex-shrink-0 object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: '#1e1e2e' }}>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#3a3a5a' }}>
                              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                            </svg>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>{result.title}</div>
                          <div className="text-xs truncate mt-0.5" style={{ color: '#64748b' }}>
                            {result.artist}{result.album ? ` · ${result.album}` : ''}
                          </div>
                        </div>
                        <span className="text-[10px] font-mono flex-shrink-0 px-2 py-1 rounded" style={{ background: 'rgba(167,139,250,0.1)', color: '#a78bfa' }}>
                          ADD
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
