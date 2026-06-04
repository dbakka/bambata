import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

interface LeaderEntry { name: string; score: number }

const MEDALS = ['🥇', '🥈', '🥉']

export default function Leaderboard() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()
  const [entries, setEntries] = useState<LeaderEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBoard = () => {
    if (!partyId) return
    fetch(`/api/parties/${partyId}/leaderboard`)
      .then(r => r.ok ? r.json() as Promise<LeaderEntry[]> : Promise.reject())
      .then(d => { setEntries(d); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    fetchBoard()
    const t = setInterval(fetchBoard, 10000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId])

  return (
    <div className="min-h-screen flex flex-col px-5 py-8" style={{ background: '#050508' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => navigate(-1)}
          className="text-xs font-mono flex items-center gap-2"
          style={{ color: '#475569' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          BACK
        </button>
        <span className="text-xs font-mono tracking-widest" style={{ color: '#00d2ff' }}>
          BAMBATA
        </span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-wider" style={{ color: '#e2e8f0', fontFamily: 'JetBrains Mono, monospace' }}>
          TOP TASTE
        </h1>
        <p className="text-xs font-mono mt-1" style={{ color: '#3a3a5a' }}>
          People who vibed with the crowd
        </p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs font-mono animate-pulse" style={{ color: '#475569' }}>LOADING…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="text-4xl">🎵</div>
          <p className="text-sm text-center" style={{ color: '#3a3a5a' }}>
            No reactions yet.<br />Tap the screen when a track hits!
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-4 rounded-xl"
              style={{
                background: i === 0 ? 'rgba(255,215,0,0.06)' : i === 1 ? 'rgba(192,192,192,0.06)' : i === 2 ? 'rgba(205,127,50,0.06)' : '#0a0a0f',
                border: i === 0 ? '1px solid rgba(255,215,0,0.2)' : i === 1 ? '1px solid rgba(192,192,192,0.15)' : i === 2 ? '1px solid rgba(205,127,50,0.15)' : '1px solid #1e1e2e',
              }}
            >
              <span className="text-xl w-8 text-center flex-shrink-0">
                {MEDALS[i] ?? <span className="text-sm font-mono" style={{ color: '#475569' }}>#{i + 1}</span>}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate" style={{ color: '#e2e8f0' }}>{entry.name}</div>
                <div className="text-xs font-mono mt-0.5" style={{ color: '#475569' }}>
                  {entry.score} crowd reaction{entry.score !== 1 ? 's' : ''}
                </div>
              </div>
              {i === 0 && (
                <div
                  className="text-[10px] font-mono px-2 py-1 rounded-lg flex-shrink-0"
                  style={{ background: 'rgba(255,215,0,0.12)', color: '#ffd700' }}
                >
                  BEST TASTE
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-[10px] font-mono mt-8" style={{ color: '#1e1e2e' }}>
        Score = reactions on tracks the crowd loved
      </p>
    </div>
  )
}
