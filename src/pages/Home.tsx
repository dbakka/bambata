import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

interface PartyCard {
  id: string
  name: string
  venue: string
  date: string
  status: string
  role: 'creator' | 'attendee'
}

function loadPartyHistory(): { id: string; role: 'creator' | 'attendee' }[] {
  const found: { id: string; role: 'creator' | 'attendee' }[] = []
  const seen = new Set<string>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) ?? ''
    const creatorMatch = key.match(/^bambata_creator_(.+)$/)
    const passMatch = key.match(/^bambata_pass_(.+)$/)
    if (creatorMatch && !seen.has(creatorMatch[1])) {
      seen.add(creatorMatch[1])
      found.push({ id: creatorMatch[1], role: 'creator' })
    } else if (passMatch && !seen.has(passMatch[1])) {
      seen.add(passMatch[1])
      found.push({ id: passMatch[1], role: 'attendee' })
    }
  }
  return found
}

export default function Home() {
  const navigate = useNavigate()
  const [showInviteInput, setShowInviteInput] = useState(false)
  const [partyId, setPartyId] = useState('')
  const [history, setHistory] = useState<PartyCard[]>([])

  useEffect(() => {
    const refs = loadPartyHistory()
    if (refs.length === 0) return

    Promise.all(
      refs.map(({ id, role }) =>
        fetch(`/api/parties/${id}`)
          .then(r => r.ok ? r.json() as Promise<{ id: string; name: string; venue: string; date: string; status: string }> : Promise.reject())
          .then(p => ({ id: p.id, name: p.name, venue: p.venue, date: p.date, status: p.status, role }))
          .catch(() => null)
      )
    ).then(results => {
      setHistory(results.filter((r): r is PartyCard => r !== null && r.status !== 'done'))
    })
  }, [])

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const id = partyId.trim().toUpperCase()
    if (id) navigate(`/party/${id}`)
  }

  const handlePartyCardTap = (card: PartyCard) => {
    if (card.role === 'creator') {
      navigate(`/creator/${card.id}`)
    } else {
      if (card.status === 'mixing') navigate(`/party/${card.id}/now`)
      else if (card.status === 'swipe_open') navigate(`/party/${card.id}/swipe`)
      else if (card.status === 'done') navigate(`/party/${card.id}/closed`)
      else navigate(`/party/${card.id}/pass`)
    }
  }

  const statusLabel = (status: string) => {
    if (status === 'mixing') return { text: 'LIVE', color: '#22c55e' }
    if (status === 'swipe_open') return { text: 'VOTING', color: '#a78bfa' }
    if (status === 'done') return { text: 'ENDED', color: '#3a3a5a' }
    return { text: 'UPCOMING', color: '#475569' }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 safe-top safe-bottom"
      style={{ background: '#050508' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-10">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <span
            className="text-5xl font-black tracking-[0.3em]"
            style={{
              color: '#00d2ff',
              fontFamily: 'JetBrains Mono, monospace',
              textShadow: '0 0 40px rgba(0, 210, 255, 0.4)',
            }}
          >
            BAMBATA
          </span>
          <span className="text-xs tracking-widest" style={{ color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
            COLLECTIVE DJ PLATFORM
          </span>
        </div>

        {/* Pulsing ring decoration */}
        <div className="relative flex items-center justify-center">
          <div className="absolute w-32 h-32 rounded-full animate-ping" style={{ background: 'rgba(0, 210, 255, 0.04)' }} />
          <div className="absolute w-20 h-20 rounded-full animate-pulse" style={{ background: 'rgba(0, 210, 255, 0.06)' }} />
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0, 210, 255, 0.1)', border: '1px solid rgba(0, 210, 255, 0.3)' }}
          >
            <svg className="w-6 h-6" style={{ color: '#00d2ff' }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        </div>

        {/* Actions */}
        <div className="w-full flex flex-col gap-4">
          <button
            onClick={() => navigate('/create')}
            className="w-full py-4 rounded-xl font-bold text-sm tracking-wider transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, rgba(0, 210, 255, 0.15) 0%, rgba(0, 210, 255, 0.05) 100%)',
              border: '1px solid rgba(0, 210, 255, 0.4)',
              color: '#00d2ff',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            CREATE A PARTY
          </button>

          {!showInviteInput ? (
            <button
              onClick={() => setShowInviteInput(true)}
              className="w-full py-4 rounded-xl font-bold text-sm tracking-wider transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: '#0f0f17',
                border: '1px solid #1e1e2e',
                color: '#475569',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              I HAVE AN INVITE
            </button>
          ) : (
            <form onSubmit={handleInviteSubmit} className="flex flex-col gap-3">
              <input
                autoFocus
                type="text"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value.toUpperCase())}
                placeholder="PARTY CODE (e.g. AB1C2D3E)"
                className="w-full px-4 py-3 rounded-xl text-sm font-mono outline-none"
                style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowInviteInput(false)}
                  className="flex-1 py-3 rounded-xl text-sm font-mono"
                  style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#475569' }}
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl font-bold text-sm tracking-wider"
                  style={{
                    background: 'rgba(167, 139, 250, 0.15)',
                    border: '1px solid rgba(167, 139, 250, 0.4)',
                    color: '#a78bfa',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  JOIN
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Party history */}
        {history.length > 0 && (
          <div className="w-full">
            <p className="text-[10px] font-mono tracking-widest mb-3" style={{ color: '#3a3a5a' }}>YOUR PARTIES</p>
            <div className="flex flex-col gap-2">
              {history.map(card => {
                const { text, color } = statusLabel(card.status)
                return (
                  <button
                    key={card.id}
                    onClick={() => handlePartyCardTap(card)}
                    className="w-full text-left px-4 py-3 rounded-xl flex items-center gap-3"
                    style={{ background: '#0a0a0f', border: '1px solid #1e1e2e' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold truncate text-sm" style={{ color: '#e2e8f0' }}>{card.name}</span>
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{ background: `${color}18`, color }}
                        >
                          {text}
                        </span>
                      </div>
                      <div className="text-xs font-mono truncate" style={{ color: '#475569' }}>
                        {card.venue} · {card.date}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: card.role === 'creator' ? 'rgba(0,210,255,0.08)' : 'rgba(167,139,250,0.08)', color: card.role === 'creator' ? '#00d2ff' : '#a78bfa' }}
                      >
                        {card.role === 'creator' ? 'CREATOR' : 'ATTENDEE'}
                      </span>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#3a3a5a' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <p className="text-xs text-center" style={{ color: '#2a2a4a', fontFamily: 'JetBrains Mono, monospace' }}>
          The crowd builds the set.
        </p>
      </div>
    </div>
  )
}
