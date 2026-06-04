import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Party, Pass } from '../../types/party'
import { getDeviceId } from '../../utils/deviceId'

export default function Landing() {
  const { partyId } = useParams<{ partyId: string }>()
  const navigate = useNavigate()

  const [party, setParty] = useState<Party | null>(null)
  const [form, setForm] = useState({ name: '', code: '' })
  const [showCode, setShowCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState('')
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    if (!partyId) return

    const stored = localStorage.getItem(`bambata_pass_${partyId}`)
    if (stored) {
      const p = JSON.parse(stored) as Pass
      fetch(`/api/parties/${partyId}`)
        .then((r) => r.json() as Promise<Party>)
        .then((party) => {
          if (party.status === 'swipe_open') navigate(`/party/${partyId}/swipe`)
          else navigate(`/party/${partyId}/pass`)
        })
        .catch(() => navigate(`/party/${partyId}/pass`))
      void p
      return
    }

    // Fetch party info (also warms up the server so JOIN is fast)
    fetch(`/api/parties/${partyId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found')
        return r.json() as Promise<Party>
      })
      .then(setParty)
      .catch(() => setFetchError('Party not found. Check your invite link.'))
  }, [partyId, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!partyId || !form.name.trim()) return
    setLoading(true)
    setSlow(false)
    setError('')

    const controller = new AbortController()
    const slowTimer = setTimeout(() => setSlow(true), 6000)
    const killTimer = setTimeout(() => controller.abort(), 20000)

    try {
      const res = await fetch(`/api/parties/${partyId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendeeName: form.name.trim(),
          code: form.code.trim() || undefined,
          deviceId: getDeviceId(),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = (await res.json()) as { error: string }
        throw new Error(data.error)
      }

      const pass = (await res.json()) as Pass
      localStorage.setItem(`bambata_pass_${partyId}`, JSON.stringify(pass))

      if (party?.status === 'swipe_open') {
        navigate(`/party/${partyId}/swipe`)
      } else {
        navigate(`/party/${partyId}/pass`)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Connection timed out. Tap to try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    } finally {
      clearTimeout(slowTimer)
      clearTimeout(killTimer)
      setLoading(false)
      setSlow(false)
    }
  }

  if (fetchError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#050508' }}>
        <div className="text-center">
          <p className="text-sm font-mono" style={{ color: '#ef4444' }}>{fetchError}</p>
          <button onClick={() => navigate('/')} className="mt-4 text-xs font-mono" style={{ color: '#475569' }}>
            GO HOME
          </button>
        </div>
      </div>
    )
  }

  if (!party) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050508' }}>
        <span className="text-xs font-mono animate-pulse" style={{ color: '#475569' }}>LOADING...</span>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: '#050508' }}
    >
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <span className="text-xs font-mono tracking-[0.3em]" style={{ color: '#00d2ff', fontFamily: 'JetBrains Mono, monospace' }}>
            BAMBATA
          </span>
          <div className="mt-6">
            <span className="text-xs font-mono tracking-widest" style={{ color: '#475569' }}>
              YOU'RE INVITED TO
            </span>
            <h1 className="text-3xl font-black mt-2 mb-1" style={{ color: '#e2e8f0' }}>
              {party.name}
            </h1>
            <p className="text-sm font-mono" style={{ color: '#475569' }}>
              {party.venue} · {party.date}
            </p>
            {party.genre_mode && (
              <p className="text-xs font-mono mt-1" style={{ color: '#a78bfa' }}>
                {party.genre_mode}
              </p>
            )}
          </div>

          {party.status === 'swipe_open' && (
            <div
              className="mt-4 px-4 py-2 rounded-xl inline-block text-xs font-mono"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}
            >
              SWIPE WINDOW OPEN — JOIN NOW
            </div>
          )}
        </div>

        {/* Join form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-mono mb-2" style={{ color: '#475569' }}>
              YOUR NAME
            </label>
            <input
              required
              autoFocus
              type="text"
              placeholder="What do people call you?"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-3.5 rounded-xl text-sm outline-none"
              style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
            />
          </div>

          {/* Optional access code toggle */}
          {!showCode ? (
            <button
              type="button"
              onClick={() => setShowCode(true)}
              className="text-left text-xs font-mono"
              style={{ color: '#3a3a5a' }}
            >
              + Have an access code?
            </button>
          ) : (
            <div>
              <label className="block text-xs font-mono mb-2" style={{ color: '#475569' }}>
                ACCESS CODE <span style={{ color: '#3a3a5a' }}>(optional)</span>
              </label>
              <input
                type="text"
                placeholder="B-XXXXXX"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                className="w-full px-4 py-3 rounded-xl text-sm font-mono outline-none tracking-widest"
                style={{ background: '#0f0f17', border: '1px solid #1e1e2e', color: '#e2e8f0' }}
              />
            </div>
          )}

          {error && (
            <div
              className="px-4 py-3 rounded-xl text-xs font-mono"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !form.name.trim()}
            className="w-full py-4 rounded-xl font-bold text-sm tracking-wider disabled:opacity-50 mt-2 flex flex-col items-center gap-1"
            style={{
              background: 'linear-gradient(135deg, rgba(167,139,250,0.2) 0%, rgba(167,139,250,0.1) 100%)',
              border: '1px solid rgba(167,139,250,0.4)',
              color: '#a78bfa',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {loading ? (slow ? 'ALMOST THERE…' : 'JOINING...') : party.status === 'swipe_open' ? 'JOIN & VOTE NOW' : "I'M IN"}
            {slow && (
              <span className="text-[9px] font-mono opacity-60 tracking-wider">server is waking up</span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
