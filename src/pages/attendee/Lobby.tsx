import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Party } from '../../types/party'
import { usePartySocket } from '../../hooks/useSocket'

export default function Lobby() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()
  const [party, setParty] = useState<Party | null>(null)

  const socket = usePartySocket(partyId ?? '')

  useEffect(() => {
    if (!partyId) return

    // Check party status immediately
    fetch(`/api/parties/${partyId}`)
      .then((r) => r.json() as Promise<Party>)
      .then((p) => {
        setParty(p)
        if (p.status === 'swipe_open') {
          navigate(`/party/${partyId}/swipe`)
        }
      })
      .catch(() => {})
  }, [partyId, navigate])

  useEffect(() => {
    socket.on('swipe:opened', () => navigate(`/party/${partyId}/swipe`))
    socket.on('party:status', (data: { status: Party['status'] }) => {
      if (data.status === 'swipe_open') navigate(`/party/${partyId}/swipe`)
    })
    socket.on('party:done', () => navigate(`/party/${partyId}/closed`))

    return () => {
      socket.off('swipe:opened')
      socket.off('party:status')
      socket.off('party:done')
    }
  }, [socket, partyId, navigate])

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: '#050508' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-8 text-center">
        {/* Logo */}
        <span
          className="text-2xl font-black tracking-[0.3em]"
          style={{ color: '#00d2ff', fontFamily: 'JetBrains Mono, monospace' }}
        >
          BAMBATA
        </span>

        {/* Party name */}
        {party && (
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#e2e8f0' }}>
              {party.name}
            </h1>
            <p className="text-sm font-mono mt-1" style={{ color: '#475569' }}>
              {party.venue}
            </p>
          </div>
        )}

        {/* Pulsing visual */}
        <div className="relative flex items-center justify-center" style={{ height: '120px', width: '120px' }}>
          <div
            className="absolute w-28 h-28 rounded-full"
            style={{
              background: 'rgba(0, 210, 255, 0.03)',
              animation: 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
            }}
          />
          <div
            className="absolute w-20 h-20 rounded-full"
            style={{
              background: 'rgba(0, 210, 255, 0.05)',
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              animationDelay: '0.5s',
            }}
          />
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(0, 210, 255, 0.08)',
              border: '1px solid rgba(0, 210, 255, 0.2)',
              animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}
          >
            <svg className="w-6 h-6" style={{ color: '#00d2ff' }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        </div>

        <div>
          <p className="text-sm" style={{ color: '#e2e8f0' }}>
            Waiting for the swipe window to open...
          </p>
          <p className="text-xs font-mono mt-2" style={{ color: '#475569' }}>
            Stay on this page. You'll jump in automatically.
          </p>
        </div>

        {/* Back to pass */}
        <button
          onClick={() => navigate(`/party/${partyId}/pass`)}
          className="text-xs font-mono"
          style={{ color: '#475569' }}
        >
          View my pass
        </button>
      </div>
    </div>
  )
}
