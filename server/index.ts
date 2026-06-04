import express from 'express'
import { createServer } from 'http'
import { Server as SocketServer } from 'socket.io'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import { Readable } from 'stream'
import path from 'path'
import { fileURLToPath } from 'url'
import db from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const httpServer = createServer(app)
const io = new SocketServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
})

app.use(cors())
app.use(express.json())

// ─── Helpers ────────────────────────────────────────────────────────────────

function shortId(): string {
  return uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()
}

function randomCode(prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = prefix + '-'
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

function requireCreatorToken(partyId: string, token: string | undefined, deviceId?: string): boolean {
  const party = db.prepare('SELECT creator_token, device_id FROM parties WHERE id = ?').get(partyId) as
    | { creator_token: string; device_id: string | null }
    | undefined
  if (!party) return false
  if (token && party.creator_token === token) return true
  // Device-ID fallback: same phone that created the party counts as creator
  if (deviceId && party.device_id && party.device_id === deviceId) return true
  return false
}

interface Track {
  id: string
  party_id: string
  title: string
  artist: string
  bpm: number | null
  musical_key: string | null
  energy: number
  duration_sec: number | null
  file_path: string | null
  swipe_count: number
  added_by: string
  queue_position: number | null
  played_at: number | null
  created_at: number
}

function buildQueue(partyId: string): Track[] {
  // Voted tracks form the energy arc; unvoted (creator picks, etc.) fill the end
  const voted = db
    .prepare('SELECT * FROM tracks WHERE party_id = ? AND swipe_count > 0 ORDER BY swipe_count DESC')
    .all(partyId) as Track[]

  const unvoted = db
    .prepare('SELECT * FROM tracks WHERE party_id = ? AND swipe_count = 0')
    .all(partyId) as Track[]

  if (voted.length === 0 && unvoted.length === 0) return []

  const sortBpm = (arr: Track[]) => [...arr].sort((a, b) => (a.bpm ?? 120) - (b.bpm ?? 120))

  const buildArc = (tracks: Track[]) => {
    const warm    = tracks.filter((t) => t.energy < 4)
    const build   = tracks.filter((t) => t.energy >= 4 && t.energy < 6)
    const peak    = tracks.filter((t) => t.energy >= 6 && t.energy < 8)
    const peakP   = tracks.filter((t) => t.energy >= 8)
    return [...sortBpm(warm), ...sortBpm(build), ...sortBpm(peak), ...sortBpm(peakP)]
  }

  const arcVoted = buildArc(voted)

  // Cooldown: repeat first 2 warm-voted tracks at end of arc
  const warmVoted = sortBpm(voted.filter((t) => t.energy < 4))
  if (warmVoted.length >= 2 && arcVoted.length >= 4) {
    arcVoted.push(warmVoted[0], warmVoted[1])
  }

  // Unvoted tracks (creator-added without votes) go at the end as extras
  const ordered = [...arcVoted, ...buildArc(unvoted)]

  const updatePos = db.prepare('UPDATE tracks SET queue_position = ? WHERE id = ?')
  db.transaction((list: Track[]) => {
    list.forEach((t, i) => updatePos.run(i + 1, t.id))
  })(ordered)

  return ordered
}

function closeSwipeWindow(partyId: string) {
  db.prepare("UPDATE parties SET status = 'pending', swipe_ends_at = NULL WHERE id = ?").run(
    partyId,
  )
  const queue = buildQueue(partyId)
  io.to(`party:${partyId}`).emit('swipe:closed', { partyId })
  io.to(`party:${partyId}`).emit('party:status', { status: 'pending', queue })
  io.to(`creator:${partyId}`).emit('swipe:closed', { partyId })
  io.to(`creator:${partyId}`).emit('party:status', { status: 'pending', queue })
}

// In-memory stream URL cache (avoids re-fetching Audiomack pages on every range request)
interface CachedStream { url: string; cachedAt: number }
const streamCache = new Map<string, CachedStream>()

// Missing tracks log: party_id → array of {trackId, title, artist, reason, at}
interface MissingTrack { trackId: string; title: string; artist: string; reason: string; at: number }
const missingTracksLog = new Map<string, MissingTrack[]>()

function logMissingTrack(partyId: string, entry: MissingTrack) {
  const list = missingTracksLog.get(partyId) ?? []
  // Replace if already logged for this track
  const idx = list.findIndex((e) => e.trackId === entry.trackId)
  if (idx >= 0) list[idx] = entry
  else list.push(entry)
  missingTracksLog.set(partyId, list)
}

async function resolveStreamUrl(rawUrl: string | null, title?: string, artist?: string): Promise<string | null> {
  if (rawUrl) {
    // Already a direct audio URL — use as-is
    if (!rawUrl.includes('audiomack.com/') || rawUrl.match(/\.(mp3|m4a|ogg|wav|aac|flac)(\?|$)/i)) {
      return rawUrl
    }

    // Try Audiomack API: parse artist + slug from URL
    const apiMatch = rawUrl.match(/audiomack\.com\/([^/]+)\/song\/([^/?#]+)/)
    if (apiMatch) {
      const [, urlArtist, slug] = apiMatch
      try {
        const apiRes = await fetch(
          `https://api.audiomack.com/v1/music/song/${urlArtist}/${slug}?api_key=anonymous`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
        )
        if (apiRes.ok) {
          const data = await apiRes.json() as { results?: { url?: string; hls_url?: string }[] }
          const url = data.results?.[0]?.url ?? data.results?.[0]?.hls_url
          if (url) return url
        }
      } catch {}
    }

    // Fallback: scrape og:audio from Audiomack page
    try {
      const pageRes = await fetch(rawUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(10000),
      })
      const html = await pageRes.text()
      const patterns = [
        /<meta[^>]+property=["']og:audio["'][^>]+content=["']([^"']+)["']/,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:audio["']/,
        /"stream_url"\s*:\s*"([^"]+)"/,
        /"audio_url"\s*:\s*"([^"]+)"/,
      ]
      for (const pattern of patterns) {
        const m = html.match(pattern)
        if (m?.[1]) return m[1]
      }
    } catch {}
  }

  // Search Audiomack by title + artist (handles both null URL and failed resolution above)
  if (title || artist) {
    const q = encodeURIComponent(`${title ?? ''} ${artist ?? ''}`.trim())
    try {
      const searchRes = await fetch(
        `https://api.audiomack.com/v1/music?q=${q}&limit=3&api_key=anonymous`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      )
      if (searchRes.ok) {
        const data = await searchRes.json() as { results?: { url?: string; hls_url?: string }[] }
        const url = data.results?.[0]?.url ?? data.results?.[0]?.hls_url
        if (url) return url
      }
    } catch {}
  }

  return null
}

// ─── Auto-close interval ─────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now()
  const openParties = db
    .prepare(
      "SELECT id, swipe_ends_at FROM parties WHERE status = 'swipe_open' AND swipe_ends_at IS NOT NULL AND swipe_ends_at <= ?",
    )
    .all(now) as { id: string; swipe_ends_at: number }[]

  for (const party of openParties) {
    closeSwipeWindow(party.id)
  }
}, 5000)

// ─── Party Routes ─────────────────────────────────────────────────────────────

// POST /api/parties — create party
app.post('/api/parties', (req, res) => {
  const { name, date, venue, genreMode, durationMin, deviceId } = req.body as {
    name: string
    date: string
    venue: string
    genreMode: string
    durationMin: number
    deviceId?: string
  }

  if (!name || !date || !venue) {
    res.status(400).json({ error: 'name, date, venue are required' })
    return
  }

  const id = shortId()
  const creatorToken = uuidv4()

  if (deviceId) {
    const acctExists = db.prepare('SELECT id FROM device_accounts WHERE id = ?').get(deviceId)
    if (!acctExists) db.prepare('INSERT INTO device_accounts (id) VALUES (?)').run(deviceId)
  }

  db.prepare(
    'INSERT INTO parties (id, name, date, venue, genre_mode, duration_min, status, creator_token, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name, date, venue, genreMode || 'Open Format', durationMin || 120, 'pending', creatorToken, deviceId ?? null)

  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id) as Record<string, unknown>
  res.json({ ...party, creatorToken })
})

// GET /api/parties/:id
app.get('/api/parties/:id', (req, res) => {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined

  if (!party) {
    res.status(404).json({ error: 'Party not found' })
    return
  }

  const token = req.headers["x-creator-token"] as string | undefined
  const deviceId = req.headers["x-device-id"] as string | undefined
  const isCreator = token && token === party.creator_token

  if (!isCreator) {
    const { creator_token: _ct, ...safe } = party
    res.json(safe)
    return
  }

  res.json(party)
})

// PATCH /api/parties/:id/status
app.patch('/api/parties/:id/status', (req, res) => {
  const { id } = req.params
  const token = req.headers["x-creator-token"] as string | undefined
  const deviceId = req.headers["x-device-id"] as string | undefined

  if (!requireCreatorToken(id, token, deviceId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { status } = req.body as { status: string }

  if (status === 'swipe_open') {
    const swipeEndsAt = Date.now() + 5 * 60 * 1000
    db.prepare("UPDATE parties SET status = 'swipe_open', swipe_ends_at = ? WHERE id = ?").run(
      swipeEndsAt,
      id,
    )
    const partyForSeed = db.prepare('SELECT genre_mode FROM parties WHERE id = ?').get(id) as { genre_mode: string } | undefined
    if (partyForSeed) void bambataSeed(id, partyForSeed.genre_mode)
    io.to(`party:${id}`).emit('swipe:opened', { partyId: id, endsAt: swipeEndsAt })
    io.to(`creator:${id}`).emit('swipe:opened', { partyId: id, endsAt: swipeEndsAt })
  } else if (status === 'mixing') {
    const queue = buildQueue(id)
    db.prepare("UPDATE parties SET status = 'mixing' WHERE id = ?").run(id)
    io.to(`party:${id}`).emit('party:status', { status: 'mixing', queue })
    io.to(`creator:${id}`).emit('party:status', { status: 'mixing', queue })
  } else if (status === 'done') {
    db.prepare("UPDATE parties SET status = 'done' WHERE id = ?").run(id)
    io.to(`party:${id}`).emit('party:done', { partyId: id })
    io.to(`creator:${id}`).emit('party:done', { partyId: id })
  } else if (status === 'pending') {
    const current = db.prepare('SELECT status FROM parties WHERE id = ?').get(id) as { status: string } | undefined
    db.prepare("UPDATE parties SET status = 'pending', swipe_ends_at = NULL WHERE id = ?").run(id)
    if (current?.status === 'swipe_open') {
      const queue = buildQueue(id)
      io.to(`party:${id}`).emit('swipe:closed', { partyId: id })
      io.to(`party:${id}`).emit('party:status', { status: 'pending', queue })
      io.to(`creator:${id}`).emit('swipe:closed', { partyId: id })
      io.to(`creator:${id}`).emit('party:status', { status: 'pending', queue })
    }
  } else {
    res.status(400).json({ error: 'Invalid status' })
    return
  }

  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id)
  res.json(party)
})

// GET /api/parties/:id/codes
app.get('/api/parties/:id/codes', (req, res) => {
  const { id } = req.params
  const token = req.headers["x-creator-token"] as string | undefined
  const deviceId = req.headers["x-device-id"] as string | undefined

  if (!requireCreatorToken(id, token, deviceId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const codes = db.prepare('SELECT * FROM access_codes WHERE party_id = ?').all(id)
  res.json(codes)
})

// POST /api/parties/:id/codes
app.post('/api/parties/:id/codes', (req, res) => {
  const { id } = req.params
  const token = req.headers["x-creator-token"] as string | undefined
  const deviceId = req.headers["x-device-id"] as string | undefined

  if (!requireCreatorToken(id, token, deviceId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { type, count, tokenAmount } = req.body as {
    type: 'pass' | 'tokens'
    count: number
    tokenAmount?: number
  }

  const prefix = type === 'pass' ? 'B' : 'T'
  const generated: unknown[] = []

  for (let i = 0; i < count; i++) {
    let code = randomCode(prefix)
    // Ensure uniqueness
    while (db.prepare('SELECT id FROM access_codes WHERE code = ?').get(code)) {
      code = randomCode(prefix)
    }
    const codeId = uuidv4()
    db.prepare(
      'INSERT INTO access_codes (id, party_id, code, type, token_amount) VALUES (?, ?, ?, ?, ?)',
    ).run(codeId, id, code, type, tokenAmount ?? null)
    generated.push(db.prepare('SELECT * FROM access_codes WHERE id = ?').get(codeId))
  }

  res.json(generated)
})

// POST /api/parties/:id/codes/redeem
app.post('/api/parties/:id/codes/redeem', (req, res) => {
  const { id } = req.params
  const { code, attendeeName, attendeeContact } = req.body as {
    code: string
    attendeeName: string
    attendeeContact: string
  }

  if (!code || !attendeeName || !attendeeContact) {
    res.status(400).json({ error: 'code, attendeeName, attendeeContact required' })
    return
  }

  const accessCode = db
    .prepare(
      "SELECT * FROM access_codes WHERE UPPER(code) = UPPER(?) AND party_id = ? AND type = 'pass'",
    )
    .get(code, id) as
    | { id: string; party_id: string; code: string; type: string; redeemed_by_pass_id: string | null }
    | undefined

  if (!accessCode) {
    res.status(400).json({ error: 'Invalid or expired access code' })
    return
  }

  if (accessCode.redeemed_by_pass_id) {
    res.status(400).json({ error: 'Access code already used' })
    return
  }

  const passId = uuidv4()
  const qrData = JSON.stringify({ passId, partyId: id })

  db.prepare(
    'INSERT INTO passes (id, party_id, attendee_name, attendee_contact, qr_data, access_code_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(passId, id, attendeeName, attendeeContact, qrData, accessCode.id)

  db.prepare('UPDATE access_codes SET redeemed_by_pass_id = ? WHERE id = ?').run(
    passId,
    accessCode.id,
  )

  // Create wallet
  db.prepare(
    'INSERT INTO token_wallets (id, party_id, pass_id, balance) VALUES (?, ?, ?, 0)',
  ).run(uuidv4(), id, passId)

  const pass = db.prepare('SELECT * FROM passes WHERE id = ?').get(passId) as Record<string, unknown>
  const totalPasses = (
    db.prepare('SELECT COUNT(*) as cnt FROM passes WHERE party_id = ?').get(id) as {
      cnt: number
    }
  ).cnt

  io.to(`creator:${id}`).emit('pass:count', { total: totalPasses })

  res.json({ ...pass, qrData })
})

// POST /api/parties/:id/join — open join (no access code required)
app.post('/api/parties/:id/join', (req, res) => {
  const { id } = req.params
  const { attendeeName, attendeeContact, code, deviceId } = req.body as {
    attendeeName: string
    attendeeContact?: string
    code?: string
    deviceId?: string
  }

  if (!attendeeName?.trim()) {
    res.status(400).json({ error: 'Your name is required' })
    return
  }

  const party = db.prepare('SELECT id FROM parties WHERE id = ?').get(id)
  if (!party) {
    res.status(404).json({ error: 'Party not found' })
    return
  }

  let accessCodeId: string | null = null
  if (code?.trim()) {
    const ac = db.prepare(
      "SELECT * FROM access_codes WHERE UPPER(code) = UPPER(?) AND party_id = ? AND type = 'pass'"
    ).get(code.trim(), id) as { id: string; redeemed_by_pass_id: string | null } | undefined
    if (!ac) { res.status(400).json({ error: 'Invalid access code' }); return }
    if (ac.redeemed_by_pass_id) { res.status(400).json({ error: 'Access code already used' }); return }
    accessCodeId = ac.id
  }

  const passId = uuidv4()
  const walletId = uuidv4()
  const qrData = JSON.stringify({ passId, partyId: id })
  const name = attendeeName.trim()
  const contact = attendeeContact?.trim() ?? ''

  // Run all writes in one transaction for speed
  const joinTx = db.transaction(() => {
    if (deviceId) {
      db.prepare(
        'INSERT OR IGNORE INTO device_accounts (id) VALUES (?)'
      ).run(deviceId)
    }
    db.prepare(
      'INSERT INTO passes (id, party_id, attendee_name, attendee_contact, qr_data, access_code_id, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(passId, id, name, contact, qrData, accessCodeId, deviceId ?? null)
    if (accessCodeId) {
      db.prepare('UPDATE access_codes SET redeemed_by_pass_id = ? WHERE id = ?').run(passId, accessCodeId)
    }
    db.prepare(
      'INSERT INTO token_wallets (id, party_id, pass_id, balance) VALUES (?, ?, ?, 0)'
    ).run(walletId, id, passId)
  })

  joinTx()

  // Emit attendee count to creator asynchronously (don't block response)
  setImmediate(() => {
    const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM passes WHERE party_id = ?').get(id) as { cnt: number }
    io.to(`creator:${id}`).emit('pass:count', { total: cnt })
  })

  res.json({ id: passId, party_id: id, attendee_name: name, attendee_contact: contact, qr_data: qrData, access_code_id: accessCodeId, device_id: deviceId ?? null, qrData })
})

// POST /api/parties/:id/tracks/suggest — attendee suggests a track during swipe window
app.post('/api/parties/:id/tracks/suggest', (req, res) => {
  const { id } = req.params
  const { passId, title, artist, duration_sec } = req.body as {
    passId: string
    title: string
    artist: string
    duration_sec?: number
  }

  const pass = db.prepare('SELECT id FROM passes WHERE id = ? AND party_id = ?').get(passId, id)
  if (!pass) { res.status(400).json({ error: 'Invalid pass' }); return }

  const party = db.prepare("SELECT status FROM parties WHERE id = ?").get(id) as { status: string } | undefined
  if (party?.status !== 'swipe_open') {
    res.status(400).json({ error: 'Swipe window is not open' })
    return
  }

  const trackId = uuidv4()
  // Insert immediately with fallback energy so the UI updates right away
  db.prepare(
    'INSERT INTO tracks (id, party_id, title, artist, energy, bpm, duration_sec, added_by, swipe_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(trackId, id, title, artist, 5.5, null, duration_sec ?? null, 'attendee_suggestion', 0)

  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
  io.to(`party:${id}`).emit('track:added', { track })
  io.to(`creator:${id}`).emit('track:added', { track })
  res.json(track)

  // Async: look up real genre from iTunes to back-fill energy + BPM
  iTunesSearch(`${title} ${artist}`, 3).then((results) => {
    const match = results.find((r) =>
      r.trackName?.toLowerCase() === title.toLowerCase() ||
      r.artistName?.toLowerCase() === artist.toLowerCase()
    ) ?? results[0]
    if (!match) return
    db.prepare('UPDATE tracks SET energy = ?, bpm = ? WHERE id = ?').run(
      estimateEnergy(match.primaryGenreName, match.trackTimeMillis),
      estimateBPM(match.primaryGenreName),
      trackId
    )
  }).catch(() => {})
})

// GET /api/parties/:id/tracks
app.get('/api/parties/:id/tracks', (req, res) => {
  const tracks = db
    .prepare(
      'SELECT * FROM tracks WHERE party_id = ? ORDER BY COALESCE(queue_position, 9999), swipe_count DESC',
    )
    .all(req.params.id)
  res.json(tracks)
})

// POST /api/parties/:id/tracks
app.post('/api/parties/:id/tracks', (req, res) => {
  const { id } = req.params
  const token = req.headers["x-creator-token"] as string | undefined
  const deviceId = req.headers["x-device-id"] as string | undefined

  if (!requireCreatorToken(id, token, deviceId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { title, artist, bpm, musicalKey, energy, durationSec, audiomackUrl } = req.body as {
    title: string
    artist: string
    bpm?: number
    musicalKey?: string
    energy?: number
    durationSec?: number
    audiomackUrl?: string
  }

  if (!title || !artist) {
    res.status(400).json({ error: 'title and artist required' })
    return
  }

  const trackId = uuidv4()
  db.prepare(
    'INSERT INTO tracks (id, party_id, title, artist, bpm, musical_key, energy, duration_sec, audiomack_url, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    trackId, id, title, artist,
    bpm ?? null, musicalKey ?? null, energy ?? 5.0, durationSec ?? null,
    audiomackUrl ?? null, 'creator',
  )

  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
  res.json(track)

  // Async: if no stream URL provided, search iTunes for a 30-second preview
  if (!audiomackUrl) {
    fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(`${title} ${artist}`)}&media=music&entity=song&limit=5`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) },
    )
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        const d = data as { results?: Array<{ previewUrl?: string; trackName?: string; artistName?: string }> } | null
        if (!d?.results) return
        const match = d.results.find((r) => r.previewUrl)
        if (match?.previewUrl) {
          db.prepare('UPDATE tracks SET audiomack_url = ? WHERE id = ?').run(match.previewUrl, trackId)
        }
      })
      .catch(() => {})
  }
})

// DELETE /api/parties/:id/tracks/:trackId
app.delete('/api/parties/:id/tracks/:trackId', (req, res) => {
  const { id, trackId } = req.params
  const token = req.headers["x-creator-token"] as string | undefined
  const deviceId = req.headers["x-device-id"] as string | undefined

  if (!requireCreatorToken(id, token, deviceId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  db.prepare('DELETE FROM tracks WHERE id = ? AND party_id = ?').run(trackId, id)
  res.json({ success: true })
})

// POST /api/parties/:id/swipe
app.post('/api/parties/:id/swipe', (req, res) => {
  const { id } = req.params
  const { passId, trackId, direction } = req.body as {
    passId: string
    trackId: string
    direction: 'left' | 'right'
  }

  // Validate pass belongs to party
  const pass = db
    .prepare('SELECT * FROM passes WHERE id = ? AND party_id = ?')
    .get(passId, id)
  if (!pass) {
    res.status(400).json({ error: 'Invalid pass' })
    return
  }

  // Validate swipe window is open
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id) as
    | { status: string; swipe_ends_at: number }
    | undefined
  if (!party || party.status !== 'swipe_open') {
    res.status(400).json({ error: 'Swipe window is not open' })
    return
  }
  if (party.swipe_ends_at && Date.now() > party.swipe_ends_at) {
    res.status(400).json({ error: 'Swipe window has closed' })
    return
  }

  // Prevent duplicate swipes
  const existing = db
    .prepare('SELECT id FROM swipes WHERE pass_id = ? AND track_id = ?')
    .get(passId, trackId)
  if (existing) {
    res.status(400).json({ error: 'Already swiped on this track' })
    return
  }

  const swipeId = uuidv4()
  db.prepare(
    'INSERT INTO swipes (id, party_id, pass_id, track_id, direction) VALUES (?, ?, ?, ?, ?)',
  ).run(swipeId, id, passId, trackId, direction)

  if (direction === 'right') {
    db.prepare('UPDATE tracks SET swipe_count = swipe_count + 1 WHERE id = ?').run(trackId)
  }

  const track = db.prepare('SELECT swipe_count FROM tracks WHERE id = ?').get(trackId) as {
    swipe_count: number
  }
  const totalSwipes = (
    db
      .prepare("SELECT COUNT(*) as cnt FROM swipes WHERE party_id = ? AND direction = 'right'")
      .get(id) as { cnt: number }
  ).cnt

  io.to(`creator:${id}`).emit('swipe:update', {
    trackId,
    swipeCount: track.swipe_count,
    totalSwipes,
  })

  res.json({ success: true, swipeCount: track.swipe_count })

  // Every 5th right-swipe: pull in more tracks similar to what the crowd likes
  if (direction === 'right' && totalSwipes >= 5 && totalSwipes % 5 === 0) {
    void bambataReseed(id)
  }

  // Auto-close if every attendee has voted on every track
  const { totalPasses } = db.prepare('SELECT COUNT(*) as totalPasses FROM passes WHERE party_id = ?').get(id) as { totalPasses: number }
  const { totalTracks } = db.prepare('SELECT COUNT(*) as totalTracks FROM tracks WHERE party_id = ?').get(id) as { totalTracks: number }
  const { totalSwipeRows } = db.prepare('SELECT COUNT(DISTINCT pass_id || "|" || track_id) as totalSwipeRows FROM swipes WHERE party_id = ?').get(id) as { totalSwipeRows: number }

  if (totalPasses > 0 && totalTracks > 0 && totalSwipeRows >= totalPasses * totalTracks) {
    closeSwipeWindow(id)
  }
})

// GET /api/parties/:id/queue
app.get('/api/parties/:id/queue', (req, res) => {
  const tracks = db
    .prepare(
      'SELECT * FROM tracks WHERE party_id = ? AND queue_position IS NOT NULL ORDER BY queue_position ASC',
    )
    .all(req.params.id)
  res.json(tracks)
})

// GET /api/parties/:id/stats
app.get('/api/parties/:id/stats', (req, res) => {
  const { id } = req.params

  const party = db.prepare('SELECT status, swipe_ends_at FROM parties WHERE id = ?').get(id) as
    | { status: string; swipe_ends_at: number | null }
    | undefined
  if (!party) {
    res.status(404).json({ error: 'Party not found' })
    return
  }

  const totalSwipes = (
    db.prepare("SELECT COUNT(*) as cnt FROM swipes WHERE party_id = ?").get(id) as { cnt: number }
  ).cnt

  const uniqueSwipers = (
    db
      .prepare('SELECT COUNT(DISTINCT pass_id) as cnt FROM swipes WHERE party_id = ?')
      .get(id) as { cnt: number }
  ).cnt

  const topTracks = db
    .prepare(
      'SELECT id, title, artist, swipe_count FROM tracks WHERE party_id = ? ORDER BY swipe_count DESC LIMIT 5',
    )
    .all(id)

  const redeemedCodes = (
    db
      .prepare(
        "SELECT COUNT(*) as cnt FROM access_codes WHERE party_id = ? AND redeemed_by_pass_id IS NOT NULL AND type = 'pass'",
      )
      .get(id) as { cnt: number }
  ).cnt

  res.json({
    totalSwipes,
    uniqueSwipers,
    topTracks,
    status: party.status,
    swipeEndsAt: party.swipe_ends_at,
    redeemedCodes,
  })
})

// POST /api/parties/:id/tokens/redeem
app.post('/api/parties/:id/tokens/redeem', (req, res) => {
  const { id } = req.params
  const { passId, code } = req.body as { passId: string; code: string }

  const pass = db.prepare('SELECT * FROM passes WHERE id = ? AND party_id = ?').get(passId, id)
  if (!pass) {
    res.status(400).json({ error: 'Invalid pass' })
    return
  }

  const accessCode = db
    .prepare(
      "SELECT * FROM access_codes WHERE UPPER(code) = UPPER(?) AND party_id = ? AND type = 'tokens'",
    )
    .get(code, id) as
    | { id: string; token_amount: number; redeemed_by_pass_id: string | null }
    | undefined

  if (!accessCode) {
    res.status(400).json({ error: 'Invalid token code' })
    return
  }
  if (accessCode.redeemed_by_pass_id) {
    res.status(400).json({ error: 'Token code already used' })
    return
  }

  db.prepare('UPDATE access_codes SET redeemed_by_pass_id = ? WHERE id = ?').run(
    passId,
    accessCode.id,
  )

  const amount = accessCode.token_amount ?? 20
  db.prepare('UPDATE token_wallets SET balance = balance + ? WHERE pass_id = ?').run(amount, passId)

  const wallet = db.prepare('SELECT * FROM token_wallets WHERE pass_id = ?').get(passId) as {
    balance: number
  }
  res.json({ success: true, balance: wallet.balance })
})

// POST /api/parties/:id/requests
app.post('/api/parties/:id/requests', (req, res) => {
  const { id } = req.params
  const { passId, trackTitle, trackArtist, tokensSpent } = req.body as {
    passId: string
    trackTitle: string
    trackArtist: string
    tokensSpent: number
  }

  const wallet = db.prepare('SELECT * FROM token_wallets WHERE pass_id = ? AND party_id = ?').get(
    passId,
    id,
  ) as { id: string; balance: number } | undefined
  if (!wallet) {
    res.status(400).json({ error: 'No wallet found' })
    return
  }
  if (wallet.balance < tokensSpent) {
    res.status(400).json({ error: 'Insufficient tokens' })
    return
  }

  db.prepare('UPDATE token_wallets SET balance = balance - ? WHERE pass_id = ?').run(
    tokensSpent,
    passId,
  )

  const reqId = uuidv4()
  db.prepare(
    'INSERT INTO token_requests (id, party_id, pass_id, track_title, track_artist, tokens_spent) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(reqId, id, passId, trackTitle, trackArtist, tokensSpent)

  const request = db.prepare('SELECT * FROM token_requests WHERE id = ?').get(reqId)
  io.to(`party:${id}`).emit('request:new', { request })
  io.to(`creator:${id}`).emit('request:new', { request })

  res.json(request)
})

// POST /api/parties/:id/requests/:reqId/vote
app.post('/api/parties/:id/requests/:reqId/vote', (req, res) => {
  const { id, reqId } = req.params
  const { passId, tokenCount } = req.body as { passId: string; tokenCount: number }

  const wallet = db.prepare('SELECT * FROM token_wallets WHERE pass_id = ? AND party_id = ?').get(
    passId,
    id,
  ) as { balance: number } | undefined
  if (!wallet || wallet.balance < tokenCount) {
    res.status(400).json({ error: 'Insufficient tokens' })
    return
  }

  // Prevent double voting
  const existing = db
    .prepare('SELECT id FROM request_votes WHERE request_id = ? AND pass_id = ?')
    .get(reqId, passId)
  if (existing) {
    res.status(400).json({ error: 'Already voted' })
    return
  }

  db.prepare('UPDATE token_wallets SET balance = balance - ? WHERE pass_id = ?').run(
    tokenCount,
    passId,
  )

  db.prepare(
    'INSERT INTO request_votes (id, request_id, pass_id, tokens_spent) VALUES (?, ?, ?, ?)',
  ).run(uuidv4(), reqId, passId, tokenCount)

  db.prepare(
    'UPDATE token_requests SET vote_count = vote_count + ?, tokens_spent = tokens_spent + ? WHERE id = ?',
  ).run(tokenCount, tokenCount, reqId)

  const req2 = db.prepare('SELECT * FROM token_requests WHERE id = ?').get(reqId) as {
    vote_count: number
  }
  io.to(`party:${id}`).emit('request:voted', { requestId: reqId, voteCount: req2.vote_count })
  io.to(`creator:${id}`).emit('request:voted', { requestId: reqId, voteCount: req2.vote_count })

  res.json({ success: true })
})

// ─── Pass Routes ─────────────────────────────────────────────────────────────

app.get('/api/passes/:passId', (req, res) => {
  const pass = db.prepare('SELECT id, party_id, attendee_name, scanned_at FROM passes WHERE id = ?').get(
    req.params.passId,
  )
  if (!pass) {
    res.status(404).json({ error: 'Pass not found' })
    return
  }
  res.json(pass)
})

app.post('/api/passes/:passId/scan', (req, res) => {
  const { passId } = req.params
  const token = req.headers["x-creator-token"] as string | undefined
  const deviceId = req.headers["x-device-id"] as string | undefined

  const pass = db.prepare('SELECT * FROM passes WHERE id = ?').get(passId) as
    | { id: string; party_id: string; attendee_name: string; scanned_at: number | null }
    | undefined
  if (!pass) {
    res.status(404).json({ error: 'Pass not found' })
    return
  }

  if (!requireCreatorToken(pass.party_id, token, deviceId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  db.prepare('UPDATE passes SET scanned_at = ? WHERE id = ?').run(Date.now(), passId)

  const party = db.prepare('SELECT name FROM parties WHERE id = ?').get(pass.party_id) as {
    name: string
  }

  res.json({ ...pass, scanned_at: Date.now(), partyName: party.name })
})

// ─── iTunes helpers ───────────────────────────────────────────────────────────

interface iTunesTrack {
  trackName?: string
  artistName?: string
  collectionName?: string
  trackTimeMillis?: number
  artworkUrl100?: string
  primaryGenreName?: string
  previewUrl?: string
}

// Energy (0–10) per iTunes genre — feeds buildQueue's energy arc
const GENRE_ENERGY: Record<string, number> = {
  'Dance':               8.5,
  'Electronic':          8.0,
  'Dance & Electronic':  8.0,
  'Hip-Hop/Rap':         7.5,
  'Rap':                 7.5,
  'Pop':                 6.5,
  'Alternative':         6.0,
  'Rock':                7.0,
  'Reggae':              5.5,
  'Dancehall':           7.0,
  'Afrobeat':            7.5,
  'R&B/Soul':            5.5,
  'Soul':                5.0,
  'Gospel':              5.5,
  'Jazz':                4.5,
  'Classical':           3.0,
  'Singer/Songwriter':   4.0,
  'Country':             5.5,
  'Soundtrack':          5.0,
  'Music':               6.0,  // iTunes fallback genre
}

// BPM range [min, max] per genre — feeds buildQueue's BPM sort within each energy tier
const GENRE_BPM: Record<string, [number, number]> = {
  'Dance':               [124, 134],
  'Electronic':          [120, 140],
  'Dance & Electronic':  [122, 138],
  'Hip-Hop/Rap':         [80,  100],
  'Rap':                 [80,  100],
  'Pop':                 [95,  125],
  'Alternative':         [100, 130],
  'Rock':                [100, 145],
  'Reggae':              [65,   90],
  'Dancehall':           [80,  105],
  'Afrobeat':            [90,  118],
  'R&B/Soul':            [65,   95],
  'Soul':                [65,   90],
  'Jazz':                [70,  130],
  'Gospel':              [70,  100],
  'Country':             [80,  120],
  'Singer/Songwriter':   [70,  105],
}

function estimateEnergy(genre?: string, durationMs?: number): number {
  const base = genre ? (GENRE_ENERGY[genre] ?? 5.5) : 5.5
  // Small jitter so tracks in the same genre land at different energy levels
  const jitter = (Math.random() - 0.5) * 1.2
  // Club edits / intros (< 2:30) tend to be punchier
  const durationBoost = durationMs && durationMs < 150_000 ? 0.5 : 0
  return Math.round(Math.min(10, Math.max(1, base + jitter + durationBoost)) * 10) / 10
}

function estimateBPM(genre?: string): number | null {
  const range = genre ? GENRE_BPM[genre] : null
  if (!range) return null
  return Math.round(range[0] + Math.random() * (range[1] - range[0]))
}

// ─── Multi-query seed strategy per genre mode ─────────────────────────────────

const SEED_QUERIES: Record<string, string[]> = {
  'Hip-Hop': [
    'hip hop banger 2024',
    'rap hits party',
    'trap banger dancefloor',
    'drill rap 2024',
    'hip hop party anthem',
  ],
  'House': [
    'house music 2024',
    'tech house dj',
    'afro house dance 2024',
    'deep house electronic',
    'house music club',
  ],
  'Afrobeats': [
    'afrobeats 2024',
    'amapiano dance hits',
    'afropop party banger',
    'afroswing UK 2024',
    'naija afrobeats 2024',
  ],
  'R&B': [
    'rnb hits 2024',
    'neo soul vibes',
    'contemporary rnb banger',
    'smooth rnb party',
    'rnb slow jam',
  ],
  'Open Format': [
    'party anthem 2024',
    'club hit dancefloor 2024',
    'dance party summer 2024',
    'banger dancefloor',
    'radio hit 2024',
  ],
}

async function iTunesSearch(query: string, limit = 10): Promise<iTunesTrack[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return []
    const data = await res.json() as { results?: iTunesTrack[] }
    return (data.results ?? []).filter((r) => r.trackName && r.artistName)
  } catch { return [] }
}

// Insert one track with proper energy + BPM derived from iTunes metadata
const insertSeed = db.prepare(
  'INSERT INTO tracks (id, party_id, title, artist, energy, bpm, duration_sec, added_by, swipe_count, audiomack_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
)

function insertItunesTrack(partyId: string, r: iTunesTrack, addedBy = 'bambata_seed') {
  insertSeed.run(
    uuidv4(), partyId, r.trackName!, r.artistName!,
    estimateEnergy(r.primaryGenreName, r.trackTimeMillis),
    estimateBPM(r.primaryGenreName),
    r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
    addedBy, 0, r.previewUrl ?? null
  )
}

async function bambataSeed(partyId: string, genreMode: string) {
  const existing = db.prepare('SELECT LOWER(title) as t, artist FROM tracks WHERE party_id = ?')
    .all(partyId) as { t: string; artist: string }[]

  const TARGET = 14
  if (existing.length >= TARGET) return

  const existingTitles = new Set(existing.map((r) => r.t))
  // Unique artists already in the party — search for more songs by them first
  const existingArtists = [...new Set(existing.map((r) => r.artist).filter(Boolean))].slice(0, 4)
  const needed = TARGET - existing.length

  const candidateMap = new Map<string, iTunesTrack>()
  const addCandidates = (tracks: iTunesTrack[]) => {
    for (const t of tracks) {
      if (!t.trackName) continue
      const key = `${t.trackName.toLowerCase()}|||${(t.artistName ?? '').toLowerCase()}`
      if (!existingTitles.has(t.trackName.toLowerCase()) && !candidateMap.has(key)) {
        candidateMap.set(key, t)
      }
    }
  }

  // Strategy 1 — more songs by artists already in this party's library
  if (existingArtists.length > 0) {
    await Promise.all(existingArtists.map((a) => iTunesSearch(a, 8).then(addCandidates)))
  }

  // Strategy 2 — genre-curated queries (3 queries to stay well within rate limits)
  const genreQueries = (SEED_QUERIES[genreMode] ?? SEED_QUERIES['Open Format']).slice(0, 3)
  await Promise.all(genreQueries.map((q) => iTunesSearch(q, 10).then(addCandidates)))

  // Prefer tracks that have a playable preview URL, shuffle within each group
  const all = [...candidateMap.values()]
  const withPreview    = all.filter((r) =>  r.previewUrl).sort(() => Math.random() - 0.5)
  const withoutPreview = all.filter((r) => !r.previewUrl).sort(() => Math.random() - 0.5)
  const toAdd = [...withPreview, ...withoutPreview].slice(0, needed)

  for (const r of toAdd) insertItunesTrack(partyId, r)

  const tracks = db.prepare('SELECT * FROM tracks WHERE party_id = ?').all(partyId)
  io.to(`party:${partyId}`).emit('tracks:seeded', { tracks })
  io.to(`creator:${partyId}`).emit('tracks:seeded', { tracks })
}

// Re-seed with more tracks similar to what the crowd is swiping right on.
// Called after a right-swipe when the crowd's taste becomes clearer.
async function bambataReseed(partyId: string) {
  const currentCount = (db.prepare('SELECT COUNT(*) as cnt FROM tracks WHERE party_id = ?')
    .get(partyId) as { cnt: number }).cnt
  if (currentCount >= 20) return  // cap total tracks

  // Top right-swiped artists are our strongest signal
  const topArtists = db.prepare(
    `SELECT artist, SUM(swipe_count) as score
     FROM tracks WHERE party_id = ? AND swipe_count > 0
     GROUP BY LOWER(artist) ORDER BY score DESC LIMIT 3`
  ).all(partyId) as { artist: string; score: number }[]

  if (topArtists.length === 0) return

  const existingTitles = new Set(
    (db.prepare('SELECT LOWER(title) as t FROM tracks WHERE party_id = ?')
      .all(partyId) as { t: string }[]).map((r) => r.t)
  )

  const candidateMap = new Map<string, iTunesTrack>()
  const addCandidates = (tracks: iTunesTrack[]) => {
    for (const t of tracks) {
      if (!t.trackName) continue
      const key = `${t.trackName.toLowerCase()}|||${(t.artistName ?? '').toLowerCase()}`
      if (!existingTitles.has(t.trackName.toLowerCase()) && !candidateMap.has(key)) {
        candidateMap.set(key, t)
      }
    }
  }

  await Promise.all(topArtists.map((a) => iTunesSearch(a.artist, 8).then(addCandidates)))

  const needed = 20 - currentCount
  const toAdd = [...candidateMap.values()]
    .filter((r) => r.previewUrl)
    .sort(() => Math.random() - 0.5)
    .slice(0, needed)

  for (const r of toAdd) insertItunesTrack(partyId, r, 'bambata_reseed')

  if (toAdd.length > 0) {
    const tracks = db.prepare('SELECT * FROM tracks WHERE party_id = ?').all(partyId)
    io.to(`party:${partyId}`).emit('tracks:seeded', { tracks })
    io.to(`creator:${partyId}`).emit('tracks:seeded', { tracks })
  }
}

// ─── Auto-fill: brain requests more tracks when queue runs low ────────────────

app.post('/api/parties/:partyId/autofill', async (req, res) => {
  const { partyId } = req.params
  const party = db.prepare('SELECT genre_mode FROM parties WHERE id = ?').get(partyId) as
    | { genre_mode: string } | undefined
  if (!party) { res.status(404).json({ error: 'Party not found' }); return }

  const { currentArtist, currentEnergy } = req.body as {
    currentArtist?: string
    currentEnergy?: number
  }

  const existingTitles = new Set(
    (db.prepare('SELECT LOWER(title) as t FROM tracks WHERE party_id = ?')
      .all(partyId) as { t: string }[]).map((r) => r.t)
  )

  // Build query list: current artist + energy-matched genre queries
  const genrePool = SEED_QUERIES[party.genre_mode] ?? SEED_QUERIES['Open Format']
  const energyTier = (currentEnergy ?? 6) >= 7 ? 'high energy dancefloor'
    : (currentEnergy ?? 6) >= 5 ? 'dance club'
    : 'vibes chill'
  const queries: string[] = []
  if (currentArtist) queries.push(currentArtist)
  queries.push(`${energyTier} ${genrePool[Math.floor(Math.random() * genrePool.length)]}`)
  queries.push(genrePool[Math.floor(Math.random() * genrePool.length)])

  const candidateMap = new Map<string, iTunesTrack>()
  await Promise.all(queries.map(async (q) => {
    const tracks = await iTunesSearch(q, 10)
    for (const t of tracks) {
      if (!t.trackName || !t.previewUrl) continue
      const key = `${t.trackName.toLowerCase()}|||${(t.artistName ?? '').toLowerCase()}`
      if (!existingTitles.has(t.trackName.toLowerCase()) && !candidateMap.has(key)) {
        candidateMap.set(key, t)
      }
    }
  }))

  const toAdd = [...candidateMap.values()]
    .sort(() => Math.random() - 0.5)
    .slice(0, 8)

  const added: Array<{
    id: string; title: string; artist: string; bpm: number | null
    energy: number; duration_sec: number | null; audiomack_url: string | null; queue_position: null
  }> = []

  for (const r of toAdd) {
    const trackId = uuidv4()
    const energy = estimateEnergy(r.primaryGenreName, r.trackTimeMillis)
    const bpm = estimateBPM(r.primaryGenreName)
    const durationSec = r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null
    insertSeed.run(trackId, partyId, r.trackName!, r.artistName!, energy, bpm, durationSec, 'bambata_autofill', 0, r.previewUrl)
    added.push({ id: trackId, title: r.trackName!, artist: r.artistName ?? '', bpm, energy, duration_sec: durationSec, audiomack_url: r.previewUrl ?? null, queue_position: null })
  }

  if (added.length > 0) {
    io.to(`party:${partyId}`).emit('tracks:seeded', { tracks: db.prepare('SELECT * FROM tracks WHERE party_id = ?').all(partyId) })
  }

  res.json({ added })
})

app.get('/api/search/tracks', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim()
  if (!q || q.length < 1) { res.json([]); return }

  try {
    const apiRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=12`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
    )
    if (!apiRes.ok) { res.json([]); return }

    const data = await apiRes.json() as { results?: iTunesTrack[] }
    const results = (data.results ?? [])
      .filter((r) => r.trackName)
      .map((r) => ({
        title: r.trackName!,
        artist: r.artistName ?? '',
        album: r.collectionName ?? '',
        duration_sec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
        artwork_url: r.artworkUrl100 ?? null,
        genre: r.primaryGenreName ?? '',
        preview_url: r.previewUrl ?? null,
      }))

    res.json(results)
  } catch {
    res.json([])
  }
})

// ─── Places Autocomplete (Photon/OSM — no API key required) ──────────────────

interface PhotonFeature {
  properties: {
    name?: string
    street?: string
    housenumber?: string
    city?: string
    county?: string
    state?: string
    country?: string
    postcode?: string
    type?: string
    osm_type?: string
  }
}

app.get('/api/places/search', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim()
  if (!q || q.length < 2) { res.json([]); return }

  try {
    const apiRes = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`,
      { headers: { 'User-Agent': 'Bambata/1.0' }, signal: AbortSignal.timeout(5000) }
    )
    if (!apiRes.ok) { res.json([]); return }

    const data = await apiRes.json() as { features?: PhotonFeature[] }
    const results = (data.features ?? []).map((f) => {
      const p = f.properties
      const parts: string[] = []
      if (p.name) parts.push(p.name)
      if (p.street) parts.push(p.housenumber ? `${p.housenumber} ${p.street}` : p.street)
      if (p.city) parts.push(p.city)
      if (p.state && p.state !== p.city) parts.push(p.state)
      if (p.country) parts.push(p.country)
      return {
        name: p.name ?? parts[0] ?? q,
        address: parts.slice(p.name ? 1 : 0).join(', '),
        full: parts.join(', '),
      }
    }).filter((r, i, arr) => arr.findIndex((x) => x.full === r.full) === i)  // dedupe

    res.json(results)
  } catch {
    res.json([])
  }
})

// ─── Stream Proxy ─────────────────────────────────────────────────────────────

app.get('/api/stream/:trackId', async (req, res) => {
  const track = db.prepare('SELECT party_id, audiomack_url, title, artist FROM tracks WHERE id = ?').get(req.params.trackId) as
    | { party_id: string; audiomack_url: string | null; title: string; artist: string }
    | undefined

  if (!track) {
    res.status(404).json({ error: 'Track not found' })
    return
  }

  // Check cache (30 min TTL)
  const cached = streamCache.get(req.params.trackId)
  let streamUrl: string | null = null

  if (cached && Date.now() - cached.cachedAt < 30 * 60_000) {
    streamUrl = cached.url
  } else {
    // Pass null URL when none configured — resolveStreamUrl will search Audiomack by title+artist
    streamUrl = await resolveStreamUrl(track.audiomack_url, track.title, track.artist)
    if (streamUrl) {
      streamCache.set(req.params.trackId, { url: streamUrl, cachedAt: Date.now() })
    }
  }

  if (!streamUrl) {
    logMissingTrack(track.party_id, {
      trackId: req.params.trackId,
      title: track.title,
      artist: track.artist,
      reason: track.audiomack_url ? 'stream unavailable' : 'no url — search found nothing',
      at: Date.now(),
    })
    res.status(502).json({ error: 'Could not resolve audio stream' })
    return
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': '*/*',
  }
  if (req.headers.range) upstreamHeaders['Range'] = req.headers.range

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(streamUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    res.status(502).json({ error: 'Failed to fetch audio stream' })
    return
  }

  res.status(upstreamRes.status)
  res.setHeader('Content-Type', upstreamRes.headers.get('Content-Type') ?? 'audio/mpeg')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const contentLength = upstreamRes.headers.get('Content-Length')
  if (contentLength) res.setHeader('Content-Length', contentLength)

  const contentRange = upstreamRes.headers.get('Content-Range')
  if (contentRange) res.setHeader('Content-Range', contentRange)

  if (!upstreamRes.body) { res.end(); return }

  const readable = Readable.fromWeb(upstreamRes.body as Parameters<typeof Readable.fromWeb>[0])

  // Clean up upstream stream when client disconnects (browser range-request cancel/retry is normal)
  const cleanup = () => { try { readable.destroy() } catch {} }
  req.on('close', cleanup)
  res.on('close', cleanup)

  readable.on('error', () => {
    if (!res.headersSent) res.status(502).end()
    else res.end()
  })

  readable.pipe(res)
})

// ─── Now-playing state (in-memory, per party) ────────────────────────────────
// Lets attendees get initial state when joining mid-set

interface NowPlayingState { current: unknown; next: unknown }
const nowPlaying = new Map<string, NowPlayingState>()

// Tastemaker leaderboard
// Score = (reactions on your accepted requests × 2) + (reactions on tracks you loved that crowd also loved × 1)
app.get('/api/parties/:id/leaderboard', (req, res) => {
  const pid = req.params.id
  const scores = db.prepare(`
    SELECT name, SUM(points) AS score, SUM(requests) AS requests FROM (

      -- 2 pts per crowd reaction on a track YOU requested and got accepted
      SELECT p.attendee_name AS name, COUNT(*) * 2 AS points, 1 AS requests
      FROM token_requests tr
      JOIN passes p ON p.id = tr.pass_id
      JOIN track_reactions r ON r.track_id = tr.track_id
      WHERE tr.party_id = ? AND tr.status = 'accepted' AND tr.track_id IS NOT NULL
      GROUP BY tr.pass_id

      UNION ALL

      -- 1 pt per reaction on tracks you loved that the crowd also loved (≥ 3 reactions)
      SELECT r.attendee_name AS name, COUNT(*) AS points, 0 AS requests
      FROM track_reactions r
      WHERE r.party_id = ? AND r.pass_id IS NOT NULL
        AND r.track_id IN (
          SELECT track_id FROM track_reactions WHERE party_id = ?
          GROUP BY track_id HAVING COUNT(*) >= 3
        )
      GROUP BY r.pass_id

    )
    GROUP BY name
    ORDER BY score DESC
    LIMIT 10
  `).all(pid, pid, pid) as { name: string; score: number; requests: number }[]
  res.json(scores)
})

// Token wallet balance for an attendee
app.get('/api/parties/:id/wallet/:passId', (req, res) => {
  const wallet = db.prepare('SELECT balance FROM token_wallets WHERE pass_id = ? AND party_id = ?')
    .get(req.params.passId, req.params.id) as { balance: number } | undefined
  res.json({ balance: wallet?.balance ?? 0 })
})

// iTunes track search (for attendee request-during-mix)
app.get('/api/parties/:id/search', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim()
  if (!q) { res.json([]); return }
  try {
    const results = await iTunesSearch(q, 8)
    res.json(results.map(r => ({ title: r.trackName ?? '', artist: r.artistName ?? '', previewUrl: r.previewUrl ?? '' })))
  } catch { res.json([]) }
})

// Live reaction count for a track
app.get('/api/parties/:id/reactions/:trackId', (req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM track_reactions WHERE track_id = ?')
    .get(req.params.trackId) as { count: number }
  res.json({ count })
})

app.get('/api/parties/:id/now', (req, res) => {
  const state = nowPlaying.get(req.params.id) ?? { current: null, next: null }
  const meta = db.prepare('SELECT started_at, duration_min FROM parties WHERE id = ?').get(req.params.id) as
    | { started_at: number | null; duration_min: number } | undefined
  res.json({ ...state, startedAt: meta?.started_at ?? null, durationMin: meta?.duration_min ?? 120 })
})

app.get('/api/parties/:id/missing', (req, res) => {
  res.json(missingTracksLog.get(req.params.id) ?? [])
})

// GET /api/parties/:id/requests — list all requests sorted by votes desc
app.get('/api/parties/:id/requests', (req, res) => {
  const requests = db
    .prepare('SELECT * FROM token_requests WHERE party_id = ? ORDER BY vote_count DESC, created_at ASC')
    .all(req.params.id)
  res.json(requests)
})

// GET /api/parties/:id/attendees — list passes with swipe completion status (public, for cast screen)
app.get('/api/parties/:id/attendees', (req, res) => {
  const { id } = req.params
  const { totalTracks } = db
    .prepare('SELECT COUNT(*) as totalTracks FROM tracks WHERE party_id = ?')
    .get(id) as { totalTracks: number }
  const rows = db
    .prepare(
      `SELECT p.id, p.attendee_name, p.created_at as joined_at,
        COUNT(s.id) as swipes_done
       FROM passes p
       LEFT JOIN swipes s ON s.pass_id = p.id AND s.party_id = p.party_id
       WHERE p.party_id = ?
       GROUP BY p.id
       ORDER BY p.created_at ASC`,
    )
    .all(id) as Array<{ id: string; attendee_name: string; joined_at: number; swipes_done: number }>

  const attendees = rows.map((a) => ({
    ...a,
    total_tracks: totalTracks,
    done: totalTracks > 0 && a.swipes_done >= totalTracks,
  }))

  res.json({
    attendees,
    total: attendees.length,
    done_count: attendees.filter((a) => a.done).length,
  })
})

// POST /api/parties/:id/requests/:reqId/accept — accept request, add track to queue
app.post('/api/parties/:id/requests/:reqId/accept', (req, res) => {
  const { id, reqId } = req.params
  const token = req.headers["x-creator-token"] as string | undefined
  const deviceId = req.headers["x-device-id"] as string | undefined
  if (!requireCreatorToken(id, token, deviceId)) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const request = db.prepare('SELECT * FROM token_requests WHERE id = ? AND party_id = ?').get(reqId, id) as
    | { id: string; track_title: string; track_artist: string; status: string }
    | undefined
  if (!request) {
    res.status(404).json({ error: 'Request not found' })
    return
  }
  if (request.status !== 'pending') {
    res.status(400).json({ error: 'Request already handled' })
    return
  }

  // Find the current max queue position
  const maxPos = (db.prepare('SELECT MAX(queue_position) as m FROM tracks WHERE party_id = ?').get(id) as { m: number | null }).m ?? 0
  const newPos = maxPos + 1

  const trackId = uuidv4()
  db.prepare(
    'INSERT INTO tracks (id, party_id, title, artist, energy, added_by, queue_position, swipe_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(trackId, id, request.track_title, request.track_artist, 5, 'token_request', newPos, 0)

  db.prepare("UPDATE token_requests SET status = 'accepted', track_id = ? WHERE id = ?").run(trackId, reqId)

  const newTrack = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
  io.to(`party:${id}`).emit('queue:updated', { track: newTrack })
  io.to(`creator:${id}`).emit('queue:updated', { track: newTrack })

  res.json({ success: true, track: newTrack })
})

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.on('join:party', (partyId: string) => {
    socket.join(`party:${partyId}`)
  })

  socket.on('join:creator', ({ partyId, creatorToken, deviceId: dId }: { partyId: string; creatorToken: string; deviceId?: string }) => {
    if (requireCreatorToken(partyId, creatorToken, dId)) {
      socket.join(`creator:${partyId}`)
      socket.join(`party:${partyId}`)
    }
  })

  // Player → store + broadcast current track to all attendees
  socket.on('player:track', (data: { partyId: string; current: unknown; next: unknown }) => {
    nowPlaying.set(data.partyId, { current: data.current, next: data.next })
    io.to(`party:${data.partyId}`).emit('player:track', { current: data.current, next: data.next })
  })

  // Player → broadcast play/pause state
  socket.on('player:state', (data: { partyId: string; playing: boolean }) => {
    io.to(`party:${data.partyId}`).emit('player:state', { playing: data.playing })
  })

  // Player → record when the mix actually started (once per party session)
  socket.on('player:started', (data: { partyId: string; startedAt: number }) => {
    db.prepare('UPDATE parties SET started_at = ? WHERE id = ? AND started_at IS NULL')
      .run(data.startedAt, data.partyId)
    io.to(`party:${data.partyId}`).emit('player:started', { startedAt: data.startedAt })
  })

  // Attendee taps the reaction button while a track is playing
  socket.on('track:react', (data: { partyId: string; trackId: string; passId?: string; attendeeName?: string }) => {
    db.prepare('INSERT INTO track_reactions (id, party_id, track_id, pass_id, attendee_name) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), data.partyId, data.trackId, data.passId ?? null, data.attendeeName ?? null)
    const { count } = db.prepare('SELECT COUNT(*) as count FROM track_reactions WHERE track_id = ?')
      .get(data.trackId) as { count: number }
    io.to(`party:${data.partyId}`).emit('track:reacted', { trackId: data.trackId, count })
  })

  // Player → broadcast skipped track
  socket.on('player:skip', (data: { partyId: string; trackId: string; reason: string }) => {
    io.to(`creator:${data.partyId}`).emit('player:skip', { trackId: data.trackId, reason: data.reason })
  })
})

// ─── Account routes ──────────────────────────────────────────────────────────

// POST /api/account — create account if not exists, return it
app.post('/api/account', (req, res) => {
  const { deviceId } = req.body as { deviceId: string }
  if (!deviceId) { res.status(400).json({ error: 'deviceId required' }); return }
  let account = db.prepare('SELECT * FROM device_accounts WHERE id = ?').get(deviceId)
  if (!account) {
    db.prepare('INSERT INTO device_accounts (id) VALUES (?)').run(deviceId)
    account = db.prepare('SELECT * FROM device_accounts WHERE id = ?').get(deviceId)
  }
  res.json(account)
})

// GET /api/account/:deviceId — fetch account + pass/party history
app.get('/api/account/:deviceId', (req, res) => {
  const { deviceId } = req.params
  const account = db.prepare('SELECT * FROM device_accounts WHERE id = ?').get(deviceId)
  if (!account) { res.status(404).json({ error: 'Not found' }); return }
  const passes = db.prepare(
    `SELECT p.id, p.party_id, p.attendee_name, p.created_at, pa.name AS party_name, pa.date, pa.venue
     FROM passes p JOIN parties pa ON p.party_id = pa.id
     WHERE p.device_id = ? ORDER BY p.created_at DESC`
  ).all(deviceId)
  const parties = db.prepare(
    'SELECT id, name, date, venue, status, duration_min FROM parties WHERE device_id = ? ORDER BY created_at DESC'
  ).all(deviceId)
  res.json({ ...account as object, passes, parties })
})

// PATCH /api/account/:deviceId — update name
app.patch('/api/account/:deviceId', (req, res) => {
  const { deviceId } = req.params
  const { name } = req.body as { name: string }
  db.prepare('UPDATE device_accounts SET name = ? WHERE id = ?').run(name?.trim() ?? null, deviceId)
  const account = db.prepare('SELECT * FROM device_accounts WHERE id = ?').get(deviceId)
  res.json(account)
})

// POST /api/account/:deviceId/otp — generate OTP for email verification
app.post('/api/account/:deviceId/otp', (req, res) => {
  const { deviceId } = req.params
  const { email } = req.body as { email: string }
  if (!email?.includes('@')) { res.status(400).json({ error: 'Valid email required' }); return }

  // Upsert account
  const exists = db.prepare('SELECT id FROM device_accounts WHERE id = ?').get(deviceId)
  if (!exists) db.prepare('INSERT INTO device_accounts (id) VALUES (?)').run(deviceId)

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = Date.now() + 10 * 60 * 1000

  db.prepare('UPDATE otp_codes SET used = 1 WHERE device_id = ? AND used = 0').run(deviceId)
  db.prepare('INSERT INTO otp_codes (id, device_id, code, expires_at) VALUES (?, ?, ?, ?)').run(
    uuidv4(), deviceId, code, expiresAt
  )
  db.prepare('UPDATE device_accounts SET email = ?, email_verified = 0 WHERE id = ?').run(email.trim(), deviceId)

  // TODO: plug nodemailer / Resend here — for now code is returned in response
  console.log(`[Bambata OTP] ${email} → ${code}`)
  res.json({ sent: true, devCode: code })
})

// POST /api/account/:deviceId/verify — verify OTP, mark email confirmed
app.post('/api/account/:deviceId/verify', (req, res) => {
  const { deviceId } = req.params
  const { code } = req.body as { code: string }

  const otp = db.prepare(
    'SELECT id FROM otp_codes WHERE device_id = ? AND code = ? AND used = 0 AND expires_at > ?'
  ).get(deviceId, code?.trim(), Date.now()) as { id: string } | undefined

  if (!otp) { res.status(400).json({ error: 'Invalid or expired code' }); return }

  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otp.id)
  db.prepare('UPDATE device_accounts SET email_verified = 1 WHERE id = ?').run(deviceId)

  const account = db.prepare('SELECT * FROM device_accounts WHERE id = ?').get(deviceId)
  res.json(account)
})

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ─── Serve React app in production ───────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '..', 'dist')
  app.use(express.static(distDir))
  // All non-API routes return the React shell — React Router handles the rest
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// ─── Start server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001
httpServer.listen(PORT, () => {
  console.log(`Bambata server running on http://localhost:${PORT}`)
})
