import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Party, Track, AccessCode } from '../../types/party'
import { TrackLibrary } from '../../components/TrackLibrary'
import { CountdownTimer } from '../../components/CountdownTimer'
import { useCreatorSocket } from '../../hooks/useSocket'
import { destroyEngine } from '../../modules/mixing/engineSingleton'
import ClaimAccount from '../../components/ClaimAccount'

type Tab = 'setup' | 'live' | 'queue' | 'requests' | 'cast'

interface TokenRequest {
  id: string
  party_id: string
  pass_id: string
  track_title: string
  track_artist: string
  tokens_spent: number
  vote_count: number
  status: 'pending' | 'accepted' | 'rejected' | 'played'
  created_at: number
}

interface SearchResult {
  title: string
  artist: string
  album: string
  duration_sec: number | null
  artwork_url: string | null
  genre: string
  preview_url: string | null
}

interface AddTrackForm {
  title: string
  artist: string
  bpm: string
  musicalKey: string
  energy: number
  durationSec: string
  audiomackUrl: string
}

export default function Dashboard() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()
  const creatorToken = partyId ? localStorage.getItem(`bambata_creator_${partyId}`) ?? '' : ''

  const [party, setParty] = useState<Party | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [queue, setQueue] = useState<Track[]>([])
  const [codes, setCodes] = useState<AccessCode[]>([])
  const [tab, setTab] = useState<Tab>('setup')
  const [showAddTrack, setShowAddTrack] = useState(false)
  const [addForm, setAddForm] = useState<AddTrackForm>({
    title: '',
    artist: '',
    bpm: '',
    musicalKey: '',
    energy: 5,
    durationSec: '',
    audiomackUrl: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [totalPasses, setTotalPasses] = useState(0)
  const [liveSwipes, setLiveSwipes] = useState<{ trackId: string; swipeCount: number; totalSwipes: number } | null>(null)
  const [showOpenConfirm, setShowOpenConfirm] = useState(false)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [requests, setRequests] = useState<TokenRequest[]>([])
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [trackSearch, setTrackSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  const socket = useCreatorSocket(partyId ?? '', creatorToken)

  const fetchAll = useCallback(async () => {
    if (!partyId) return
    const headers = { 'x-creator-token': creatorToken }
    const [partyRes, tracksRes, codesRes] = await Promise.all([
      fetch(`/api/parties/${partyId}`, { headers }),
      fetch(`/api/parties/${partyId}/tracks`),
      fetch(`/api/parties/${partyId}/codes`, { headers }),
    ])
    if (partyRes.ok) setParty(await partyRes.json() as Party)
    if (tracksRes.ok) setTracks(await tracksRes.json() as Track[])
    if (codesRes.ok) {
      const c = await codesRes.json() as AccessCode[]
      setCodes(c)
      setTotalPasses(c.filter((x) => x.type === 'pass' && x.redeemed_by_pass_id).length)
    }
  }, [partyId, creatorToken])

  const fetchQueue = useCallback(async () => {
    if (!partyId) return
    const res = await fetch(`/api/parties/${partyId}/queue`)
    if (res.ok) setQueue(await res.json() as Track[])
  }, [partyId])

  const fetchRequests = useCallback(async () => {
    if (!partyId) return
    const res = await fetch(`/api/parties/${partyId}/requests`, {
      headers: { 'x-creator-token': creatorToken },
    })
    if (res.ok) setRequests(await res.json() as TokenRequest[])
  }, [partyId, creatorToken])

  useEffect(() => {
    if (!partyId || !creatorToken) {
      navigate('/')
      return
    }
    fetchAll()
    fetchQueue()
    fetchRequests()
  }, [partyId, creatorToken, fetchAll, fetchQueue, fetchRequests, navigate])

  useEffect(() => {
    socket.on('swipe:update', (data: { trackId: string; swipeCount: number; totalSwipes: number }) => {
      setLiveSwipes(data)
      setTracks((prev) =>
        prev.map((t) => (t.id === data.trackId ? { ...t, swipe_count: data.swipeCount } : t)),
      )
    })

    socket.on('swipe:opened', (data: { endsAt: number }) => {
      setParty((p) => p ? { ...p, status: 'swipe_open', swipe_ends_at: data.endsAt } : p)
      setTab('live')
    })

    socket.on('swipe:closed', () => {
      setParty((p) => p ? { ...p, status: 'pending', swipe_ends_at: null } : p)
      setTab('queue')
      fetchQueue()
    })

    socket.on('party:status', (data: { status: Party['status']; queue?: Track[] }) => {
      setParty((p) => p ? { ...p, status: data.status } : p)
      if (data.queue) setQueue(data.queue)
    })

    socket.on('pass:count', (data: { total: number }) => {
      setTotalPasses(data.total)
    })

    socket.on('request:new', (data: { request: TokenRequest }) => {
      setRequests((prev) => {
        if (prev.find((r) => r.id === data.request.id)) return prev
        return [data.request, ...prev]
      })
    })

    socket.on('request:voted', (data: { requestId: string; voteCount: number }) => {
      setRequests((prev) =>
        prev.map((r) => r.id === data.requestId ? { ...r, vote_count: data.voteCount } : r)
      )
    })

    return () => {
      socket.off('swipe:update')
      socket.off('swipe:opened')
      socket.off('swipe:closed')
      socket.off('party:status')
      socket.off('pass:count')
      socket.off('request:new')
      socket.off('request:voted')
    }
  }, [socket, fetchQueue])

  useEffect(() => {
    if (trackSearch.length < 1) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/tracks?q=${encodeURIComponent(trackSearch)}`)
        if (res.ok) setSearchResults(await res.json() as SearchResult[])
      } catch {}
      finally { setSearching(false) }
    }, 200)
    return () => clearTimeout(timer)
  }, [trackSearch])

  const handleAddTrack = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!partyId) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/parties/${partyId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-creator-token': creatorToken },
        body: JSON.stringify({
          title: addForm.title,
          artist: addForm.artist,
          bpm: addForm.bpm ? Number(addForm.bpm) : undefined,
          musicalKey: addForm.musicalKey || undefined,
          energy: addForm.energy,
          durationSec: addForm.durationSec ? Number(addForm.durationSec) : undefined,
          audiomackUrl: addForm.audiomackUrl || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json() as { error: string }).error)
      const track = await res.json() as Track
      setTracks((prev) => [...prev, track])
      setShowAddTrack(false)
      setAddForm({ title: '', artist: '', bpm: '', musicalKey: '', energy: 5, durationSec: '', audiomackUrl: '' })
      setTrackSearch('')
      setSearchResults([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add track')
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveTrack = async (trackId: string) => {
    if (!partyId) return
    await fetch(`/api/parties/${partyId}/tracks/${trackId}`, {
      method: 'DELETE',
      headers: { 'x-creator-token': creatorToken },
    })
    setTracks((prev) => prev.filter((t) => t.id !== trackId))
  }

  const handleGenerateCodes = async (type: 'pass' | 'tokens') => {
    if (!partyId) return
    const res = await fetch(`/api/parties/${partyId}/codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-creator-token': creatorToken },
      body: JSON.stringify(
        type === 'pass'
          ? { type: 'pass', count: 10 }
          : { type: 'tokens', count: 5, tokenAmount: 20 },
      ),
    })
    if (res.ok) {
      const newCodes = await res.json() as AccessCode[]
      setCodes((prev) => [...prev, ...newCodes])
    }
  }

  const handleOpenSwipeWindow = async () => {
    if (!partyId) return
    setShowOpenConfirm(false)
    const res = await fetch(`/api/parties/${partyId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-creator-token': creatorToken },
      body: JSON.stringify({ status: 'swipe_open' }),
    })
    if (res.ok) {
      const p = await res.json() as Party
      setParty(p)
      setTab('live')
    }
  }

  const handleEndParty = async () => {
    if (!partyId) return
    setShowEndConfirm(false)
    destroyEngine()
    await fetch(`/api/parties/${partyId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-creator-token': creatorToken },
      body: JSON.stringify({ status: 'done' }),
    })
    await fetchAll()
  }

  const handleForceClose = async () => {
    if (!partyId) return
    const res = await fetch(`/api/parties/${partyId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-creator-token': creatorToken },
      body: JSON.stringify({ status: 'pending' }),
    })
    if (res.ok) {
      await fetchAll()
      await fetchQueue()
      setTab('queue')
    }
  }

  const handleStartMix = async () => {
    if (!partyId) return
    const res = await fetch(`/api/parties/${partyId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-creator-token': creatorToken },
      body: JSON.stringify({ status: 'mixing' }),
    })
    if (res.ok) {
      const p = await res.json() as Party
      setParty(p)
    }
  }

  const handleExportPlaylist = () => {
    const data = JSON.stringify(queue, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${party?.name ?? 'bambata'}-playlist.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleAcceptRequest = async (reqId: string) => {
    if (!partyId) return
    setAcceptingId(reqId)
    try {
      const res = await fetch(`/api/parties/${partyId}/requests/${reqId}/accept`, {
        method: 'POST',
        headers: { 'x-creator-token': creatorToken },
      })
      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) => r.id === reqId ? { ...r, status: 'accepted' as const } : r)
        )
        await fetchQueue()
      }
    } finally {
      setAcceptingId(null)
    }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const shareUrl = partyId ? `${window.location.origin}/party/${partyId}` : ''
  const passCodes = codes.filter((c) => c.type === 'pass')
  const tokenCodes = codes.filter((c) => c.type === 'tokens')
  const sortedBySwipes = [...tracks].sort((a, b) => b.swipe_count - a.swipe_count)
  const totalSwipes = liveSwipes?.totalSwipes ?? tracks.reduce((sum, t) => sum + t.swipe_count, 0)

  if (!party) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050508' }}>
        <span className="text-xs font-mono animate-pulse" style={{ color: '#475569' }}>
          LOADING...
        </span>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#050508', fontFamily: 'system-ui' }}>
      {/* Header */}
      <div className="sticky top-0 z-50 px-4 py-3 flex items-center justify-between" style={{ background: '#050508', borderBottom: '1px solid #1e1e2e' }}>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: '#00d2ff', fontFamily: 'JetBrains Mono, monospace' }}>
              {party.name.toUpperCase()}
            </span>
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{
                background:
                  party.status === 'swipe_open'
                    ? 'rgba(34, 197, 94, 0.15)'
                    : party.status === 'mixing'
                    ? 'rgba(0, 210, 255, 0.15)'
                    : 'rgba(71, 85, 105, 0.3)',
                color:
                  party.status === 'swipe_open'
                    ? '#22c55e'
                    : party.status === 'mixing'
                    ? '#00d2ff'
                    : '#475569',
                border: `1px solid ${
                  party.status === 'swipe_open'
                    ? 'rgba(34, 197, 94, 0.3)'
                    : party.status === 'mixing'
                    ? 'rgba(0, 210, 255, 0.3)'
                    : '#1e1e2e'
                }`,
              }}
            >
              {party.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
          <div className="text-[11px] font-mono mt-0.5" style={{ color: '#475569' }}>
            {party.venue} · {party.date}
          </div>
        </div>

        {/* Stats + end party */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-xs font-mono" style={{ color: '#475569' }}>
            <span>{totalPasses} in</span>
            <span style={{ color: '#a78bfa' }}>{totalSwipes} swipes</span>
          </div>
          {party.status === 'done' ? (
            <button
              onClick={() => navigate('/')}
              className="text-[10px] font-mono px-2.5 py-1 rounded-lg"
              style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa' }}
            >
              ← HOME
            </button>
          ) : (
            <button
              onClick={() => setShowEndConfirm(true)}
              className="text-[10px] font-mono px-2.5 py-1 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}
            >
              END
            </button>
          )}
        </div>
      </div>

      {/* Share URL */}
      <div
        className="mx-4 mt-3 px-4 py-2.5 rounded-xl flex items-center justify-between gap-2"
        style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
      >
        <span className="text-xs font-mono truncate" style={{ color: '#475569' }}>
          {shareUrl}
        </span>
        <button
          onClick={() => copyToClipboard(shareUrl, 'shareurl')}
          className="text-xs font-mono flex-shrink-0 px-3 py-1 rounded-lg transition-all"
          style={{
            background: copied === 'shareurl' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(0, 210, 255, 0.1)',
            border: copied === 'shareurl' ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(0, 210, 255, 0.2)',
            color: copied === 'shareurl' ? '#22c55e' : '#00d2ff',
          }}
        >
          {copied === 'shareurl' ? 'COPIED' : 'COPY'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex px-4 mt-4 gap-1" style={{ borderBottom: '1px solid #1e1e2e' }}>
        {(['setup', 'live', 'queue', 'requests', 'cast'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative px-4 py-2 text-xs font-mono font-bold tracking-wider transition-all"
            style={{
              color: tab === t ? '#00d2ff' : '#475569',
              borderBottom: tab === t ? '2px solid #00d2ff' : '2px solid transparent',
            }}
          >
            {t.toUpperCase()}
            {t === 'requests' && requests.filter((r) => r.status === 'pending').length > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-mono"
                style={{ background: '#ff6b35', color: '#050508' }}
              >
                {requests.filter((r) => r.status === 'pending').length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="px-4 py-4">
        {/* ── SETUP TAB ── */}
        {tab === 'setup' && (
          <div className="space-y-6">
            {/* Track Library */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: '#475569' }}>
                  TRACK LIBRARY ({tracks.length})
                </h2>
                <button
                  onClick={() => setShowAddTrack(true)}
                  className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: 'rgba(0, 210, 255, 0.1)',
                    border: '1px solid rgba(0, 210, 255, 0.3)',
                    color: '#00d2ff',
                  }}
                >
                  + ADD TRACK
                </button>
              </div>
              <TrackLibrary tracks={tracks} onRemove={handleRemoveTrack} />
            </div>

            {/* Access Codes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: '#475569' }}>
                  PASS CODES ({passCodes.filter((c) => c.redeemed_by_pass_id).length}/{passCodes.length} redeemed)
                </h2>
                <button
                  onClick={() => handleGenerateCodes('pass')}
                  className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: 'rgba(167, 139, 250, 0.1)',
                    border: '1px solid rgba(167, 139, 250, 0.3)',
                    color: '#a78bfa',
                  }}
                >
                  GEN 10
                </button>
              </div>
              {passCodes.length > 0 && (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ border: '1px solid #1e1e2e' }}
                >
                  {passCodes.map((code) => (
                    <div
                      key={code.id}
                      className="flex items-center justify-between px-3 py-2.5"
                      style={{
                        borderBottom: '1px solid #1e1e2e',
                        background: code.redeemed_by_pass_id ? 'rgba(34, 197, 94, 0.03)' : 'transparent',
                      }}
                    >
                      <span
                        className="text-sm font-mono font-bold"
                        style={{ color: code.redeemed_by_pass_id ? '#22c55e' : '#e2e8f0', opacity: code.redeemed_by_pass_id ? 0.6 : 1 }}
                      >
                        {code.code}
                      </span>
                      <button
                        onClick={() => copyToClipboard(code.code, code.id)}
                        className="text-[10px] font-mono px-2 py-1 rounded"
                        style={{ color: copied === code.id ? '#22c55e' : '#475569' }}
                      >
                        {copied === code.id ? 'COPIED' : 'COPY'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Token Codes */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: '#475569' }}>
                  TOKEN BUNDLES ({tokenCodes.filter((c) => c.redeemed_by_pass_id).length}/{tokenCodes.length} redeemed)
                </h2>
                <button
                  onClick={() => handleGenerateCodes('tokens')}
                  className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: 'rgba(255, 107, 53, 0.1)',
                    border: '1px solid rgba(255, 107, 53, 0.3)',
                    color: '#ff6b35',
                  }}
                >
                  GEN 5
                </button>
              </div>
              {tokenCodes.length > 0 && (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ border: '1px solid #1e1e2e' }}
                >
                  {tokenCodes.map((code) => (
                    <div
                      key={code.id}
                      className="flex items-center justify-between px-3 py-2.5"
                      style={{
                        borderBottom: '1px solid #1e1e2e',
                        background: code.redeemed_by_pass_id ? 'rgba(34, 197, 94, 0.03)' : 'transparent',
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="text-sm font-mono font-bold"
                          style={{ color: code.redeemed_by_pass_id ? '#22c55e' : '#e2e8f0', opacity: code.redeemed_by_pass_id ? 0.6 : 1 }}
                        >
                          {code.code}
                        </span>
                        <span className="text-xs font-mono" style={{ color: '#ff6b35' }}>
                          {code.token_amount}T
                        </span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(code.code, code.id)}
                        className="text-[10px] font-mono px-2 py-1 rounded"
                        style={{ color: copied === code.id ? '#22c55e' : '#475569' }}
                      >
                        {copied === code.id ? 'COPIED' : 'COPY'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Door Scanner link */}
            <button
              onClick={() => navigate(`/door/${partyId}`)}
              className="w-full py-3 rounded-xl text-xs font-mono font-bold tracking-wider transition-all"
              style={{
                background: '#0f0f17',
                border: '1px solid #1e1e2e',
                color: '#475569',
              }}
            >
              OPEN DOOR SCANNER
            </button>

            {/* Open Swipe Window */}
            {party.status === 'pending' && (
              <div>
                {!showOpenConfirm ? (
                  <button
                    onClick={() => setShowOpenConfirm(true)}
                    disabled={tracks.length < 3}
                    className="w-full py-4 rounded-xl font-bold text-sm tracking-wider transition-all disabled:opacity-40"
                    style={{
                      background:
                        tracks.length >= 3
                          ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(34, 197, 94, 0.1) 100%)'
                          : '#0f0f17',
                      border: `1px solid ${tracks.length >= 3 ? 'rgba(34, 197, 94, 0.4)' : '#1e1e2e'}`,
                      color: tracks.length >= 3 ? '#22c55e' : '#475569',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {tracks.length < 3 ? `ADD ${3 - tracks.length} MORE TRACK${3 - tracks.length === 1 ? '' : 'S'}` : 'OPEN SWIPE WINDOW'}
                  </button>
                ) : (
                  <div
                    className="p-4 rounded-xl"
                    style={{ background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.3)' }}
                  >
                    <p className="text-sm text-center mb-4" style={{ color: '#e2e8f0' }}>
                      Open a 5-minute swipe window for all {totalPasses} attendees?
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowOpenConfirm(false)}
                        className="flex-1 py-3 rounded-xl text-xs font-mono"
                        style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#475569' }}
                      >
                        CANCEL
                      </button>
                      <button
                        onClick={handleOpenSwipeWindow}
                        className="flex-1 py-3 rounded-xl text-sm font-bold font-mono"
                        style={{
                          background: 'rgba(34, 197, 94, 0.2)',
                          border: '1px solid rgba(34, 197, 94, 0.5)',
                          color: '#22c55e',
                        }}
                      >
                        OPEN
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── LIVE TAB ── */}
        {tab === 'live' && (
          <div className="space-y-4">
            {party.status === 'swipe_open' && party.swipe_ends_at && (
              <div
                className="p-4 rounded-xl flex items-center justify-between"
                style={{ background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.3)' }}
              >
                <div>
                  <div className="text-xs font-mono" style={{ color: '#22c55e' }}>
                    SWIPE WINDOW OPEN
                  </div>
                  <div className="text-xs font-mono mt-1" style={{ color: '#475569' }}>
                    {totalSwipes} total swipes
                  </div>
                </div>
                <CountdownTimer
                  endsAt={party.swipe_ends_at}
                  onExpire={fetchAll}
                  className="text-2xl"
                />
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: '#475569' }}>
                LIVE RANKINGS
              </h2>
              <button
                onClick={handleForceClose}
                className="text-xs font-mono px-3 py-1.5 rounded-lg"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                }}
              >
                FORCE CLOSE
              </button>
            </div>

            <TrackLibrary tracks={sortedBySwipes} showSwipeCounts />
          </div>
        )}

        {/* ── QUEUE TAB ── */}
        {tab === 'queue' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: '#475569' }}>
                QUEUE ({queue.length} tracks)
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={handleExportPlaylist}
                  className="text-xs font-mono px-3 py-1.5 rounded-lg"
                  style={{
                    background: '#0f0f17',
                    border: '1px solid #1e1e2e',
                    color: '#475569',
                  }}
                >
                  EXPORT
                </button>
                {party.status === 'pending' && queue.length > 0 && (
                  <button
                    onClick={handleStartMix}
                    className="text-xs font-mono px-3 py-1.5 rounded-lg font-bold"
                    style={{
                      background: 'rgba(0, 210, 255, 0.15)',
                      border: '1px solid rgba(0, 210, 255, 0.4)',
                      color: '#00d2ff',
                    }}
                  >
                    START MIX
                  </button>
                )}
                {queue.length > 0 && (
                  <button
                    onClick={() => navigate(`/player/${partyId}`)}
                    className="text-xs font-mono px-3 py-1.5 rounded-lg font-bold"
                    style={{
                      background: 'rgba(167, 139, 250, 0.15)',
                      border: '1px solid rgba(167, 139, 250, 0.4)',
                      color: '#a78bfa',
                    }}
                  >
                    OPEN PLAYER
                  </button>
                )}
              </div>
            </div>

            {queue.length === 0 ? (
              <div className="text-center py-8 text-slate-500 font-mono text-sm">
                Queue builds after the swipe window closes.
              </div>
            ) : (
              <TrackLibrary tracks={queue} showSwipeCounts showQueuePosition />
            )}
          </div>
        )}

        {/* ── REQUESTS TAB ── */}
        {tab === 'requests' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: '#475569' }}>
                TRACK REQUESTS ({requests.length})
              </h2>
            </div>

            {requests.length === 0 ? (
              <div className="text-center py-8 font-mono text-sm" style={{ color: '#3a3a5a' }}>
                No requests yet — attendees with tokens can request tracks.
              </div>
            ) : (
              <div className="space-y-2">
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{
                      background: req.status === 'accepted' ? 'rgba(34,197,94,0.04)' : '#0f0f17',
                      border: req.status === 'accepted'
                        ? '1px solid rgba(34,197,94,0.2)'
                        : '1px solid #1e1e2e',
                      opacity: req.status === 'accepted' ? 0.6 : 1,
                    }}
                  >
                    {/* Vote count */}
                    <div className="flex-shrink-0 text-center w-10">
                      <div className="text-lg font-black font-mono" style={{ color: '#ff6b35', lineHeight: 1 }}>
                        {req.tokens_spent}
                      </div>
                      <div className="text-[9px] font-mono" style={{ color: '#3a3a5a' }}>TOKENS</div>
                    </div>

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>
                        {req.track_title}
                      </div>
                      <div className="text-xs truncate mt-0.5" style={{ color: '#64748b' }}>
                        {req.track_artist}
                      </div>
                    </div>

                    {/* Status / Action */}
                    {req.status === 'accepted' ? (
                      <span
                        className="text-[9px] font-mono px-2 py-1 rounded flex-shrink-0"
                        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                      >
                        ACCEPTED
                      </span>
                    ) : (
                      <button
                        onClick={() => handleAcceptRequest(req.id)}
                        disabled={acceptingId === req.id}
                        className="text-[10px] font-mono px-3 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-50"
                        style={{
                          background: 'rgba(0,210,255,0.1)',
                          border: '1px solid rgba(0,210,255,0.3)',
                          color: '#00d2ff',
                        }}
                      >
                        {acceptingId === req.id ? '...' : 'ACCEPT'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CAST TAB ── */}
        {tab === 'cast' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-mono font-bold tracking-wider mb-1" style={{ color: '#475569' }}>
                CAST SCREEN
              </h2>
              <p className="text-xs font-mono" style={{ color: '#3a3a5a' }}>
                A full-screen display for TV or projector. Shows live attendees, voting progress, and QR code so guests can join from their seats.
              </p>
            </div>

            {/* Open cast screen */}
            <button
              onClick={() => window.open(`/party/${partyId}/cast`, '_blank')}
              className="w-full py-4 rounded-xl font-bold text-sm tracking-widest transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-3"
              style={{
                background: 'linear-gradient(135deg, rgba(0,210,255,0.12), rgba(167,139,250,0.12))',
                border: '1px solid rgba(0,210,255,0.3)',
                color: '#00d2ff',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              OPEN CAST SCREEN
            </button>

            {/* Copy cast URL */}
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
            >
              <span className="text-xs font-mono flex-1 truncate" style={{ color: '#3a3a5a' }}>
                {`${window.location.origin}/party/${partyId}/cast`}
              </span>
              <button
                onClick={() => copyToClipboard(`${window.location.origin}/party/${partyId}/cast`, 'casturl')}
                className="text-xs font-mono flex-shrink-0 px-3 py-1 rounded-lg transition-all"
                style={{
                  background: copied === 'casturl' ? 'rgba(34,197,94,0.15)' : 'rgba(71,85,105,0.2)',
                  border: copied === 'casturl' ? '1px solid rgba(34,197,94,0.3)' : '1px solid #1e1e2e',
                  color: copied === 'casturl' ? '#22c55e' : '#475569',
                }}
              >
                {copied === 'casturl' ? 'COPIED' : 'COPY'}
              </button>
            </div>

            {/* What's shown */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}>
              <div className="text-[10px] font-mono tracking-widest" style={{ color: '#3a3a5a' }}>WHAT'S ON SCREEN</div>
              {[
                { icon: '◈', label: 'QR code', desc: 'Guests scan to join from their phones' },
                { icon: '◈', label: 'Live attendee feed', desc: 'Names appear as people join, checkmarks when they finish voting' },
                { icon: '◈', label: 'Voting progress', desc: 'Real-time bar showing how many people have voted' },
                { icon: '◈', label: 'Now Playing', desc: 'Track name, artist and energy when the mix is live' },
                { icon: '◈', label: 'Crowd engagement copy', desc: 'Rotating messages to keep the room hyped' },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-3">
                  <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: '#00d2ff' }}>{item.icon}</span>
                  <div>
                    <span className="text-xs font-mono font-bold" style={{ color: '#64748b' }}>{item.label}</span>
                    <span className="text-xs font-mono" style={{ color: '#3a3a5a' }}> — {item.desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[10px] font-mono text-center" style={{ color: '#2a2a4a' }}>
              Tip: open the cast screen and use your browser's "Cast" or "Mirror" feature to send it to a TV or projector.
            </p>
          </div>
        )}
      </div>

      {/* Account nudge */}
      <ClaimAccount nudgeLabel="Save your creator account →" />

      {/* End Party Confirm */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="w-full max-w-xs rounded-2xl p-6 flex flex-col gap-4" style={{ background: '#0f0f17', border: '1px solid rgba(239,68,68,0.3)' }}>
            <div className="text-center">
              <div
                className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#ef4444' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-sm font-bold font-mono" style={{ color: '#e2e8f0' }}>End the party?</h3>
              <p className="text-xs mt-2" style={{ color: '#475569' }}>
                This will immediately close the party for all attendees. This can't be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-mono"
                style={{ background: '#181825', border: '1px solid #1e1e2e', color: '#475569' }}
              >
                CANCEL
              </button>
              <button
                onClick={handleEndParty}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold font-mono"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}
              >
                END PARTY
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Track Modal */}
      {showAddTrack && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div
            className="w-full max-w-sm rounded-2xl"
            style={{ background: '#0f0f17', border: '1px solid #1e1e2e', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0">
              <h3 className="text-sm font-mono font-bold" style={{ color: '#00d2ff' }}>
                ADD TRACK
              </h3>
              <button
                onClick={() => { setShowAddTrack(false); setTrackSearch(''); setSearchResults([]) }}
                style={{ color: '#475569' }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 pb-5">
              {/* Search box */}
              <div className="relative mb-3">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  {searching ? (
                    <div className="w-3.5 h-3.5 rounded-full border border-t-transparent animate-spin" style={{ borderColor: '#00d2ff', borderTopColor: 'transparent' }} />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#475569' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                </div>
                <input
                  autoFocus
                  placeholder="Search by track title…"
                  value={trackSearch}
                  onChange={(e) => setTrackSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: '#181825', border: '1px solid rgba(0,210,255,0.2)', color: '#e2e8f0' }}
                />
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mb-4 space-y-1">
                  {searchResults.map((result, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setAddForm((f) => ({
                          ...f,
                          title: result.title,
                          artist: result.artist,
                          durationSec: result.duration_sec ? String(result.duration_sec) : '',
                        }))
                        setTrackSearch('')
                        setSearchResults([])
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl transition-all flex items-center gap-3"
                      style={{ background: '#181825', border: '1px solid transparent' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#1e1e2e'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,210,255,0.2)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#181825'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}
                    >
                      {/* Album art */}
                      {result.artwork_url ? (
                        <img
                          src={result.artwork_url}
                          alt=""
                          className="w-10 h-10 rounded-lg flex-shrink-0 object-cover"
                          style={{ background: '#1e1e2e' }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: '#1e1e2e' }}>
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#3a3a5a' }}>
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                          </svg>
                        </div>
                      )}
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>
                          {result.title}
                        </div>
                        <div className="text-xs truncate mt-0.5" style={{ color: '#64748b' }}>
                          {result.artist}{result.album ? ` · ${result.album}` : ''}
                        </div>
                      </div>
                      {/* Duration */}
                      {result.duration_sec && (
                        <span className="text-[10px] font-mono flex-shrink-0" style={{ color: '#3a3a5a' }}>
                          {Math.floor(result.duration_sec / 60)}:{String(result.duration_sec % 60).padStart(2, '0')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {trackSearch.length >= 1 && !searching && searchResults.length === 0 && (
                <p className="text-xs font-mono mb-4 text-center" style={{ color: '#3a3a5a' }}>
                  No results — fill in manually below
                </p>
              )}

              {/* Divider between search results and manual form */}
              {(addForm.title || searchResults.length === 0) && (
                <>
                  {addForm.title && (
                    <div
                      className="px-3 py-2.5 rounded-xl mb-3 flex items-center gap-2"
                      style={{ background: 'rgba(0,210,255,0.05)', border: '1px solid rgba(0,210,255,0.15)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>{addForm.title}</div>
                        <div className="text-xs truncate" style={{ color: '#64748b' }}>{addForm.artist}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAddForm((f) => ({ ...f, title: '', artist: '', durationSec: '', audiomackUrl: '' }))}
                        className="text-[10px] font-mono flex-shrink-0"
                        style={{ color: '#475569' }}
                      >
                        CLEAR
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleAddTrack} className="flex flex-col gap-3">
                    {!addForm.title && (
                      <>
                        <input
                          required
                          placeholder="Title *"
                          value={addForm.title}
                          onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                          style={{ background: '#181825', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
                        />
                        <input
                          required
                          placeholder="Artist *"
                          value={addForm.artist}
                          onChange={(e) => setAddForm((f) => ({ ...f, artist: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                          style={{ background: '#181825', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
                        />
                      </>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <input
                        placeholder="BPM"
                        type="number"
                        value={addForm.bpm}
                        onChange={(e) => setAddForm((f) => ({ ...f, bpm: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none font-mono"
                        style={{ background: '#181825', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
                      />
                      <input
                        placeholder="Key (e.g. Am)"
                        value={addForm.musicalKey}
                        onChange={(e) => setAddForm((f) => ({ ...f, musicalKey: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none font-mono"
                        style={{ background: '#181825', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-mono" style={{ color: '#475569' }}>ENERGY</label>
                        <span className="text-xs font-mono font-bold" style={{ color: '#ff6b35' }}>{addForm.energy.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="0.5"
                        value={addForm.energy}
                        onChange={(e) => setAddForm((f) => ({ ...f, energy: Number(e.target.value) }))}
                        className="w-full"
                        style={{ accentColor: '#ff6b35' }}
                      />
                    </div>

                    {!addForm.audiomackUrl && (
                      <input
                        placeholder="Stream URL (optional)"
                        type="url"
                        value={addForm.audiomackUrl}
                        onChange={(e) => setAddForm((f) => ({ ...f, audiomackUrl: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                        style={{ background: '#181825', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
                      />
                    )}

                    {error && (
                      <div
                        className="px-3 py-2 rounded-xl text-xs font-mono"
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
                      >
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading || !addForm.title}
                      className="w-full py-3 rounded-xl font-bold text-sm tracking-wider transition-all disabled:opacity-50"
                      style={{
                        background: 'rgba(0,210,255,0.15)',
                        border: '1px solid rgba(0,210,255,0.4)',
                        color: '#00d2ff',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      {loading ? 'ADDING...' : 'ADD TRACK'}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
