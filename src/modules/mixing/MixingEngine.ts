import { MixingBrain, type DeckContext, type Technique } from './MixingBrain'

const CROSSFADE_SEC = 10
const BPM_RAMP_MS = 6000  // slower ramp = less audible pitch shift
const LOAD_TIMEOUT_MS = 12000
const PRELOAD_TIMEOUT_MS = 15000

export interface MixTrack {
  id: string
  title: string
  artist: string
  bpm: number | null
  energy: number
  duration_sec: number | null
  audiomack_url: string | null
  queue_position: number | null
  musical_key?: string | null
}

export interface MixProgress {
  currentTime: number
  duration: number
  buffered: number
}

export type MixState = 'idle' | 'loading' | 'playing' | 'paused' | 'crossfading' | 'ended'

export class MixingEngine {
  private ctx: AudioContext

  private audioA: HTMLAudioElement
  private gainA: GainNode
  private eqLowA: BiquadFilterNode
  private eqMidA: BiquadFilterNode
  private eqHighA: BiquadFilterNode
  private sweepA: BiquadFilterNode

  private audioB: HTMLAudioElement
  private gainB: GainNode
  private eqLowB: BiquadFilterNode
  private eqMidB: BiquadFilterNode
  private eqHighB: BiquadFilterNode
  private sweepB: BiquadFilterNode

  private analyser: AnalyserNode
  private masterGain: GainNode

  private activeDeck: 'A' | 'B' = 'A'
  private queue: MixTrack[] = []
  private currentIdx = -1
  private incomingIdx = -1
  private skippedIds = new Set<string>()
  private playedIds  = new Set<string>()  // tracks finished playing (not replayed)
  private state: MixState = 'idle'

  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private bpmRampTimer: ReturnType<typeof setInterval> | null = null

  // Preload tracking — guards against playing a track that failed to buffer
  private nextPreloadOk = false
  private nextPreloadIdx = -1
  private preloadGen = 0

  private brain = new MixingBrain()
  private lastLowFireAt = 0

  // Pre-buffering — iTunes preview URLs are CORS-enabled CDN files (~480 KB each).
  // We fetch them as Blobs and store object URLs so playback never stalls mid-song.
  private blobCache = new Map<string, string>()   // trackId → objectURL
  private prefetching = new Set<string>()          // trackIds currently being fetched

  onTrackChange?: (current: MixTrack | null, next: MixTrack | null) => void
  onProgress?: (progress: MixProgress) => void
  onStateChange?: (state: MixState) => void
  onError?: (err: string) => void
  onSkip?: (track: MixTrack, reason: string) => void
  onTechniqueChange?: (technique: Technique) => void
  onQueueChange?: (queue: MixTrack[]) => void
  onQueueLow?: (estimatedRemainingSec: number) => void
  onPrefetchChange?: (cachedCount: number) => void

  constructor() {
    this.ctx = new AudioContext()

    this.audioA = this.makeAudio()
    this.audioB = this.makeAudio()

    this.gainA = this.ctx.createGain()
    this.gainB = this.ctx.createGain()
    this.gainB.gain.value = 0

    this.eqLowA  = this.makeEQ('lowshelf',  320)
    this.eqMidA  = this.makeEQ('peaking',   1000)
    this.eqHighA = this.makeEQ('highshelf', 3200)
    this.sweepA  = this.makeSweep()

    this.eqLowB  = this.makeEQ('lowshelf',  320)
    this.eqMidB  = this.makeEQ('peaking',   1000)
    this.eqHighB = this.makeEQ('highshelf', 3200)
    this.sweepB  = this.makeSweep()

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.8

    this.masterGain = this.ctx.createGain()

    const srcA = this.ctx.createMediaElementSource(this.audioA)
    const srcB = this.ctx.createMediaElementSource(this.audioB)

    // srcX → gainX → eqLow → eqMid → eqHigh → sweep → analyser → master → output
    srcA.connect(this.gainA)
    this.gainA.connect(this.eqLowA)
    this.eqLowA.connect(this.eqMidA)
    this.eqMidA.connect(this.eqHighA)
    this.eqHighA.connect(this.sweepA)
    this.sweepA.connect(this.analyser)

    srcB.connect(this.gainB)
    this.gainB.connect(this.eqLowB)
    this.eqLowB.connect(this.eqMidB)
    this.eqMidB.connect(this.eqHighB)
    this.eqHighB.connect(this.sweepB)
    this.sweepB.connect(this.analyser)

    this.analyser.connect(this.masterGain)
    this.masterGain.connect(this.ctx.destination)

    this.audioA.addEventListener('ended', () => {
      if (this.activeDeck === 'A') this.completeCrossfade()
    })
    this.audioB.addEventListener('ended', () => {
      if (this.activeDeck === 'B') this.completeCrossfade()
    })
  }

  private makeAudio(): HTMLAudioElement {
    const el = new Audio()
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    return el
  }

  private makeEQ(type: BiquadFilterType, freq: number): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    if (type === 'peaking') f.Q.value = 0.8
    return f
  }

  private makeSweep(): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter()
    f.type = 'allpass'
    f.frequency.value = 20000
    return f
  }

  // ─── Pre-buffering ─────────────────────────────────────────────────────────

  private isDirectAudio(url: string): boolean {
    return /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(url)
      || url.includes('audio-ssl.itunes.apple.com')
      || url.includes('phobos.apple.com')
      || url.includes('mzstatic.com')
  }

  private async prefetchTrack(track: MixTrack): Promise<void> {
    if (!track.audiomack_url || !this.isDirectAudio(track.audiomack_url)) return
    if (this.blobCache.has(track.id) || this.prefetching.has(track.id)) return
    this.prefetching.add(track.id)
    try {
      const res = await fetch(track.audiomack_url, {
        signal: AbortSignal.timeout(30000),
        mode: 'cors',
      })
      if (!res.ok) return
      const blob = await res.blob()
      if (!this.blobCache.has(track.id)) {
        this.blobCache.set(track.id, URL.createObjectURL(blob))
        this.onPrefetchChange?.(this.blobCache.size)
      }
    } catch { /* CORS fail or network error — stream proxy will cover it */ }
    finally { this.prefetching.delete(track.id) }
  }

  // Kick off background pre-fetch for the next N upcoming direct-audio tracks.
  private prefetchAhead() {
    const DEPTH = 3
    const currentId = this.queue[this.currentIdx]?.id
    let count = 0
    for (const t of this.queue) {
      if (count >= DEPTH) break
      if (this.playedIds.has(t.id) || this.skippedIds.has(t.id) || t.id === currentId) continue
      if (t.audiomack_url && this.isDirectAudio(t.audiomack_url)) {
        void this.prefetchTrack(t)
        count++
      }
    }
  }

  private revokeBlobUrl(trackId: string) {
    const url = this.blobCache.get(trackId)
    if (url) { URL.revokeObjectURL(url); this.blobCache.delete(trackId) }
  }

  private get activeAudio()    { return this.activeDeck === 'A' ? this.audioA    : this.audioB }
  private get inactiveAudio()  { return this.activeDeck === 'A' ? this.audioB    : this.audioA }
  private get activeGain()     { return this.activeDeck === 'A' ? this.gainA     : this.gainB }
  private get inactiveGain()   { return this.activeDeck === 'A' ? this.gainB     : this.gainA }

  private deckContext(deck: 'A' | 'B'): DeckContext {
    return deck === 'A'
      ? { gain: this.gainA, audio: this.audioA, eqLow: this.eqLowA, eqMid: this.eqMidA, eqHigh: this.eqHighA, sweep: this.sweepA }
      : { gain: this.gainB, audio: this.audioB, eqLow: this.eqLowB, eqMid: this.eqMidB, eqHigh: this.eqHighB, sweep: this.sweepB }
  }

  private resetDeckNodes(deck: 'A' | 'B') {
    const t = this.ctx.currentTime
    const d = this.deckContext(deck)
    d.eqLow.gain.cancelScheduledValues(t)
    d.eqMid.gain.cancelScheduledValues(t)
    d.eqHigh.gain.cancelScheduledValues(t)
    d.eqLow.gain.setTargetAtTime(0, t, 0.08)
    d.eqMid.gain.setTargetAtTime(0, t, 0.08)
    d.eqHigh.gain.setTargetAtTime(0, t, 0.08)
    d.sweep.frequency.cancelScheduledValues(t)
    d.sweep.type = 'allpass'
    d.sweep.frequency.setTargetAtTime(20000, t, 0.08)
    d.audio.playbackRate = 1
  }

  private findNextPlayableIdx(afterIdx: number): number {
    for (let i = afterIdx; i < this.queue.length; i++) {
      if (!this.skippedIds.has(this.queue[i].id) && !this.playedIds.has(this.queue[i].id)) return i
    }
    return -1
  }

  // Brain-driven next: scores ALL remaining unplayed tracks, returns the best index
  private findBestNextIdx(): number {
    const current = this.queue[this.currentIdx]
    const candidates: Array<{ track: MixTrack; idx: number }> = []
    for (let i = 0; i < this.queue.length; i++) {
      const t = this.queue[i]
      if (i === this.currentIdx) continue
      if (this.skippedIds.has(t.id) || this.playedIds.has(t.id)) continue
      candidates.push({ track: t, idx: i })
    }
    if (candidates.length === 0) return -1
    if (!current || candidates.length === 1) return candidates[0].idx
    const best = this.brain.selectBestNext(current, candidates.map(c => c.track))
    return candidates.find(c => c.track.id === best?.id)?.idx ?? candidates[0].idx
  }

  setQueue(tracks: MixTrack[]) {
    this.queue = this.brain.organizeQueue(tracks)
    this.nextPreloadOk = false
    this.nextPreloadIdx = -1
    this.onQueueChange?.(this.queue)
    this.prefetchAhead()
  }

  appendToQueue(tracks: MixTrack[]) {
    const newTracks = tracks.filter(t => !this.queue.some(q => q.id === t.id))
    if (newTracks.length === 0) return

    const current = this.queue[this.currentIdx] ?? null

    if (!current || this.currentIdx < 0) {
      this.queue = this.brain.organizeQueue([...this.queue, ...newTracks])
      this.onQueueChange?.(this.queue)
      return
    }

    const unplayed = this.queue.filter(
      t => !this.playedIds.has(t.id) && !this.skippedIds.has(t.id) && t.id !== current.id
    )
    const reordered = this.brain.organizeRemaining(current, [...unplayed, ...newTracks])
    const done = this.queue.filter(t => this.playedIds.has(t.id) || this.skippedIds.has(t.id))
    this.queue = [...done, current, ...reordered]
    this.currentIdx = done.length

    this.nextPreloadOk = false
    this.nextPreloadIdx = -1
    this.onQueueChange?.(this.queue)
    this.prefetchAhead()

    if (this.state === 'playing' || this.state === 'paused') {
      const nextIdx = this.findBestNextIdx()
      this.onTrackChange?.(current, nextIdx >= 0 ? this.queue[nextIdx] : null)
      void this.preloadNext()
    }
  }

  getQueue(): MixTrack[] { return [...this.queue] }

  async start() {
    if (this.queue.length === 0) return
    await this.ctx.resume()

    const firstIdx = this.findNextPlayableIdx(0)
    if (firstIdx < 0) { this.onError?.('Queue is empty'); return }

    for (let i = 0; i < firstIdx; i++) {
      this.skippedIds.add(this.queue[i].id)
      this.onSkip?.(this.queue[i], 'stream unavailable')
    }

    this.currentIdx = firstIdx
    this.incomingIdx = firstIdx
    this.setState('loading')

    try {
      await this.loadTrack(this.activeAudio, this.queue[firstIdx])
      this.activeGain.gain.setValueAtTime(1, this.ctx.currentTime)
      await this.activeAudio.play()
      const nextIdx = this.findNextPlayableIdx(firstIdx + 1)
      this.onTrackChange?.(this.queue[firstIdx], nextIdx >= 0 ? this.queue[nextIdx] : null)
      void this.preloadNext()
      this.setState('playing')
      this.startChecking()
    } catch (err) {
      this.skippedIds.add(this.queue[firstIdx].id)
      this.onSkip?.(this.queue[firstIdx], 'stream unavailable')
      this.onError?.(err instanceof Error ? err.message : 'Stream unavailable — trying next track')
      await new Promise((r) => setTimeout(r, 1000))
      await this.skip()
    }
  }

  private loadTrack(audio: HTMLAudioElement, track: MixTrack, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
    // Use pre-buffered blob if available — resolves near-instantly and works offline
    const cached = this.blobCache.get(track.id)
    const src = cached ?? `/api/stream/${track.id}`
    const effectiveTimeout = cached ? 3000 : timeoutMs

    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        audio.removeEventListener('canplay', onCanPlay)
        audio.removeEventListener('error', onError)
        fn()
      }
      const onCanPlay = () => settle(resolve)
      const onError   = () => settle(() => reject(new Error(`Stream unavailable: ${track.title}`)))
      const timer = setTimeout(() => settle(() => reject(new Error(`Load timeout: ${track.title}`))), effectiveTimeout)
      audio.addEventListener('canplay', onCanPlay)
      audio.addEventListener('error', onError)
      audio.src = src
      audio.load()
    })
  }

  private async preloadNext(depth = 0) {
    if (depth > 8) return
    const nextIdx = this.findBestNextIdx()
    if (nextIdx < 0) { this.nextPreloadOk = false; return }

    const gen = ++this.preloadGen
    this.nextPreloadIdx = nextIdx
    this.nextPreloadOk = false
    this.inactiveGain.gain.setValueAtTime(0, this.ctx.currentTime)

    try {
      await this.loadTrack(this.inactiveAudio, this.queue[nextIdx], PRELOAD_TIMEOUT_MS)
      if (gen === this.preloadGen) this.nextPreloadOk = true
    } catch {
      if (gen !== this.preloadGen) return  // superseded by a newer preload
      // Mark this track failed and silently try the next one
      this.skippedIds.add(this.queue[nextIdx].id)
      this.onSkip?.(this.queue[nextIdx], 'stream unavailable')
      await this.preloadNext(depth + 1)
    }
  }

  private startChecking() {
    if (this.checkTimer) clearInterval(this.checkTimer)
    this.checkTimer = setInterval(() => {
      if (this.state !== 'playing') return

      const audio = this.activeAudio
      const track = this.queue[this.currentIdx]
      const raw = audio.duration
      const duration = isFinite(raw) && raw > 0 ? raw : (track?.duration_sec ?? 0)

      if (duration > 0) {
        const currentTime = audio.currentTime
        this.onProgress?.({
          currentTime,
          duration,
          buffered: audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1) : 0,
        })
        const remaining = duration - currentTime
        if (remaining > 0 && remaining <= CROSSFADE_SEC) {
          void this.triggerCrossfade()
        }
      }

      // Estimate total playback time remaining across unplayed queue
      const currentId = this.queue[this.currentIdx]?.id
      const queueRemainSec = this.queue
        .filter(t => !this.playedIds.has(t.id) && !this.skippedIds.has(t.id) && t.id !== currentId)
        .reduce((sum, t) => sum + (t.duration_sec ?? 180), 0)
      const trackRemainSec = duration > 0 ? Math.max(0, duration - (audio.currentTime ?? 0)) : 0
      const totalRemainSec = queueRemainSec + trackRemainSec

      // Fire onQueueLow when < 5 min remain, at most once per 90 seconds
      if (totalRemainSec < 300 && this.onQueueLow) {
        const now = Date.now()
        if (now - this.lastLowFireAt > 90_000) {
          this.lastLowFireAt = now
          this.onQueueLow(totalRemainSec)
        }
      }
    }, 500)
  }

  private async triggerCrossfade() {
    if (this.state === 'crossfading') return

    let nextIdx = this.findBestNextIdx()
    if (nextIdx < 0) return

    // Ensure next track is ready on inactive deck; if preload failed, try loading now
    if (!this.nextPreloadOk || this.nextPreloadIdx !== nextIdx) {
      try {
        await this.loadTrack(this.inactiveAudio, this.queue[nextIdx], 6000)
        this.nextPreloadOk = true
        this.nextPreloadIdx = nextIdx
      } catch {
        this.skippedIds.add(this.queue[nextIdx].id)
        this.onSkip?.(this.queue[nextIdx], 'stream unavailable')
        // One more attempt with the track after
        const altIdx = this.findNextPlayableIdx(nextIdx + 1)
        if (altIdx < 0) return
        nextIdx = altIdx
        try {
          await this.loadTrack(this.inactiveAudio, this.queue[nextIdx], 6000)
        } catch {
          this.skippedIds.add(this.queue[nextIdx].id)
          this.onSkip?.(this.queue[nextIdx], 'stream unavailable')
          return  // can't find a playable next track — stay on current
        }
      }
    }

    this.incomingIdx = nextIdx
    this.setState('crossfading')

    const cur = this.queue[this.currentIdx]
    const nxt = this.queue[nextIdx]

    if (cur.bpm && nxt.bpm) {
      // Clamp to ±6% — beyond that it sounds like a tape malfunction
      const target = Math.max(0.94, Math.min(1.06, nxt.bpm / cur.bpm))
      if (Math.abs(target - 1) > 0.01) this.rampPlaybackRate(this.activeAudio, target, BPM_RAMP_MS)
    }

    // Let the brain pick and execute the transition technique
    const technique = this.brain.select(cur, nxt)
    this.onTechniqueChange?.(technique)

    // Sound effect: pick one that matches the transition style
    const energyJump = (nxt.energy ?? 5) - (cur.energy ?? 5)
    // Sound effects only on big energy jumps — keep it tasteful
    if (technique === 'spinback' && energyJump >= 2) this.playEffect('scratch')
    else if (energyJump >= 3.5) this.playEffect('riser')

    this.brain.execute(technique, {
      ctx: this.ctx,
      outgoing: this.deckContext(this.activeDeck),
      incoming: this.deckContext(this.activeDeck === 'A' ? 'B' : 'A'),
      crossfadeSec: CROSSFADE_SEC,
    })

    try {
      await this.inactiveAudio.play()
    } catch {
      const t = this.ctx.currentTime
      this.activeGain.gain.cancelScheduledValues(t)
      this.activeGain.gain.setValueAtTime(1, t)
      this.inactiveGain.gain.cancelScheduledValues(t)
      this.inactiveGain.gain.setValueAtTime(0, t)
      this.resetDeckNodes(this.activeDeck === 'A' ? 'B' : 'A')
      this.onError?.(`Could not start next track: ${nxt.title}`)
      this.setState('playing')
      return
    }

    this.crossfadeTimer = setTimeout(() => this.completeCrossfade(), CROSSFADE_SEC * 1000)
  }

  private rampPlaybackRate(audio: HTMLAudioElement, target: number, ms: number) {
    const start = audio.playbackRate
    const t0 = Date.now()
    if (this.bpmRampTimer) clearInterval(this.bpmRampTimer)
    this.bpmRampTimer = setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / ms)
      audio.playbackRate = start + (target - start) * t
      if (t >= 1) { clearInterval(this.bpmRampTimer!); this.bpmRampTimer = null }
    }, 50)
  }

  private completeCrossfade() {
    if (this.crossfadeTimer) { clearTimeout(this.crossfadeTimer); this.crossfadeTimer = null }
    if (this.bpmRampTimer)   { clearInterval(this.bpmRampTimer);  this.bpmRampTimer = null }

    const now = this.ctx.currentTime
    this.activeGain.gain.cancelScheduledValues(now)
    this.activeGain.gain.setValueAtTime(0, now)
    this.inactiveGain.gain.cancelScheduledValues(now)
    this.inactiveGain.gain.setValueAtTime(1, now)

    this.activeAudio.pause()
    this.activeAudio.src = ''

    const oldDeck = this.activeDeck
    // Mark outgoing track as played so the brain won't select it again, free its memory
    const outgoingTrack = this.queue[this.currentIdx]
    if (outgoingTrack) {
      this.playedIds.add(outgoingTrack.id)
      this.revokeBlobUrl(outgoingTrack.id)
    }

    this.activeDeck = this.activeDeck === 'A' ? 'B' : 'A'
    this.currentIdx = this.incomingIdx

    // Clean up EQ / filters on the deck that just finished
    this.resetDeckNodes(oldDeck)

    if (this.currentIdx >= this.queue.length) {
      this.setState('ended')
      return
    }

    const current = this.queue[this.currentIdx]

    // Re-sort remaining tracks so the brain keeps control of the arc
    const unplayed = this.queue.filter(
      t => !this.playedIds.has(t.id) && !this.skippedIds.has(t.id) && t.id !== current?.id
    )
    if (current && unplayed.length > 1) {
      const reordered = this.brain.organizeRemaining(current, unplayed)
      const done = this.queue.filter(t => this.playedIds.has(t.id) || this.skippedIds.has(t.id))
      this.queue = [...done, current, ...reordered]
      this.currentIdx = done.length
      this.nextPreloadOk = false
      this.nextPreloadIdx = -1
      this.onQueueChange?.(this.queue)
    }

    // Pre-fetch the next batch of tracks in the background
    this.prefetchAhead()

    const nextIdx = this.findBestNextIdx()
    const next = nextIdx >= 0 ? this.queue[nextIdx] : null
    this.onTrackChange?.(current, next)
    void this.preloadNext()
    this.setState('playing')
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'crossfading') return
    this.activeAudio.pause()
    if (this.state === 'crossfading') this.inactiveAudio.pause()
    this.setState('paused')
  }

  async resume() {
    if (this.state !== 'paused') return
    await this.ctx.resume()
    try {
      await this.activeAudio.play()
      this.setState('playing')
    } catch {
      this.onError?.('Resume failed')
    }
  }

  async skip() {
    if (this.checkTimer)    { clearInterval(this.checkTimer);   this.checkTimer = null }
    if (this.crossfadeTimer){ clearTimeout(this.crossfadeTimer); this.crossfadeTimer = null }
    if (this.bpmRampTimer)  { clearInterval(this.bpmRampTimer);  this.bpmRampTimer = null }

    // Mark current track as played before skipping, free its memory
    const skipTrack = this.queue[this.currentIdx]
    if (skipTrack) { this.playedIds.add(skipTrack.id); this.revokeBlobUrl(skipTrack.id) }

    const nextIdx = this.findBestNextIdx()

    for (let i = this.currentIdx + 1; nextIdx >= 0 && i < nextIdx; i++) {
      this.skippedIds.add(this.queue[i].id)
      this.onSkip?.(this.queue[i], 'stream unavailable')
    }

    if (nextIdx < 0) { this.setState('ended'); return }

    this.activeAudio.pause()
    this.inactiveAudio.pause()

    const now = this.ctx.currentTime
    this.gainA.gain.cancelScheduledValues(now)
    this.gainB.gain.cancelScheduledValues(now)
    this.activeGain.gain.setValueAtTime(1, now)
    this.inactiveGain.gain.setValueAtTime(0, now)
    this.resetDeckNodes('A')
    this.resetDeckNodes('B')

    this.currentIdx = nextIdx
    this.incomingIdx = nextIdx
    const track = this.queue[this.currentIdx]

    this.setState('loading')
    try {
      await this.loadTrack(this.activeAudio, track)
      await this.activeAudio.play()
      const followingIdx = this.findNextPlayableIdx(this.currentIdx + 1)
      this.onTrackChange?.(track, followingIdx >= 0 ? this.queue[followingIdx] : null)
      void this.preloadNext()
      this.setState('playing')
      this.startChecking()
    } catch (err) {
      this.skippedIds.add(track.id)
      this.onSkip?.(track, 'stream unavailable')
      this.onError?.(err instanceof Error ? err.message : 'Stream unavailable — trying next track')
      await new Promise((r) => setTimeout(r, 800))
      await this.skip()
    }
  }

  private setState(s: MixState) {
    this.state = s
    this.onStateChange?.(s)
  }

  getAnalyserNode(): AnalyserNode { return this.analyser }
  getCurrentTrack(): MixTrack | null { return this.queue[this.currentIdx] ?? null }
  getNextTrack(): MixTrack | null {
    const idx = this.findNextPlayableIdx(this.currentIdx + 1)
    return idx >= 0 ? this.queue[idx] : null
  }
  getState(): MixState { return this.state }

  getProgress(): MixProgress {
    const audio = this.activeAudio
    const track = this.queue[this.currentIdx]
    const raw = audio.duration
    const duration = isFinite(raw) && raw > 0 ? raw : (track?.duration_sec ?? 0)
    return {
      currentTime: audio.currentTime,
      duration,
      buffered: audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1) : 0,
    }
  }

  getCachedCount(): number { return this.blobCache.size }

  // Called by the UI when attendees react to the current track
  recordReaction(trackId: string, count: number) {
    if (this.queue[this.currentIdx]?.id === trackId) {
      this.brain.notifyReaction(trackId, this.queue[this.currentIdx], count)
    }
  }

  // ─── Procedural DJ sound effects ────────────────────────────────────────────

  private playEffect(type: 'air-horn' | 'siren' | 'riser' | 'scratch') {
    try {
      switch (type) {
        case 'air-horn': this._sfxAirHorn(); break
        case 'siren':    this._sfxSiren();   break
        case 'riser':    this._sfxRiser();   break
        case 'scratch':  this._sfxScratch(); break
      }
    } catch { /* AudioContext may be suspended during tab switch */ }
  }

  private _sfxAirHorn() {
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    const wave = this.ctx.createWaveShaper()
    const curve = new Float32Array(128)
    for (let i = 0; i < 128; i++) {
      const x = (i * 2) / 128 - 1
      curve[i] = (Math.PI + 150) * x / (Math.PI + 150 * Math.abs(x))
    }
    wave.curve = curve
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(480, t)
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.9)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.35, t + 0.04)
    gain.gain.setValueAtTime(0.35, t + 0.65)
    gain.gain.linearRampToValueAtTime(0, t + 0.95)
    osc.connect(wave); wave.connect(gain); gain.connect(this.masterGain)
    osc.start(t); osc.stop(t + 1)
  }

  private _sfxSiren() {
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const lfo = this.ctx.createOscillator()
    const lfoGain = this.ctx.createGain()
    const gain = this.ctx.createGain()
    lfo.frequency.value = 5
    lfoGain.gain.value = 260
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency)
    osc.type = 'sine'; osc.frequency.value = 580
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.28, t + 0.1)
    gain.gain.setValueAtTime(0.28, t + 1.7)
    gain.gain.linearRampToValueAtTime(0, t + 2.0)
    osc.connect(gain); gain.connect(this.masterGain)
    lfo.start(t); osc.start(t); lfo.stop(t + 2); osc.stop(t + 2)
  }

  private _sfxRiser(dur = 3.5) {
    const t = this.ctx.currentTime
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'; filter.Q.value = 0.6
    filter.frequency.setValueAtTime(150, t)
    filter.frequency.exponentialRampToValueAtTime(7000, t + dur)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.18, t + dur * 0.3)
    gain.gain.linearRampToValueAtTime(0.38, t + dur * 0.85)
    gain.gain.linearRampToValueAtTime(0, t + dur)
    src.connect(filter); filter.connect(gain); gain.connect(this.masterGain)
    src.start(t)
  }

  private _sfxScratch() {
    const t = this.ctx.currentTime
    const dur = 0.35
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      const p = i / data.length
      data[i] = (Math.random() * 2 - 1) * Math.sin(p * Math.PI) * (1 - p * 0.5)
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buf; src.playbackRate.value = 1.8
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'; filter.frequency.value = 3200; filter.Q.value = 2
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.5, t)
    gain.gain.linearRampToValueAtTime(0, t + dur)
    src.connect(filter); filter.connect(gain); gain.connect(this.masterGain)
    src.start(t)
  }

  destroy() {
    if (this.checkTimer)     clearInterval(this.checkTimer)
    if (this.crossfadeTimer) clearTimeout(this.crossfadeTimer)
    if (this.bpmRampTimer)   clearInterval(this.bpmRampTimer)
    this.audioA.pause()
    this.audioB.pause()
    // Free all pre-buffered audio blobs
    this.blobCache.forEach((url) => URL.revokeObjectURL(url))
    this.blobCache.clear()
    void this.ctx.close()
  }
}
