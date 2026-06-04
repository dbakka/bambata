import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { usePartySocket } from '../../hooks/useSocket'
import type { Party, Pass } from '../../types/party'
import ClaimAccount from '../../components/ClaimAccount'

export default function PassPage() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()

  const [pass, setPass] = useState<Pass | null>(null)
  const [party, setParty] = useState<Party | null>(null)
  const [qrUrl, setQrUrl] = useState<string>('')

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

    // Generate QR from qr_data
    const qrData = p.qrData ?? p.qr_data
    QRCode.toDataURL(qrData, {
      width: 240,
      margin: 2,
      color: { dark: '#e2e8f0', light: '#0f0f17' },
    }).then(setQrUrl)

    // Fetch party info
    fetch(`/api/parties/${partyId}`)
      .then((r) => r.json() as Promise<Party>)
      .then(setParty)
      .catch(() => {})
  }, [partyId, navigate])

  useEffect(() => {
    socket.on('swipe:opened', () => navigate(`/party/${partyId}/swipe`))
    socket.on('party:status', (data: { status: Party['status'] }) => {
      if (data.status === 'swipe_open') navigate(`/party/${partyId}/swipe`)
      if (data.status === 'mixing') navigate(`/party/${partyId}/now`)
    })
    socket.on('player:started', () => navigate(`/party/${partyId}/now`))
    socket.on('player:track', (data: { current: unknown }) => {
      if (data.current) navigate(`/party/${partyId}/now`)
    })
    socket.on('party:done', () => navigate(`/party/${partyId}/closed`))
    return () => {
      socket.off('swipe:opened')
      socket.off('party:status')
      socket.off('player:started')
      socket.off('player:track')
      socket.off('party:done')
    }
  }, [socket, partyId, navigate])

  const handleEnter = () => {
    if (!partyId || !party) return
    if (party.status === 'swipe_open') navigate(`/party/${partyId}/swipe`)
    else if (party.status === 'mixing') navigate(`/party/${partyId}/now`)
    else navigate(`/party/${partyId}/lobby`)
  }

  if (!pass) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#050508' }}
      >
        <span className="text-xs font-mono animate-pulse" style={{ color: '#475569' }}>
          LOADING...
        </span>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8"
      style={{ background: '#050508' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        {/* Party name */}
        {party && (
          <div className="text-center">
            <span className="text-xs font-mono tracking-widest" style={{ color: '#475569' }}>
              {party.venue} · {party.date}
            </span>
            <h1 className="text-2xl font-black mt-1" style={{ color: '#e2e8f0' }}>
              {party.name}
            </h1>
          </div>
        )}

        {/* Pass card */}
        <div
          className="w-full rounded-2xl p-6 flex flex-col items-center gap-5"
          style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
        >
          <div className="text-center">
            <span className="text-xs font-mono tracking-widest" style={{ color: '#a78bfa' }}>
              BAMBATA PASS
            </span>
            <h2 className="text-xl font-bold mt-1" style={{ color: '#e2e8f0' }}>
              {pass.attendee_name}
            </h2>
          </div>

          {/* QR Code */}
          {qrUrl ? (
            <div
              className="p-3 rounded-xl"
              style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
            >
              <img src={qrUrl} alt="Pass QR Code" className="w-48 h-48" />
            </div>
          ) : (
            <div
              className="w-48 h-48 rounded-xl flex items-center justify-center"
              style={{ background: '#181825', border: '1px solid #1e1e2e' }}
            >
              <span className="text-xs font-mono animate-pulse" style={{ color: '#475569' }}>
                GENERATING QR...
              </span>
            </div>
          )}

          <div className="text-xs font-mono text-center" style={{ color: '#475569' }}>
            Show this QR at the door
          </div>
        </div>

        {/* I'm In button */}
        <button
          onClick={handleEnter}
          className="w-full py-4 rounded-xl font-bold text-sm tracking-wider transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, rgba(0, 210, 255, 0.2) 0%, rgba(0, 210, 255, 0.1) 100%)',
            border: '1px solid rgba(0, 210, 255, 0.4)',
            color: '#00d2ff',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {party?.status === 'mixing' ? 'JOIN THE MIX →' : party?.status === 'swipe_open' ? 'JOIN & VOTE NOW' : "I'M IN"}
        </button>

        <ClaimAccount nudgeLabel="Get your receipt by email →" />
      </div>
    </div>
  )
}
