import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'bambata.db')

const db = new Database(DB_PATH)

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Run migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    venue TEXT NOT NULL,
    genre_mode TEXT NOT NULL DEFAULT 'Open Format',
    duration_min INTEGER NOT NULL DEFAULT 120,
    status TEXT NOT NULL DEFAULT 'pending',
    creator_token TEXT NOT NULL,
    swipe_ends_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS access_codes (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    token_amount INTEGER,
    redeemed_by_pass_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (party_id) REFERENCES parties(id)
  );

  CREATE TABLE IF NOT EXISTS passes (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL,
    attendee_name TEXT NOT NULL,
    attendee_contact TEXT NOT NULL,
    qr_data TEXT NOT NULL,
    access_code_id TEXT,
    scanned_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (party_id) REFERENCES parties(id)
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    bpm REAL,
    musical_key TEXT,
    energy REAL DEFAULT 5.0,
    duration_sec INTEGER,
    file_path TEXT,
    swipe_count INTEGER NOT NULL DEFAULT 0,
    added_by TEXT NOT NULL DEFAULT 'creator',
    queue_position INTEGER,
    played_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (party_id) REFERENCES parties(id)
  );

  CREATE TABLE IF NOT EXISTS swipes (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL,
    pass_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (pass_id) REFERENCES passes(id),
    FOREIGN KEY (track_id) REFERENCES tracks(id),
    UNIQUE(pass_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS token_wallets (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL,
    pass_id TEXT NOT NULL UNIQUE,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (pass_id) REFERENCES passes(id)
  );

  CREATE TABLE IF NOT EXISTS token_requests (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL,
    pass_id TEXT NOT NULL,
    track_title TEXT NOT NULL,
    track_artist TEXT NOT NULL,
    tokens_spent INTEGER NOT NULL DEFAULT 0,
    vote_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (pass_id) REFERENCES passes(id)
  );

  CREATE TABLE IF NOT EXISTS request_votes (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    pass_id TEXT NOT NULL,
    tokens_spent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (request_id) REFERENCES token_requests(id),
    FOREIGN KEY (pass_id) REFERENCES passes(id),
    UNIQUE(request_id, pass_id)
  );
`)

// Account tables
db.exec(`
  CREATE TABLE IF NOT EXISTS device_accounts (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    email_verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0
  );
`)

// Migrations for new columns (safe to re-run)
try { db.exec(`ALTER TABLE tracks ADD COLUMN audiomack_url TEXT`) } catch {}
try { db.exec(`ALTER TABLE parties ADD COLUMN started_at INTEGER`) } catch {}
try { db.exec(`ALTER TABLE passes ADD COLUMN device_id TEXT`) } catch {}
try { db.exec(`ALTER TABLE parties ADD COLUMN device_id TEXT`) } catch {}

// Engagement: track reactions from attendees
db.exec(`
  CREATE TABLE IF NOT EXISTS track_reactions (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    pass_id TEXT,
    attendee_name TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_party_track ON track_reactions(party_id, track_id);
`)

export default db
