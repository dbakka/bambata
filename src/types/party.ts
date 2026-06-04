export interface Party {
  id: string
  name: string
  date: string
  venue: string
  genre_mode: string
  duration_min: number
  status: 'pending' | 'swipe_open' | 'mixing' | 'done'
  creator_token?: string
  swipe_ends_at: number | null
  started_at: number | null
  created_at: number
}

export interface AccessCode {
  id: string
  party_id: string
  code: string
  type: 'pass' | 'tokens'
  token_amount: number | null
  redeemed_by_pass_id: string | null
  created_at: number
}

export interface Pass {
  id: string
  party_id: string
  attendee_name: string
  attendee_contact: string
  qr_data: string
  access_code_id: string | null
  scanned_at: number | null
  created_at: number
  // Synthetic field returned from redeem endpoint
  qrData?: string
}

export interface Track {
  id: string
  party_id: string
  title: string
  artist: string
  bpm: number | null
  musical_key: string | null
  energy: number
  duration_sec: number | null
  file_path: string | null
  audiomack_url: string | null
  swipe_count: number
  added_by: 'creator' | 'token_request' | 'bambata_seed' | 'attendee_suggestion'
  queue_position: number | null
  played_at: number | null
  created_at: number
}

export interface Swipe {
  id: string
  party_id: string
  pass_id: string
  track_id: string
  direction: 'left' | 'right'
  created_at: number
}

export interface TokenWallet {
  id: string
  party_id: string
  pass_id: string
  balance: number
  created_at: number
}

export interface TokenRequest {
  id: string
  party_id: string
  pass_id: string
  track_title: string
  track_artist: string
  tokens_spent: number
  vote_count: number
  status: 'pending' | 'accepted' | 'rejected' | 'played'
  created_at: number
}

export interface SwipeWindowState {
  isOpen: boolean
  endsAt: number | null
}

export interface PartyStats {
  totalSwipes: number
  uniqueSwipers: number
  topTracks: Pick<Track, 'id' | 'title' | 'artist' | 'swipe_count'>[]
  status: Party['status']
  swipeEndsAt: number | null
  redeemedCodes: number
}
