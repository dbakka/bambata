import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

interface PartyInfo {
  name: string
  venue: string
  date: string
}

export default function PartyEnded() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()
  const [party, setParty] = useState<PartyInfo | null>(null)

  useEffect(() => {
    if (!partyId) return
    fetch(`/api/parties/${partyId}`)
      .then((r) => r.ok ? r.json() as Promise<PartyInfo> : null)
      .then((p) => { if (p) setParty(p) })
      .catch(() => {})
  }, [partyId])

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12 safe-top safe-bottom"
      style={{ background: '#050508', fontFamily: 'system-ui' }}
    >
      <div className="w-full max-w-sm flex flex-col gap-6 text-center">
        {/* Logo */}
        <div
          className="text-2xl font-black tracking-widest mb-2"
          style={{ color: '#00d2ff', fontFamily: 'JetBrains Mono, monospace' }}
        >
          BAMBATA
        </div>

        {/* Party name */}
        {party && (
          <div className="text-sm font-mono" style={{ color: '#3a3a5a' }}>
            {party.name} · {party.venue}
          </div>
        )}

        {/* End message */}
        <div
          className="p-8 rounded-2xl flex flex-col items-center gap-4"
          style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)' }}
          >
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#a78bfa' }}>
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <div>
            <div className="text-xl font-black font-mono mb-2" style={{ color: '#e2e8f0' }}>
              THAT'S A WRAP
            </div>
            <p className="text-sm" style={{ color: '#475569' }}>
              The party has ended. Hope you enjoyed the music!
            </p>
          </div>
        </div>

        {/* Host your own CTA */}
        <div
          className="p-6 rounded-2xl flex flex-col gap-4"
          style={{
            background: 'linear-gradient(135deg, rgba(0,210,255,0.06) 0%, rgba(167,139,250,0.06) 100%)',
            border: '1px solid rgba(0,210,255,0.2)',
          }}
        >
          <div>
            <div className="text-xs font-mono tracking-widest mb-1" style={{ color: '#00d2ff' }}>
              YOUR TURN
            </div>
            <p className="text-sm" style={{ color: '#94a3b8' }}>
              Want the crowd to choose your music next time? Host your own Bambata party.
            </p>
          </div>
          <button
            onClick={() => navigate('/create')}
            className="w-full py-4 rounded-xl font-black text-sm tracking-widest transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, rgba(0,210,255,0.2) 0%, rgba(167,139,250,0.2) 100%)',
              border: '1px solid rgba(0,210,255,0.4)',
              color: '#00d2ff',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            HOST A PARTY →
          </button>
        </div>

        {/* Home */}
        <button
          onClick={() => navigate('/')}
          className="w-full py-3 rounded-xl text-xs font-mono tracking-wider"
          style={{ background: '#0a0a0f', border: '1px solid #1e1e2e', color: '#3a3a5a' }}
        >
          ← BACK TO HOME
        </button>
      </div>
    </div>
  )
}
