import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDeviceId } from '../../utils/deviceId'

interface PlaceResult {
  name: string
  address: string
  full: string
}

const GENRE_MODES = ['Open Format', 'Hip-Hop', 'House', 'Afrobeats', 'R&B']
const DURATIONS = [5, 30, 60, 180, 240]

function fmtDuration(min: number): string {
  if (min < 60) return `${min} MIN`
  const h = min / 60
  return `${h % 1 === 0 ? h : h.toFixed(1)} HR${h > 1 ? 'S' : ''}`
}

export default function CreateParty() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    date: '',
    venue: '',
    genreMode: 'Open Format',
    durationMin: 60,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([])
  const [placesOpen, setPlacesOpen] = useState(false)
  const [placesLoading, setPlacesLoading] = useState(false)
  const venueRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Debounced place search
  useEffect(() => {
    if (form.venue.length < 2) { setPlaceResults([]); setPlacesOpen(false); return }
    setPlacesLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/search?q=${encodeURIComponent(form.venue)}`)
        if (res.ok) {
          const data = await res.json() as PlaceResult[]
          setPlaceResults(data)
          setPlacesOpen(data.length > 0)
        }
      } catch {}
      finally { setPlacesLoading(false) }
    }, 250)
    return () => clearTimeout(timer)
  }, [form.venue])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        venueRef.current && !venueRef.current.contains(e.target as Node)
      ) setPlacesOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelectPlace = (place: PlaceResult) => {
    setForm((f) => ({ ...f, venue: place.full }))
    setPlacesOpen(false)
    setPlaceResults([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, deviceId: getDeviceId() }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error: string }
        throw new Error(data.error)
      }

      const party = (await res.json()) as { id: string; creatorToken: string }
      localStorage.setItem(`bambata_creator_${party.id}`, party.creatorToken)
      navigate(`/creator/${party.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create party')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8"
      style={{ background: '#050508' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="text-xs font-mono mb-4 flex items-center gap-2"
            style={{ color: '#475569' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            BACK
          </button>
          <h1
            className="text-2xl font-black tracking-widest transition-all duration-150"
            style={{ color: '#00d2ff', fontFamily: 'JetBrains Mono, monospace' }}
          >
            {form.name.trim() ? form.name.toUpperCase() : 'NEW PARTY'}
          </h1>
          <p className="text-xs mt-1" style={{ color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
            {form.name.trim() ? 'looking good.' : 'Set up the night.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-mono mb-2" style={{ color: '#475569' }}>
              PARTY NAME
            </label>
            <input
              required
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Friday Vibes"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                background: '#0f0f17',
                border: '1px solid #1e1e2e',
                color: '#e2e8f0',
                fontFamily: 'system-ui',
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-mono mb-2" style={{ color: '#475569' }}>
              DATE
            </label>
            <input
              required
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                background: '#0f0f17',
                border: '1px solid #1e1e2e',
                color: '#e2e8f0',
                fontFamily: 'JetBrains Mono, monospace',
                colorScheme: 'dark',
              }}
            />
          </div>

          <div className="relative">
            <label className="block text-xs font-mono mb-2" style={{ color: '#475569' }}>
              VENUE
            </label>
            <div className="relative">
              <input
                ref={venueRef}
                required
                type="text"
                value={form.venue}
                onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))}
                onFocus={() => { if (placeResults.length > 0) setPlacesOpen(true) }}
                placeholder="Search venue or address…"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none pr-10"
                style={{
                  background: '#0f0f17',
                  border: `1px solid ${placesOpen ? 'rgba(0,210,255,0.4)' : '#1e1e2e'}`,
                  color: '#e2e8f0',
                  fontFamily: 'system-ui',
                }}
              />
              <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                {placesLoading ? (
                  <div className="w-3.5 h-3.5 rounded-full border border-t-transparent animate-spin" style={{ borderColor: '#00d2ff', borderTopColor: 'transparent' }} />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#334155' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </div>
            </div>

            {/* Dropdown */}
            {placesOpen && placeResults.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute z-50 w-full mt-1 rounded-xl overflow-hidden"
                style={{ background: '#0f0f17', border: '1px solid rgba(0,210,255,0.2)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
              >
                {placeResults.map((place, i) => (
                  <button
                    key={i}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectPlace(place) }}
                    className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors"
                    style={{ borderBottom: i < placeResults.length - 1 ? '1px solid #1e1e2e' : 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#181825')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#00d2ff' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>{place.name}</div>
                      {place.address && (
                        <div className="text-xs truncate mt-0.5" style={{ color: '#475569' }}>{place.address}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-mono mb-2" style={{ color: '#475569' }}>
              GENRE MODE
            </label>
            <select
              value={form.genreMode}
              onChange={(e) => setForm((f) => ({ ...f, genreMode: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                background: '#0f0f17',
                border: '1px solid #1e1e2e',
                color: '#e2e8f0',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {GENRE_MODES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono mb-2" style={{ color: '#475569' }}>
              DURATION
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => {
                const isSelected = form.durationMin === d
                const isFree = d === 5
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, durationMin: d }))}
                    className="flex-1 min-w-[4.5rem] py-2.5 rounded-xl text-xs font-mono font-bold transition-all relative"
                    style={{
                      background: isSelected
                        ? isFree ? 'rgba(34,197,94,0.15)' : 'rgba(0,210,255,0.15)'
                        : '#0f0f17',
                      border: `1px solid ${isSelected ? (isFree ? 'rgba(34,197,94,0.4)' : 'rgba(0,210,255,0.4)') : '#1e1e2e'}`,
                      color: isSelected ? (isFree ? '#22c55e' : '#00d2ff') : '#475569',
                    }}
                  >
                    {fmtDuration(d)}
                    {isFree && (
                      <span
                        className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ background: isSelected ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.15)', color: '#22c55e', letterSpacing: '0.05em' }}
                      >
                        FREE
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {form.durationMin === 5 && (
              <p className="text-[10px] font-mono mt-2" style={{ color: '#3a3a5a' }}>
                Perfect for a quick demo — brain fills the set automatically.
              </p>
            )}
          </div>

          {error && (
            <div
              className="px-4 py-3 rounded-xl text-xs font-mono"
              style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl font-bold text-sm tracking-wider transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, rgba(0, 210, 255, 0.2) 0%, rgba(0, 210, 255, 0.1) 100%)',
              border: '1px solid rgba(0, 210, 255, 0.5)',
              color: '#00d2ff',
              fontFamily: 'JetBrains Mono, monospace',
              marginTop: '8px',
            }}
          >
            {loading ? 'CREATING...' : 'CREATE PARTY'}
          </button>
        </form>
      </div>
    </div>
  )
}
