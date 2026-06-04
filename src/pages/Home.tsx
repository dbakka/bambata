import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Home() {
  const navigate = useNavigate()
  const [showInviteInput, setShowInviteInput] = useState(false)
  const [partyId, setPartyId] = useState('')

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const id = partyId.trim().toUpperCase()
    if (id) navigate(`/party/${id}`)
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
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
          <div
            className="absolute w-32 h-32 rounded-full animate-ping"
            style={{ background: 'rgba(0, 210, 255, 0.04)' }}
          />
          <div
            className="absolute w-20 h-20 rounded-full animate-pulse"
            style={{ background: 'rgba(0, 210, 255, 0.06)' }}
          />
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
                style={{
                  background: '#0f0f17',
                  border: '1px solid #1e1e2e',
                  color: '#e2e8f0',
                }}
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowInviteInput(false)}
                  className="flex-1 py-3 rounded-xl text-sm font-mono transition-colors"
                  style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#475569' }}
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl font-bold text-sm tracking-wider transition-all"
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

        <p className="text-xs text-center" style={{ color: '#2a2a4a', fontFamily: 'JetBrains Mono, monospace' }}>
          The crowd builds the set.
        </p>
      </div>
    </div>
  )
}
