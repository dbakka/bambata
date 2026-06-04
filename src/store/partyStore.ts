import { create } from 'zustand'
import type { Party, Track, PartyStats, Pass } from '../types/party'

interface PartyState {
  currentParty: Party | null
  tracks: Track[]
  queue: Track[]
  stats: PartyStats | null
  swipeWindowOpen: boolean
  swipeEndsAt: number | null
  creatorToken: string | null
  myPass: Pass | null

  // Actions
  setCurrentParty: (party: Party) => void
  setTracks: (tracks: Track[]) => void
  setQueue: (queue: Track[]) => void
  setStats: (stats: PartyStats) => void
  setSwipeWindow: (open: boolean, endsAt?: number | null) => void
  setCreatorToken: (token: string) => void
  setMyPass: (pass: Pass) => void
  updateTrackSwipeCount: (trackId: string, swipeCount: number) => void

  fetchParty: (partyId: string, creatorToken?: string) => Promise<Party>
  fetchTracks: (partyId: string) => Promise<Track[]>
  fetchQueue: (partyId: string) => Promise<Track[]>
  fetchStats: (partyId: string) => Promise<PartyStats>
  submitSwipe: (
    partyId: string,
    passId: string,
    trackId: string,
    direction: 'left' | 'right',
  ) => Promise<void>
  redeemCode: (
    partyId: string,
    code: string,
    attendeeName: string,
    attendeeContact: string,
  ) => Promise<Pass>
}

export const usePartyStore = create<PartyState>((set, get) => ({
  currentParty: null,
  tracks: [],
  queue: [],
  stats: null,
  swipeWindowOpen: false,
  swipeEndsAt: null,
  creatorToken: null,
  myPass: null,

  setCurrentParty: (party) => set({ currentParty: party }),
  setTracks: (tracks) => set({ tracks }),
  setQueue: (queue) => set({ queue }),
  setStats: (stats) => set({ stats }),
  setSwipeWindow: (open, endsAt) =>
    set({ swipeWindowOpen: open, swipeEndsAt: endsAt ?? null }),
  setCreatorToken: (token) => set({ creatorToken: token }),
  setMyPass: (pass) => set({ myPass: pass }),
  updateTrackSwipeCount: (trackId, swipeCount) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, swipe_count: swipeCount } : t)),
    })),

  fetchParty: async (partyId, creatorToken) => {
    const headers: Record<string, string> = {}
    if (creatorToken) headers['x-creator-token'] = creatorToken
    const res = await fetch(`/api/parties/${partyId}`, { headers })
    if (!res.ok) throw new Error('Party not found')
    const party = (await res.json()) as Party
    set({ currentParty: party })
    return party
  },

  fetchTracks: async (partyId) => {
    const res = await fetch(`/api/parties/${partyId}/tracks`)
    if (!res.ok) throw new Error('Failed to fetch tracks')
    const tracks = (await res.json()) as Track[]
    set({ tracks })
    return tracks
  },

  fetchQueue: async (partyId) => {
    const res = await fetch(`/api/parties/${partyId}/queue`)
    if (!res.ok) throw new Error('Failed to fetch queue')
    const queue = (await res.json()) as Track[]
    set({ queue })
    return queue
  },

  fetchStats: async (partyId) => {
    const res = await fetch(`/api/parties/${partyId}/stats`)
    if (!res.ok) throw new Error('Failed to fetch stats')
    const stats = (await res.json()) as PartyStats
    set({ stats })
    return stats
  },

  submitSwipe: async (partyId, passId, trackId, direction) => {
    const res = await fetch(`/api/parties/${partyId}/swipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passId, trackId, direction }),
    })
    if (!res.ok) {
      const err = (await res.json()) as { error: string }
      throw new Error(err.error)
    }
    // Update local state optimistically
    const { tracks } = get()
    set({
      tracks: tracks.map((t) =>
        t.id === trackId && direction === 'right'
          ? { ...t, swipe_count: t.swipe_count + 1 }
          : t,
      ),
    })
  },

  redeemCode: async (partyId, code, attendeeName, attendeeContact) => {
    const res = await fetch(`/api/parties/${partyId}/codes/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, attendeeName, attendeeContact }),
    })
    if (!res.ok) {
      const err = (await res.json()) as { error: string }
      throw new Error(err.error)
    }
    const pass = (await res.json()) as Pass
    set({ myPass: pass })
    return pass
  },
}))
