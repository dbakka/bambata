# Bambata

A collective DJ platform where the crowd votes on what gets played next. The creator curates starter tracks, attendees swipe to build the queue, and Bambata's AI brain mixes the set in real time.

---

## How it works

1. **Creator** creates a party, adds seed tracks, and generates pass codes.
2. **Attendees** scan/enter a code at the door to get their digital pass.
3. During the **swipe window** (5 min), attendees swipe right (yes) or left (no) on tracks.
4. The creator hits **Start Mix** — Bambata builds a ranked queue and DJ-mixes it live.
5. Attendees rate each track with **1–5 stars** on the Now Playing screen.
6. Bambata **reseeds** the queue based on what the crowd is loving.
7. Attendees with tokens can **request tracks** or boost other requests.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express, Socket.IO |
| Database | SQLite (better-sqlite3, WAL mode) |
| AI mixing | Web Audio API + custom mixing engine |
| Music search | iTunes Search API |
| Email | Resend (hello@dbakka.com) |

---

## Local development

### Prerequisites
- Node.js 22+
- A Gmail account with 2FA enabled (for OTP email)

### Setup

```bash
git clone <repo>
cd bambata
npm install
```

Create a `.env` file:

```env
RESEND_API_KEY=re_your_api_key_here
```

> Get an API key at [resend.com](https://resend.com). Add `dbakka.com` as a sending domain (just one DNS TXT record) and emails will go out from `hello@dbakka.com`.

### Run

```bash
npm run dev
```

Opens:
- Frontend: `http://localhost:5173`
- Backend API + Socket.IO: `http://localhost:3001`

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | For email | API key from resend.com |
| `NODE_ENV` | Auto | Set to `production` by Railway |

> In dev mode without `RESEND_API_KEY`, OTP codes are returned in the API response and shown in the UI as `(dev: XXXXXX)`.

---

## Deploy (Railway)

1. Connect your GitHub repo to Railway.
2. Add environment variables in Railway's settings panel.
3. Build command: `npm run build`
4. Start command: `npm start`

> **Note:** Railway's ephemeral filesystem resets the SQLite database on each deploy. Party data is stored per-session. A persistent volume or hosted DB (Turso, PlanetScale) is planned for production.

---

## Creator flow

```
/create              → set party name, venue, date, genre, duration
/creator/:partyId    → dashboard (setup tracks, generate codes, open swipe window)
/player/:partyId     → live mixing player with countdown
/door/:partyId       → QR code scanner for door staff
```

## Attendee flow

```
/party/:partyId          → landing (enter pass code)
/party/:partyId/swipe    → swipe tracks right/left
/party/:partyId/lobby    → waiting for mix to start
/party/:partyId/now      → now playing + 5-star rating
/party/:partyId/ended    → party ended + host your own CTA
/party/:partyId/leaderboard → crowd engagement scores
```

---

## Key features

- **Bambata Seed** — pulls tracks from iTunes matching the creator's chosen artists and genre, ensuring suggestions are stylistically close to the starter tracks.
- **Bambata Reseed** — after swipes, re-pulls tracks matching the crowd's top right-swiped artists.
- **Token economy** — attendees can redeem token codes to request songs or boost votes.
- **Extension codes** — creator can generate time-extension codes; attendees enter them to add minutes to the party.
- **Cast screen** — full-screen display for TV/projector showing QR code, live feed, and now playing.
- **Leaderboard** — ranks attendees by engagement (swipes, requests, crowd-validated picks).
