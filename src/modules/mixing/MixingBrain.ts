import type { MixTrack } from './MixingEngine'

export type Technique =
  | 'bass-swap'
  | 'filter-sweep'
  | 'echo-wash'
  | 'spinback'
  | 'energy-blend'
  | 'stem-intro'

export interface DeckContext {
  gain: GainNode
  audio: HTMLAudioElement
  eqLow: BiquadFilterNode
  eqMid: BiquadFilterNode
  eqHigh: BiquadFilterNode
  sweep: BiquadFilterNode
}

export interface BrainTransition {
  ctx: AudioContext
  outgoing: DeckContext
  incoming: DeckContext
  crossfadeSec: number
}

// ─── Set Organization ────────────────────────────────────────────────────────

interface ReactionSignal {
  artist: string
  energy: number
  count: number
}

export class MixingBrain {
  private lastTechnique: Technique | null = null
  // Crowd reaction signals: artist → cumulative reaction count (resets between parties)
  private reactionSignals = new Map<string, ReactionSignal>()

  /**
   * Organize the full track list into the best DJ arc order.
   * Called once when the queue is loaded, and again after each track to
   * re-sort the remaining set from the new BPM/energy position.
   */
  organizeQueue(tracks: MixTrack[]): MixTrack[] {
    if (tracks.length <= 2) return tracks

    // Fill missing BPMs with energy-based estimates so sorting is always meaningful
    const enriched = tracks.map(t => ({
      ...t,
      bpm: t.bpm ?? this._bpmFromEnergy(t.energy),
    }))

    // ── 1. Divide into energy tiers (classic DJ arc) ──────────────────────────
    const intro   = enriched.filter(t => t.energy < 4)
    const build   = enriched.filter(t => t.energy >= 4 && t.energy < 6)
    const peak    = enriched.filter(t => t.energy >= 6 && t.energy < 8)
    const anthem  = enriched.filter(t => t.energy >= 8)

    const byBPM = (arr: MixTrack[]) => [...arr].sort((a, b) => (a.bpm ?? 120) - (b.bpm ?? 120))

    // ── 2. Within peak tier: harmonic mixing (Camelot) if keys are available ──
    const peakOrdered = this._harmonicSort(peak)

    // ── 3. Assemble full arc ──────────────────────────────────────────────────
    // intro (slow BPM, low energy) → build → peak (Camelot-linked) → anthems
    const assembled = [
      ...byBPM(intro),
      ...byBPM(build),
      ...peakOrdered,
      ...byBPM(anthem),
    ]

    // ── 4. BPM smoothing passes — swap adjacent pairs to cut tempo jumps ─────
    return this._bpmSmoothPass(assembled, 4)
  }

  /**
   * Re-sort remaining tracks starting from where we are now.
   * Ensures the first remaining track is BPM-compatible with what just played.
   */
  organizeRemaining(current: MixTrack, remaining: MixTrack[]): MixTrack[] {
    if (remaining.length <= 1) return remaining

    const organized = this.organizeQueue(remaining)

    // Promote a BPM-compatible opener if the algorithm's first choice isn't close
    if (organized.length >= 3) {
      const curBPM = current.bpm ?? this._bpmFromEnergy(current.energy)
      const top3 = organized.slice(0, 3)
      const best = top3.reduce((a, b) => {
        const da = this._bpmCompatScore(curBPM, a.bpm ?? this._bpmFromEnergy(a.energy))
        const db = this._bpmCompatScore(curBPM, b.bpm ?? this._bpmFromEnergy(b.energy))
        return da >= db ? a : b
      })
      if (best.id !== organized[0].id) {
        const idx = organized.findIndex(t => t.id === best.id)
        ;[organized[0], organized[idx]] = [organized[idx], organized[0]]
      }
    }

    return organized
  }

  // Called by engine when crowd reaction count updates for the currently-playing track
  notifyReaction(trackId: string, track: MixTrack, count: number) {
    const key = track.artist.toLowerCase()
    const prev = this.reactionSignals.get(key)
    if (!prev || count > prev.count) {
      this.reactionSignals.set(key, { artist: track.artist, energy: track.energy, count })
    }
  }

  // How much the crowd has reacted to this artist's work (0–1 normalized)
  private _reactionBonus(track: MixTrack): number {
    if (this.reactionSignals.size === 0) return 0
    const signal = this.reactionSignals.get(track.artist.toLowerCase())
    if (!signal) return 0
    const maxCount = Math.max(...[...this.reactionSignals.values()].map(s => s.count))
    return maxCount > 0 ? (signal.count / maxCount) * 0.25 : 0  // up to 25% bonus
  }

  // ─── Next-track selection (greedy runtime pick) ──────────────────────────

  selectBestNext(current: MixTrack, candidates: MixTrack[]): MixTrack | null {
    if (candidates.length === 0) return null
    if (candidates.length === 1) return candidates[0]

    const curBPM    = current.bpm    ?? this._bpmFromEnergy(current.energy)
    const curEnergy = current.energy ?? 5

    const scored = candidates.map(t => {
      const nextBPM = t.bpm ?? this._bpmFromEnergy(t.energy)
      const bpmScore = this._bpmCompatScore(curBPM, nextBPM)

      const energyDelta = (t.energy ?? 5) - curEnergy
      const energyScore = (energyDelta >= 0 && energyDelta <= 1.5) ? 1.0
        : energyDelta >  1.5 && energyDelta <= 3 ? 0.75
        : energyDelta >  3                        ? 0.50
        : energyDelta >= -1                       ? 0.65
        : energyDelta >= -3                       ? 0.40
        : 0.20

      const reactionBonus = this._reactionBonus(t)
      return { track: t, score: bpmScore * 0.65 + energyScore * 0.35 + reactionBonus }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored[0].track
  }

  // ─── Technique selection ─────────────────────────────────────────────────

  select(cur: MixTrack, nxt: MixTrack): Technique {
    const curBPM = cur.bpm ?? this._bpmFromEnergy(cur.energy)
    const nxtBPM = nxt.bpm ?? this._bpmFromEnergy(nxt.energy)
    const bpmDelta = this._bpmDelta(curBPM, nxtBPM)
    const energyShift = (nxt.energy ?? 5) - (cur.energy ?? 5)

    const pool: Technique[] = []

    // BPM compatibility drives the primary technique choice — the core DJ decision
    if (bpmDelta > 0.18) {
      // Big tempo jump → spinback signals the shift, or filter to smooth it
      pool.push('spinback', 'spinback', 'filter-sweep')
    } else if (bpmDelta > 0.10) {
      // Moderate jump → filter sweep masks the tempo change
      pool.push('filter-sweep', 'filter-sweep')
    } else {
      // BPM-compatible → EQ work fits seamlessly
      pool.push('bass-swap', 'bass-swap')
    }

    // Energy direction shapes the texture
    if (energyShift >= 2)              pool.push('bass-swap', 'filter-sweep')
    if (energyShift <= -2)             pool.push('echo-wash', 'energy-blend')
    if (Math.abs(energyShift) < 1)     pool.push('energy-blend')

    // Always provide full variety
    pool.push('bass-swap', 'filter-sweep', 'echo-wash', 'energy-blend', 'spinback')

    const filtered = pool.filter(t => t !== this.lastTechnique)
    const choice = filtered[Math.floor(Math.random() * filtered.length)]
    this.lastTechnique = choice
    return choice
  }

  execute(technique: Technique, bt: BrainTransition): void {
    switch (technique) {
      case 'bass-swap':    this._bassSwap(bt);    break
      case 'filter-sweep': this._filterSweep(bt); break
      case 'echo-wash':    this._echoWash(bt);    break
      case 'spinback':     this._spinback(bt);    break
      case 'energy-blend': this._energyBlend(bt); break
      case 'stem-intro':   this._bassSwap(bt);    break
      default:             this._standard(bt);    break
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /** BPM from energy (80–140 range) for tracks missing BPM metadata */
  private _bpmFromEnergy(energy = 5): number {
    return Math.round(80 + (energy / 10) * 60)
  }

  /** Normalized BPM delta — considers same tempo, double-time, half-time */
  private _bpmDelta(a: number, b: number): number {
    const ratio = b / a
    return Math.min(Math.abs(ratio - 1), Math.abs(ratio - 2), Math.abs(ratio - 0.5))
  }

  /** 0–1 compatibility score: 1.0 = perfect match, 0 = incompatible */
  private _bpmCompatScore(curBPM: number, nextBPM: number): number {
    const delta = this._bpmDelta(curBPM, nextBPM)
    return delta <= 0.06 ? 1.0
      : delta <= 0.12    ? 0.80
      : delta <= 0.18    ? 0.55
      : Math.max(0, 0.35 - (delta - 0.18) * 1.5)
  }

  /**
   * Camelot wheel distance between two keys.
   * 0 = same key, 1 = relative/adjacent, 6 = tritone (worst).
   */
  private _camelotDist(keyA?: string | null, keyB?: string | null): number {
    if (!keyA || !keyB) return 3  // neutral for unknown keys
    const parse = (k: string) => {
      const m = k.match(/^(\d+)([AB])$/i)
      return m ? { n: parseInt(m[1]), m: m[2].toUpperCase() } : null
    }
    const a = parse(keyA)
    const b = parse(keyB)
    if (!a || !b) return 3
    if (a.n === b.n && a.m === b.m) return 0   // exact match
    if (a.n === b.n) return 1                   // relative major/minor
    const diff = Math.min(Math.abs(a.n - b.n), 12 - Math.abs(a.n - b.n))
    return diff + (a.m !== b.m ? 1 : 0)
  }

  /**
   * Nearest-neighbour Camelot walk for a group of tracks.
   * Falls back to BPM sort when key data is absent.
   */
  private _harmonicSort(tracks: MixTrack[]): MixTrack[] {
    if (tracks.length <= 1) return tracks
    const hasKeys = tracks.some(t => t.musical_key)
    if (!hasKeys) return [...tracks].sort((a, b) => (a.bpm ?? 120) - (b.bpm ?? 120))

    const pool = [...tracks].sort((a, b) => (a.bpm ?? 120) - (b.bpm ?? 120))
    const result: MixTrack[] = [pool.shift()!]

    while (pool.length > 0) {
      const last = result[result.length - 1]
      pool.sort((a, b) => {
        // Primary: Camelot distance, Secondary: BPM proximity
        const camelA = this._camelotDist(last.musical_key, a.musical_key) * 10
          + Math.abs((a.bpm ?? 120) - (last.bpm ?? 120)) / 20
        const camelB = this._camelotDist(last.musical_key, b.musical_key) * 10
          + Math.abs((b.bpm ?? 120) - (last.bpm ?? 120)) / 20
        return camelA - camelB
      })
      result.push(pool.shift()!)
    }
    return result
  }

  /**
   * Multiple bubble-swap passes: swap adjacent pairs when it reduces the
   * total BPM jump without significantly worsening the energy arc.
   */
  private _bpmSmoothPass(tracks: MixTrack[], passes: number): MixTrack[] {
    const r = [...tracks]
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < r.length - 2; i++) {
        const [a, b, c] = [r[i], r[i + 1], r[i + 2]]
        const bA = a.bpm ?? 120, bB = b.bpm ?? 120, bC = c.bpm ?? 120

        const costBefore = Math.abs(bB - bA) + Math.abs(bC - bB)
        const costAfter  = Math.abs(bC - bA) + Math.abs(bB - bC)

        const eArc = Math.abs(b.energy - a.energy) + Math.abs(c.energy - b.energy)
        const eArcSwap = Math.abs(c.energy - a.energy) + Math.abs(b.energy - c.energy)

        // Swap only if BPM improves by more than 3 BPM and energy arc doesn't suffer badly
        if (costAfter < costBefore - 3 && eArcSwap <= eArc + 1.5) {
          r[i + 1] = c
          r[i + 2] = b
        }
      }
    }
    return r
  }

  // ─── Transition techniques ───────────────────────────────────────────────

  private _standard({ ctx, outgoing: out, incoming: inc, crossfadeSec: dur }: BrainTransition) {
    const now = ctx.currentTime
    out.gain.gain.cancelScheduledValues(now)
    out.gain.gain.setValueAtTime(1, now)
    out.gain.gain.linearRampToValueAtTime(0, now + dur)
    inc.gain.gain.cancelScheduledValues(now)
    inc.gain.gain.setValueAtTime(0, now)
    inc.gain.gain.linearRampToValueAtTime(1, now + dur)
  }

  private _bassSwap({ ctx, outgoing: out, incoming: inc, crossfadeSec: dur }: BrainTransition) {
    const now = ctx.currentTime
    out.eqLow.gain.setValueAtTime(0, now)
    out.eqLow.gain.linearRampToValueAtTime(-36, now + dur * 0.45)
    out.eqMid.gain.setValueAtTime(0, now)
    out.eqMid.gain.linearRampToValueAtTime(4, now + dur * 0.25)
    out.eqMid.gain.linearRampToValueAtTime(0, now + dur * 0.7)
    inc.eqLow.gain.setValueAtTime(-36, now)
    inc.eqLow.gain.linearRampToValueAtTime(0, now + dur * 0.6)
    out.gain.gain.cancelScheduledValues(now)
    out.gain.gain.setValueAtTime(1, now)
    out.gain.gain.linearRampToValueAtTime(0, now + dur)
    inc.gain.gain.cancelScheduledValues(now)
    inc.gain.gain.setValueAtTime(0, now)
    inc.gain.gain.linearRampToValueAtTime(0.25, now + dur * 0.2)
    inc.gain.gain.linearRampToValueAtTime(1, now + dur)
  }

  private _filterSweep({ ctx, outgoing: out, incoming: inc, crossfadeSec: dur }: BrainTransition) {
    const now = ctx.currentTime
    inc.sweep.type = 'highpass'
    inc.sweep.Q.value = 1.0
    inc.sweep.frequency.cancelScheduledValues(now)
    inc.sweep.frequency.setValueAtTime(3000, now)
    inc.sweep.frequency.exponentialRampToValueAtTime(30, now + dur * 0.88)
    out.sweep.type = 'lowpass'
    out.sweep.Q.value = 0.7
    out.sweep.frequency.cancelScheduledValues(now)
    out.sweep.frequency.setValueAtTime(20000, now)
    out.sweep.frequency.exponentialRampToValueAtTime(200, now + dur * 0.92)
    out.gain.gain.cancelScheduledValues(now)
    out.gain.gain.setValueAtTime(1, now)
    out.gain.gain.linearRampToValueAtTime(0, now + dur)
    inc.gain.gain.cancelScheduledValues(now)
    inc.gain.gain.setValueAtTime(0, now)
    inc.gain.gain.linearRampToValueAtTime(1, now + dur)
  }

  private _echoWash({ ctx, outgoing: out, incoming: inc, crossfadeSec: dur }: BrainTransition) {
    const now = ctx.currentTime
    out.eqHigh.gain.setValueAtTime(0, now)
    out.eqHigh.gain.linearRampToValueAtTime(8, now + dur * 0.15)
    out.eqHigh.gain.linearRampToValueAtTime(3, now + dur * 0.5)
    out.eqHigh.gain.linearRampToValueAtTime(0, now + dur * 0.85)
    out.gain.gain.cancelScheduledValues(now)
    out.gain.gain.setValueAtTime(1, now)
    out.gain.gain.setValueAtTime(0.95, now + 0.05)
    out.gain.gain.exponentialRampToValueAtTime(0.001, now + dur)
    inc.gain.gain.cancelScheduledValues(now)
    inc.gain.gain.setValueAtTime(0, now)
    inc.gain.gain.linearRampToValueAtTime(1, now + dur * 0.9)
  }

  private _spinback({ ctx, outgoing: out, incoming: inc, crossfadeSec: dur }: BrainTransition) {
    const now = ctx.currentTime
    const spinDur = Math.min(2.0, dur * 0.28)
    out.audio.playbackRate = 1.0
    const spinStart = Date.now()
    const spinTimer = setInterval(() => {
      const p = Math.min(1, (Date.now() - spinStart) / (spinDur * 1000))
      out.audio.playbackRate = Math.max(0.05, 1 - Math.pow(p, 1.4) * 0.97)
      if (p >= 1) { clearInterval(spinTimer); out.audio.playbackRate = 0.05 }
    }, 25)
    out.gain.gain.cancelScheduledValues(now)
    out.gain.gain.setValueAtTime(1, now)
    out.gain.gain.setValueAtTime(1, now + spinDur)
    out.gain.gain.linearRampToValueAtTime(0, now + spinDur + 0.12)
    inc.gain.gain.cancelScheduledValues(now)
    inc.gain.gain.setValueAtTime(0, now)
    inc.gain.gain.setValueAtTime(0, now + spinDur + 0.12)
    inc.gain.gain.linearRampToValueAtTime(1, now + spinDur + 1.0)
    setTimeout(() => { out.audio.playbackRate = 1 }, (spinDur + 2) * 1000)
  }

  private _energyBlend({ ctx, outgoing: out, incoming: inc, crossfadeSec: dur }: BrainTransition) {
    const now = ctx.currentTime
    const d = Math.min(dur * 1.5, 13)
    out.gain.gain.cancelScheduledValues(now)
    out.gain.gain.setValueAtTime(1, now)
    out.gain.gain.linearRampToValueAtTime(0.72, now + d * 0.3)
    out.gain.gain.linearRampToValueAtTime(0.28, now + d * 0.7)
    out.gain.gain.linearRampToValueAtTime(0, now + d)
    inc.gain.gain.cancelScheduledValues(now)
    inc.gain.gain.setValueAtTime(0, now)
    inc.gain.gain.linearRampToValueAtTime(0.28, now + d * 0.3)
    inc.gain.gain.linearRampToValueAtTime(0.72, now + d * 0.7)
    inc.gain.gain.linearRampToValueAtTime(1, now + d)
  }
}
