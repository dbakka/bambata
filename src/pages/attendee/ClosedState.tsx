import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePartySocket } from '../../hooks/useSocket'
import type { Pass } from '../../types/party'

interface TokenWallet {
  balance: number
}

interface TokenRequest {
  id: string
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
}

export default function ClosedState() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()

  const [pass, setPass] = useState<Pass | null>(null)
  const [wallet, setWallet] = useState<TokenWallet | null>(null)
  const [tokenCode, setTokenCode] = useState('')
  const [tokensSpent, setTokensSpent] = useState(5)
  const [selectedTrack, setSelectedTrack] = useState<SearchResult | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [codeSuccess, setCodeSuccess] = useState('')
  const [requestError, setRequestError] = useState('')
  const [requestSuccess, setRequestSuccess] = useState('')
  const [loadingCode, setLoadingCode] = useState(false)
  const [loadingRequest, setLoadingRequest] = useState(false)
  const [requests, setRequests] = useState<TokenRequest[]>([])
  const [votingId, setVotingId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const socket = usePartySocket(partyId ?? '')

  useEffect(() => {
    if (!partyId) return

    const stored = localStorage.getItem(`bambata_pass_${partyId}`)
    if (!stored) {
      navigate(`/party/${partyId}`)
      return
    }
    const p = JSON.parse(stored) as Pass
    setPass(p)

    // We don't have a wallet endpoint so we'll track locally
    const storedWallet = localStorage.getItem(`bambata_wallet_${partyId}_${p.id}`)
    if (storedWallet) {
      setWallet(JSON.parse(storedWallet) as TokenWallet)
    } else {
      setWallet({ balance: 0 })
    }

    // Fetch existing requests
    fetch(`/api/parties/${partyId}/requests`)
      .then((r) => r.json() as Promise<TokenRequest[]>)
      .then(setRequests)
      .catch(() => {})
  }, [partyId, navigate])

  // Socket listeners for live request updates
  useEffect(() => {
    socket.on('request:new', (data: { request: TokenRequest }) => {
      setRequests((prev) => {
        if (prev.find((r) => r.id === data.request.id)) return prev
        return [...prev, data.request]
      })
    })
    socket.on('request:voted', (data: { requestId: string; voteCount: number }) => {
      setRequests((prev) =>
        prev.map((r) => r.id === data.requestId ? { ...r, vote_count: data.voteCount } : r)
      )
    })
    return () => {
      socket.off('request:new')
      socket.off('request:voted')
    }
  }, [socket])

  // Debounced live search
  useEffect(() => {
    if (searchQuery.length < 1) { setSearchResults([]); return }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/tracks?q=${encodeURIComponent(searchQuery)}`)
        if (res.ok) setSearchResults(await res.json() as SearchResult[])
      } catch {}
      finally { setSearching(false) }
    }, 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleRedeemTokenCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!partyId || !pass) return
    setLoadingCode(true)
    setCodeError('')
    setCodeSuccess('')

    try {
      const res = await fetch(`/api/parties/${partyId}/tokens/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passId: pass.id, code: tokenCode.trim() }),
      })
      if (!res.ok) throw new Error((await res.json() as { error: string }).error)
      const data = (await res.json()) as { balance: number }
      const newWallet = { balance: data.balance }
      setWallet(newWallet)
      localStorage.setItem(`bambata_wallet_${partyId}_${pass.id}`, JSON.stringify(newWallet))
      setCodeSuccess(`+tokens added! Balance: ${data.balance}`)
      setTokenCode('')
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'Failed to redeem')
    } finally {
      setLoadingCode(false)
    }
  }

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!partyId || !pass || !wallet || !selectedTrack) return
    if (wallet.balance < tokensSpent) { setRequestError('Insufficient tokens'); return }
    setLoadingRequest(true)
    setRequestError('')
    setRequestSuccess('')

    try {
      const res = await fetch(`/api/parties/${partyId}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passId: pass.id,
          trackTitle: selectedTrack.title,
          trackArtist: selectedTrack.artist,
          tokensSpent,
        }),
      })
      if (!res.ok) throw new Error((await res.json() as { error: string }).error)
      const newWallet = { balance: wallet.balance - tokensSpent }
      setWallet(newWallet)
      localStorage.setItem(`bambata_wallet_${partyId}_${pass.id}`, JSON.stringify(newWallet))
      setRequestSuccess('Request sent!')
      setSelectedTrack(null)
      setSearchQuery('')
      setTokensSpent(5)
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Failed to send request')
    } finally {
      setLoadingRequest(false)
    }
  }

  const handleVote = async (reqId: string) => {
    if (!partyId || !pass || !wallet || wallet.balance < 1) return
    setVotingId(reqId)
    try {
      const res = await fetch(`/api/parties/${partyId}/requests/${reqId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passId: pass.id, tokenCount: 1 }),
      })
      if (res.ok) {
        const newWallet = { balance: wallet.balance - 1 }
        setWallet(newWallet)
        localStorage.setItem(`bambata_wallet_${partyId}_${pass.id}`, JSON.stringify(newWallet))
      }
    } catch {}
    finally { setVotingId(null) }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center px-4 py-8"
      style={{ background: '#050508' }}
    >
      <div className="w-full max-w-sm flex flex-col gap-6">
        {/* Header */}
        <div className="text-center pt-4">
          <span
            className="text-lg font-black tracking-widest"
            style={{ color: '#00d2ff', fontFamily: 'JetBrains Mono, monospace' }}
          >
            BAMBATA
          </span>
        </div>

        {/* Status */}
        <div
          className="p-5 rounded-2xl text-center"
          style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
        >
          <div
            className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ background: 'rgba(167, 139, 250, 0.1)', border: '1px solid rgba(167, 139, 250, 0.3)' }}
          >
            <svg className="w-6 h-6" style={{ color: '#a78bfa' }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold mb-1" style={{ color: '#e2e8f0' }}>
            The swipe window is closed.
          </h2>
          <p className="text-sm" style={{ color: '#475569' }}>
            The crowd has spoken. Bambata is building the set.
          </p>
        </div>

        {/* Wallet / Token section */}
        {wallet !== null && wallet.balance > 0 ? (
          <div
            className="p-4 rounded-2xl"
            style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-mono font-bold tracking-wider" style={{ color: '#ff6b35' }}>
                YOUR TOKENS
              </h3>
              <span
                className="text-2xl font-black font-mono"
                style={{ color: '#ff6b35' }}
              >
                {wallet.balance}
              </span>
            </div>

            {/* Search or confirm selected track */}
            {!selectedTrack ? (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    {searching ? (
                      <div className="w-3.5 h-3.5 rounded-full border border-t-transparent animate-spin" style={{ borderColor: '#ff6b35', borderTopColor: 'transparent' }} />
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#475569' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    )}
                  </div>
                  <input
                    ref={searchRef}
                    placeholder="Search for a song…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: '#181825', border: '1px solid rgba(255,107,53,0.25)', color: '#e2e8f0' }}
                  />
                </div>

                {searchResults.length > 0 && (
                  <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
                    {searchResults.map((result, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setSelectedTrack(result); setSearchResults([]) }}
                        className="w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3"
                        style={{ background: '#181825' }}
                      >
                        {result.artwork_url ? (
                          <img src={result.artwork_url} alt="" className="w-9 h-9 rounded-lg flex-shrink-0 object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: '#1e1e2e' }}>
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
                        <span className="text-[10px] font-mono flex-shrink-0 px-2 py-1 rounded" style={{ background: 'rgba(255,107,53,0.1)', color: '#ff6b35' }}>
                          SELECT
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {searchQuery.length >= 1 && !searching && searchResults.length === 0 && (
                  <p className="text-xs font-mono text-center py-2" style={{ color: '#3a3a5a' }}>No results found</p>
                )}
              </div>
            ) : (
              <form onSubmit={handleRequest} className="flex flex-col gap-3">
                {/* Selected track card */}
                <div
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: '#181825', border: '1px solid rgba(255,107,53,0.3)' }}
                >
                  {selectedTrack.artwork_url ? (
                    <img src={selectedTrack.artwork_url} alt="" className="w-9 h-9 rounded-lg flex-shrink-0 object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: '#1e1e2e' }}>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#3a3a5a' }}>
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>{selectedTrack.title}</div>
                    <div className="text-xs truncate mt-0.5" style={{ color: '#64748b' }}>{selectedTrack.artist}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedTrack(null); setSearchQuery(''); setTimeout(() => searchRef.current?.focus(), 50) }}
                    style={{ color: '#475569' }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-mono" style={{ color: '#475569' }}>TOKENS TO SPEND</label>
                    <span className="text-xs font-mono font-bold" style={{ color: '#ff6b35' }}>{tokensSpent}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max={Math.max(1, wallet.balance)}
                    value={tokensSpent}
                    onChange={(e) => setTokensSpent(Number(e.target.value))}
                    className="w-full"
                    style={{ accentColor: '#ff6b35' }}
                  />
                </div>

                {requestError && (
                  <p className="text-xs font-mono" style={{ color: '#ef4444' }}>{requestError}</p>
                )}
                {requestSuccess && (
                  <p className="text-xs font-mono" style={{ color: '#22c55e' }}>{requestSuccess}</p>
                )}

                <button
                  type="submit"
                  disabled={loadingRequest}
                  className="w-full py-3 rounded-xl font-bold text-sm tracking-wider disabled:opacity-50"
                  style={{
                    background: 'rgba(255, 107, 53, 0.15)',
                    border: '1px solid rgba(255, 107, 53, 0.4)',
                    color: '#ff6b35',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {loadingRequest ? 'SENDING...' : 'REQUEST TRACK'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div
            className="p-4 rounded-2xl"
            style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
          >
            <h3 className="text-xs font-mono font-bold tracking-wider mb-3" style={{ color: '#475569' }}>
              TOKEN BUNDLES AVAILABLE
            </h3>
            <p className="text-xs mb-4" style={{ color: '#475569' }}>
              Redeem a token bundle code to request tracks or boost votes.
            </p>
            <form onSubmit={handleRedeemTokenCode} className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="T-XXXXXX"
                value={tokenCode}
                onChange={(e) => setTokenCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none tracking-widest"
                style={{ background: '#181825', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
              />
              {codeError && (
                <p className="text-xs font-mono" style={{ color: '#ef4444' }}>
                  {codeError}
                </p>
              )}
              {codeSuccess && (
                <p className="text-xs font-mono" style={{ color: '#22c55e' }}>
                  {codeSuccess}
                </p>
              )}
              <button
                type="submit"
                disabled={loadingCode || !tokenCode}
                className="w-full py-3 rounded-xl font-bold text-sm tracking-wider disabled:opacity-50"
                style={{
                  background: 'rgba(255, 107, 53, 0.1)',
                  border: '1px solid rgba(255, 107, 53, 0.3)',
                  color: '#ff6b35',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {loadingCode ? 'REDEEMING...' : 'REDEEM TOKENS'}
              </button>
            </form>
          </div>
        )}

        {/* Live requests list */}
        {requests.length > 0 && (
          <div
            className="p-4 rounded-2xl"
            style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
          >
            <h3 className="text-xs font-mono font-bold tracking-wider mb-3" style={{ color: '#475569' }}>
              TRACK REQUESTS ({requests.length})
            </h3>
            <div className="space-y-2">
              {[...requests].sort((a, b) => b.tokens_spent - a.tokens_spent).map((req) => (
                <div
                  key={req.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{
                    background: '#181825',
                    border: req.status === 'accepted' ? '1px solid rgba(34,197,94,0.2)' : '1px solid transparent',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>
                      {req.track_title}
                    </div>
                    <div className="text-xs truncate mt-0.5" style={{ color: '#64748b' }}>
                      {req.track_artist}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-mono font-bold" style={{ color: '#ff6b35' }}>
                      {req.tokens_spent}
                    </span>
                    {req.status === 'accepted' ? (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                        ACCEPTED
                      </span>
                    ) : wallet && wallet.balance >= 1 ? (
                      <button
                        onClick={() => handleVote(req.id)}
                        disabled={votingId === req.id}
                        className="text-[10px] font-mono px-2 py-1 rounded-lg disabled:opacity-50"
                        style={{
                          background: 'rgba(255,107,53,0.1)',
                          border: '1px solid rgba(255,107,53,0.3)',
                          color: '#ff6b35',
                        }}
                      >
                        +1
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
