import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import type { Party } from '../../types/party'
import type { MixTrack } from '../../modules/mixing/MixingEngine'
import { usePartySocket } from '../../hooks/useSocket'

interface Attendee {
  id: string
  attendee_name: string
  joined_at: number
  swipes_done: number
  total_tracks: number
  done: boolean
}

interface AttendeeData {
  attendees: Attendee[]
  total: number
  done_count: number
}

type DisplayPhase = 'default' | 'swipe_open' | 'swipe_closed' | 'mix_live' | 'done'

const MSGS: Record<DisplayPhase, string[]> = {
  default: [
    'Scan to vote on tonight\'s set',
    'Your voice shapes the music',
    'Tell the DJ what you want to hear',
    'Join the party — it\'s free',
  ],
  swipe_open: [
    'RIGHT = YES  ·  LEFT = SKIP',
    'Vote fast — closes when everyone\'s done',
    'The DJ is watching...',
    'Every vote shapes tonight\'s set',
    'Your taste matters',
  ],
  swipe_closed: [
    'Bambata is reading the room...',
    'Curating the perfect set...',
    'Good taste detected',
    'Almost ready...',
  ],
  mix_live: [
    'Request a track with your tokens',
    'This set was curated by you',
    'The crowd has spoken',
    'Feel the music',
  ],
  done: ['Thanks for vibing with us', 'See you next time'],
}

function partyStatusToPhase(status: Party['status']): DisplayPhase {
  switch (status) {
    case 'swipe_open': return 'swipe_open'
    case 'mixing':     return 'mix_live'
    case 'done':       return 'done'
    default:           return 'default'
  }
}

function PhaseBadge({ status }: { status: DisplayPhase }) {
  const map: Record<DisplayPhase, { label: string; color: string; bg: string }> = {
    default:      { label: 'DOORS OPEN',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
    swipe_open:   { label: 'VOTING LIVE',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    swipe_closed: { label: 'BUILDING SET', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    mix_live:     { label: 'MIX LIVE',     color: '#00d2ff', bg: 'rgba(0,210,255,0.12)' },
    done:         { label: 'ENDED',        color: '#475569', bg: 'rgba(71,85,105,0.15)' },
  }
  const info = map[status]
  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 rounded-full"
      style={{ background: info.bg, border: `1px solid ${info.color}40` }}
    >
      {status !== 'done' && (
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: info.color, animation: 'pulse 1.5s ease-in-out infinite', boxShadow: `0 0 6px ${info.color}` }}
        />
      )}
      <span className="text-xs font-mono font-bold tracking-widest" style={{ color: info.color }}>
        {info.label}
      </span>
    </div>
  )
}

export default function CastScreen() {
  const { partyId } = useParams<{ partyId: string }>()
  const socket = usePartySocket(partyId ?? '')

  const [party, setParty] = useState<Party | null>(null)
  const [phase, setPhase] = useState<DisplayPhase>('default')
  const [attendeeData, setAttendeeData] = useState<AttendeeData>({ attendees: [], total: 0, done_count: 0 })
  const [currentTrack, setCurrentTrack] = useState<MixTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [qrUrl, setQrUrl] = useState('')
  const [msgIdx, setMsgIdx] = useState(0)
  const [msgFade, setMsgFade] = useState(true)
  const [newJoinId, setNewJoinId] = useState<string | null>(null)
  const [reactionCount, setReactionCount] = useState(0)
  const [leaderboard, setLeaderboard] = useState<{ name: string; score: number }[]>([])

  const joinUrl = `${window.location.origin}/party/${partyId}`
  const msgs = MSGS[phase]
  const currentMsg = msgs[msgIdx % msgs.length]

  useEffect(() => {
    QRCode.toDataURL(joinUrl, {
      width: 320, margin: 2,
      color: { dark: '#e2e8f0', light: '#080810' },
    }).then(setQrUrl)
  }, [joinUrl])

  const fetchAttendees = async () => {
    if (!partyId) return
    const r = await fetch(`/api/parties/${partyId}/attendees`)
    if (r.ok) setAttendeeData(await r.json() as AttendeeData)
  }

  useEffect(() => {
    if (!partyId) return
    Promise.all([
      fetch(`/api/parties/${partyId}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/parties/${partyId}/attendees`).then(r => r.ok ? r.json() : null),
      fetch(`/api/parties/${partyId}/now`).then(r => r.ok ? r.json() : null),
    ]).then(([p, a, now]) => {
      if (p) { setParty(p as Party); setPhase(partyStatusToPhase((p as Party).status)) }
      if (a) setAttendeeData(a as AttendeeData)
      if (now?.current) { setCurrentTrack(now.current as MixTrack); setPhase('mix_live') }
    })
    const poll = setInterval(fetchAttendees, 5000)
    return () => clearInterval(poll)
  }, [partyId])

  useEffect(() => {
    socket.on('party:status', (data: { status: Party['status'] }) => {
      setParty(p => p ? { ...p, status: data.status } : null)
      setPhase(partyStatusToPhase(data.status))
    })
    socket.on('swipe:opened', () => {
      setParty(p => p ? { ...p, status: 'swipe_open' } : null)
      setPhase('swipe_open')
      fetchAttendees()
    })
    socket.on('swipe:closed', () => {
      setParty(p => p ? { ...p, status: 'pending' } : null)
      setPhase('swipe_closed')
    })
    socket.on('party:done', () => {
      setParty(p => p ? { ...p, status: 'done' } : null)
      setPhase('done')
    })
    socket.on('player:track', (data: { current: MixTrack | null }) => {
      setCurrentTrack(data.current)
      setReactionCount(0)
      if (data.current) { setParty(p => p ? { ...p, status: 'mixing' } : null); setPhase('mix_live') }
    })
    socket.on('player:state', (data: { playing: boolean }) => setPlaying(data.playing))
    socket.on('track:reacted', (data: { trackId: string; count: number }) => {
      setReactionCount(data.count)
    })
    socket.on('pass:count', () => {
      fetchAttendees().then(() => {
        setAttendeeData(prev => {
          const newest = prev.attendees[prev.attendees.length - 1]
          if (newest) { setNewJoinId(newest.id); setTimeout(() => setNewJoinId(null), 2000) }
          return prev
        })
      })
    })
    return () => {
      socket.off('party:status'); socket.off('swipe:opened'); socket.off('swipe:closed')
      socket.off('party:done'); socket.off('player:track'); socket.off('player:state')
      socket.off('pass:count'); socket.off('track:reacted')
    }
  }, [socket])

  // Poll leaderboard while mix is live
  useEffect(() => {
    if (phase !== 'mix_live' || !partyId) return
    const fetchBoard = () =>
      fetch(`/api/parties/${partyId}/leaderboard`)
        .then(r => r.ok ? r.json() : [])
        .then(d => setLeaderboard(d as { name: string; score: number }[]))
        .catch(() => {})
    fetchBoard()
    const t = setInterval(fetchBoard, 15000)
    return () => clearInterval(t)
  }, [phase, partyId])

  // Rotating engagement messages
  useEffect(() => {
    setMsgIdx(0)
    const timer = setInterval(() => {
      setMsgFade(false)
      setTimeout(() => { setMsgIdx(i => i + 1); setMsgFade(true) }, 500)
    }, 4500)
    return () => clearInterval(timer)
  }, [phase])

  const progress = attendeeData.total > 0 ? attendeeData.done_count / attendeeData.total : 0
  const isMixLive = phase === 'mix_live'
  const isDone = phase === 'done'
  const showQr = phase !== 'done' && phase !== 'mix_live'

  // Show last 10 attendees (most recent at bottom for live feel)
  const visibleAttendees = attendeeData.attendees.slice(-12)

  return (
    <div
      className="min-h-screen flex flex-col overflow-hidden select-none"
      style={{ background: '#050508', fontFamily: 'JetBrains Mono, monospace' }}
    >
      {/* Subtle grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,210,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,210,255,0.025) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      {/* Ambient glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: '-20%', left: '30%', width: '40%', height: '50%',
          background: isMixLive
            ? 'radial-gradient(ellipse, rgba(0,210,255,0.04) 0%, transparent 70%)'
            : 'radial-gradient(ellipse, rgba(167,139,250,0.04) 0%, transparent 70%)',
          transition: 'background 2s ease',
        }}
      />

      {/* Header */}
      <div
        className="relative z-10 flex items-center justify-between px-8 py-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <span
          className="text-lg font-black tracking-[0.35em]"
          style={{ color: '#00d2ff', textShadow: '0 0 20px rgba(0,210,255,0.4)' }}
        >
          BAMBATA
        </span>

        <div className="text-center">
          {party && (
            <>
              <div className="text-xl font-black" style={{ color: '#e2e8f0', letterSpacing: '0.05em' }}>
                {party.name.toUpperCase()}
              </div>
              {party.venue && (
                <div className="text-xs tracking-widest mt-0.5" style={{ color: '#3a3a5a' }}>
                  {party.venue}
                </div>
              )}
            </>
          )}
        </div>

        <PhaseBadge status={phase} />
      </div>

      {/* Main content area */}
      <div className="relative z-10 flex-1 flex min-h-0">
        {isMixLive ? (
          // ── NOW PLAYING VIEW ──────────────────────────────────────────────────
          <div className="flex-1 flex min-h-0">
          {/* Left: main track display */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 gap-10">
            <div
              className="text-xs font-mono tracking-[0.4em]"
              style={{ color: playing ? '#22c55e' : '#475569' }}
            >
              {playing ? 'NOW PLAYING' : 'PAUSED'}
            </div>

            {/* Pulsing ring */}
            {playing && (
              <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
                <div
                  className="absolute rounded-full"
                  style={{ width: 120, height: 120, background: 'rgba(0,210,255,0.03)', animation: 'ping 2.5s ease-in-out infinite' }}
                />
                <div
                  className="absolute rounded-full"
                  style={{ width: 80, height: 80, background: 'rgba(0,210,255,0.05)', animation: 'pulse 2s ease-in-out infinite' }}
                />
                <div
                  className="rounded-full flex items-center justify-center"
                  style={{ width: 48, height: 48, background: 'rgba(0,210,255,0.1)', border: '1px solid rgba(0,210,255,0.3)' }}
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#00d2ff' }}>
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
              </div>
            )}

            {currentTrack ? (
              <div className="text-center space-y-3 max-w-2xl">
                <h1
                  className="font-black leading-tight"
                  style={{
                    color: '#e2e8f0',
                    fontSize: currentTrack.title.length > 30 ? '3rem' : currentTrack.title.length > 20 ? '4rem' : '5rem',
                    lineHeight: 1.1,
                    textShadow: '0 0 40px rgba(226,232,240,0.1)',
                  }}
                >
                  {currentTrack.title}
                </h1>
                <p className="text-2xl" style={{ color: '#475569' }}>{currentTrack.artist}</p>

                {/* Energy strip */}
                <div className="flex gap-1 justify-center mt-6">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-full"
                      style={{
                        width: 10, height: 10,
                        background: i < currentTrack.energy ? '#ff6b35' : '#1a1a2e',
                        boxShadow: i < currentTrack.energy ? '0 0 6px rgba(255,107,53,0.5)' : 'none',
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-2xl" style={{ color: '#3a3a5a' }}>Waiting for track info...</p>
            )}

            {/* Engagement message */}
            <div
              className="text-xs font-mono tracking-widest transition-opacity duration-500"
              style={{ color: '#3a3a5a', opacity: msgFade ? 1 : 0 }}
            >
              {currentMsg}
            </div>

            {/* Attendee count strip at bottom */}
            <div className="flex items-center gap-6 text-sm font-mono" style={{ color: '#2a2a4a' }}>
              <span>{attendeeData.total} in the building</span>
              <span style={{ color: '#1e1e2e' }}>·</span>
              <span>{attendeeData.done_count} voted</span>
              {reactionCount > 0 && (
                <>
                  <span style={{ color: '#1e1e2e' }}>·</span>
                  <span style={{ color: '#ff6b35' }}>🔥 {reactionCount}</span>
                </>
              )}
            </div>
          </div>

          {/* Right: leaderboard panel */}
          {leaderboard.length > 0 && (
            <div
              className="w-72 flex flex-col px-6 py-10"
              style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}
            >
              <div className="text-[10px] font-mono tracking-widest mb-6" style={{ color: '#3a3a5a' }}>
                TOP TASTE
              </div>
              <div className="space-y-3 flex-1">
                {leaderboard.slice(0, 5).map((entry, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-lg w-6 text-center flex-shrink-0">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-xs font-mono" style={{ color: '#3a3a5a' }}>#{i + 1}</span>}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: i === 0 ? '#ffd700' : '#94a3b8' }}>{entry.name}</div>
                      <div className="text-[10px] font-mono" style={{ color: '#3a3a5a' }}>{entry.score} reactions</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] font-mono text-center mt-6" style={{ color: '#1e1e2e' }}>
                REACT FROM YOUR PHONE
              </p>
            </div>
          )}
          </div>
        ) : isDone ? (
          // ── DONE VIEW ────────────────────────────────────────────────────────
          <div className="flex-1 flex flex-col items-center justify-center gap-8 text-center px-8">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)' }}
            >
              <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#a78bfa' }}>
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
            <div>
              <h1 className="text-5xl font-black" style={{ color: '#e2e8f0' }}>THAT'S A WRAP</h1>
              <p className="text-lg mt-3" style={{ color: '#475569' }}>
                {attendeeData.total} people shaped tonight's set
              </p>
            </div>
            <div
              className="text-xs font-mono tracking-[0.3em] transition-opacity duration-500"
              style={{ color: '#3a3a5a', opacity: msgFade ? 1 : 0 }}
            >
              {currentMsg.toUpperCase()}
            </div>
            <span
              className="text-3xl font-black tracking-[0.3em] mt-4"
              style={{ color: '#1a1a2e', fontFamily: 'JetBrains Mono, monospace' }}
            >
              BAMBATA
            </span>
          </div>
        ) : (
          // ── 3-PANEL VIEW (waiting / voting / building) ────────────────────
          <div className="flex-1 grid" style={{ gridTemplateColumns: '1fr 1.6fr 1.1fr' }}>

            {/* LEFT: QR + Join URL */}
            <div
              className="flex flex-col items-center justify-center gap-6 p-8"
              style={{ borderRight: '1px solid rgba(255,255,255,0.03)' }}
            >
              {showQr && (
                <>
                  <div className="text-xs font-mono tracking-[0.3em]" style={{ color: '#3a3a5a' }}>
                    SCAN TO JOIN
                  </div>
                  <div
                    className="rounded-2xl p-4"
                    style={{ background: '#080810', border: '1px solid rgba(0,210,255,0.1)', boxShadow: '0 0 40px rgba(0,210,255,0.06)' }}
                  >
                    {qrUrl ? (
                      <img src={qrUrl} alt="Join QR" style={{ width: 240, height: 240 }} />
                    ) : (
                      <div
                        className="flex items-center justify-center"
                        style={{ width: 240, height: 240 }}
                      >
                        <div
                          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                          style={{ borderColor: '#00d2ff', borderTopColor: 'transparent' }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="text-center space-y-1">
                    <div className="text-xs font-mono" style={{ color: '#2a2a4a' }}>
                      {window.location.host}/party/
                    </div>
                    <div className="text-sm font-mono font-bold" style={{ color: '#475569' }}>
                      {partyId}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* CENTER: Big stats + progress + message */}
            <div className="flex flex-col items-center justify-center gap-8 p-8 text-center">
              {/* Big number */}
              <div>
                <div
                  className="font-black leading-none"
                  style={{
                    fontSize: '8rem',
                    color: '#0f0f1c',
                    WebkitTextStroke: '1px rgba(0,210,255,0.15)',
                    lineHeight: 1,
                  }}
                >
                  {attendeeData.total}
                </div>
                <div className="text-sm font-mono tracking-[0.25em] mt-2" style={{ color: '#3a3a5a' }}>
                  {attendeeData.total === 1 ? 'PERSON' : 'PEOPLE'} IN THE BUILDING
                </div>
              </div>

              {/* Voting progress — only when swipe is open or closed */}
              {(phase === 'swipe_open' || phase === 'swipe_closed') && attendeeData.total > 0 && (
                <div className="w-full max-w-xs space-y-3">
                  <div className="flex justify-between text-xs font-mono" style={{ color: '#3a3a5a' }}>
                    <span>{attendeeData.done_count} voted</span>
                    <span>{attendeeData.total - attendeeData.done_count} left</span>
                  </div>
                  {/* Progress track */}
                  <div className="relative h-2 rounded-full overflow-hidden" style={{ background: '#0f0f1c' }}>
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                      style={{
                        width: `${progress * 100}%`,
                        background: progress >= 1
                          ? 'linear-gradient(90deg, #22c55e, #00d2ff)'
                          : 'linear-gradient(90deg, #a78bfa, #00d2ff)',
                        boxShadow: `0 0 12px ${progress >= 1 ? 'rgba(34,197,94,0.4)' : 'rgba(0,210,255,0.3)'}`,
                      }}
                    />
                  </div>
                  {progress >= 1 && (
                    <div className="text-xs font-mono tracking-widest text-center" style={{ color: '#22c55e', animation: 'pulse 1.5s ease-in-out infinite' }}>
                      ALL VOTES IN — BUILDING SET...
                    </div>
                  )}
                </div>
              )}

              {/* Pulsing visual when waiting */}
              {phase !== 'swipe_open' && phase !== 'swipe_closed' && (
                <div className="relative flex items-center justify-center" style={{ width: 100, height: 100 }}>
                  <div
                    className="absolute rounded-full"
                    style={{ width: 100, height: 100, background: 'rgba(167,139,250,0.03)', animation: 'ping 3s ease-in-out infinite' }}
                  />
                  <div
                    className="absolute rounded-full"
                    style={{ width: 64, height: 64, background: 'rgba(167,139,250,0.05)', animation: 'pulse 2s ease-in-out infinite' }}
                  />
                  <div
                    className="rounded-full flex items-center justify-center"
                    style={{ width: 40, height: 40, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)' }}
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: '#a78bfa' }}>
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Engagement message */}
              <div
                className="transition-opacity duration-500"
                style={{ opacity: msgFade ? 1 : 0 }}
              >
                <p className="text-base font-mono tracking-widest" style={{ color: '#2a2a4a' }}>
                  {currentMsg.toUpperCase()}
                </p>
              </div>
            </div>

            {/* RIGHT: Live attendee feed */}
            <div
              className="flex flex-col justify-center gap-2 p-8 overflow-hidden"
              style={{ borderLeft: '1px solid rgba(255,255,255,0.03)' }}
            >
              <div className="text-[10px] font-mono tracking-[0.3em] mb-4" style={{ color: '#2a2a4a' }}>
                LIVE FEED
              </div>

              {visibleAttendees.length === 0 ? (
                <div className="text-xs font-mono" style={{ color: '#1e1e2e' }}>
                  Waiting for guests...
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleAttendees.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 transition-all duration-500"
                      style={{
                        opacity: newJoinId === a.id ? 0.5 : 1,
                        animation: newJoinId === a.id ? 'none' : undefined,
                      }}
                    >
                      {/* Status dot */}
                      <div
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{
                          background: a.done ? '#22c55e' : '#2a2a4a',
                          boxShadow: a.done ? '0 0 4px rgba(34,197,94,0.5)' : 'none',
                        }}
                      />
                      {/* Name */}
                      <span
                        className="text-sm font-mono truncate flex-1"
                        style={{ color: a.done ? '#64748b' : '#3a3a5a' }}
                      >
                        {a.attendee_name}
                      </span>
                      {/* Done checkmark */}
                      {a.done && (
                        <span className="text-xs font-mono flex-shrink-0" style={{ color: '#22c55e' }}>
                          ✓
                        </span>
                      )}
                      {/* Voting indicator */}
                      {!a.done && (phase === 'swipe_open') && (
                        <span className="text-[10px] font-mono flex-shrink-0" style={{ color: '#1e1e2e' }}>
                          {a.swipes_done}/{a.total_tracks}
                        </span>
                      )}
                    </div>
                  ))}

                  {attendeeData.total > 12 && (
                    <div className="text-[10px] font-mono pt-2" style={{ color: '#1e1e2e' }}>
                      +{attendeeData.total - 12} more
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer ticker */}
      <div
        className="relative z-10 px-8 py-3 flex items-center justify-between"
        style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}
      >
        <span className="text-[10px] font-mono tracking-[0.2em]" style={{ color: '#1a1a2e' }}>
          BAMBATA · MUSIC INTELLIGENCE
        </span>
        <span className="text-[10px] font-mono" style={{ color: '#1a1a2e' }}>
          {attendeeData.total} guests · {attendeeData.done_count} voted
        </span>
      </div>
    </div>
  )
}
