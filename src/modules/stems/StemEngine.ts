export type StemName = 'drums' | 'bass' | 'other' | 'vocals'
export const STEM_NAMES: StemName[] = ['drums', 'bass', 'other', 'vocals']

export interface StemChannels {
  left: Float32Array
  right: Float32Array
}

export type StemSet = Record<StemName, StemChannels>

type ProgressCallback = (percent: number) => void
type SeparatedCallback = (stems: StemSet) => void
type ErrorCallback = (err: string) => void

const IDB_NAME = 'bambata-stems'
const IDB_STORE = 'models'
const DEFAULT_MODEL_KEY = 'demucs-htdemucs'

export class StemEngine {
  private static instance: StemEngine | null = null
  private worker: Worker | null = null
  private modelLoaded = false
  private pending: Map<string, { resolve: () => void; reject: (e: Error) => void }> = new Map()

  private progressCallbacks: Set<ProgressCallback> = new Set()
  private separatedCallbacks: Set<SeparatedCallback> = new Set()
  private errorCallbacks: Set<ErrorCallback> = new Set()

  static getInstance(): StemEngine {
    if (!StemEngine.instance) StemEngine.instance = new StemEngine()
    return StemEngine.instance
  }

  get isModelLoaded(): boolean {
    return this.modelLoaded
  }

  private ensureWorker() {
    if (this.worker) return
    this.worker = new Worker(
      new URL('./stemWorker.ts', import.meta.url),
      { type: 'module' },
    )
    this.worker.onmessage = (e: MessageEvent) => this.handleWorkerMessage(e)
    this.worker.onerror = (e) => {
      this.errorCallbacks.forEach((cb) => cb(e.message))
    }
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { type } = e.data
    switch (type) {
      case 'modelLoaded':
        this.modelLoaded = true
        this.pending.get('loadModel')?.resolve()
        this.pending.delete('loadModel')
        break
      case 'progress':
        this.progressCallbacks.forEach((cb) => cb(e.data.percent))
        break
      case 'separated':
        this.separatedCallbacks.forEach((cb) => cb(e.data.result))
        break
      case 'error':
        this.errorCallbacks.forEach((cb) => cb(e.data.message))
        this.pending.get('loadModel')?.reject(new Error(e.data.message))
        this.pending.delete('loadModel')
        break
    }
  }

  async loadModelFromBuffer(buffer: ArrayBuffer): Promise<void> {
    this.ensureWorker()
    await this.cacheModel(buffer)
    return new Promise((resolve, reject) => {
      this.pending.set('loadModel', { resolve, reject })
      this.worker!.postMessage({ type: 'loadModel', modelBuffer: buffer }, [buffer])
    })
  }

  async loadModelFromFile(file: File): Promise<void> {
    const buffer = await file.arrayBuffer()
    return this.loadModelFromBuffer(buffer)
  }

  async loadModelFromCache(): Promise<boolean> {
    try {
      const buffer = await this.getCachedModel()
      if (!buffer) return false
      this.ensureWorker()
      return new Promise((resolve) => {
        const pending = { resolve: () => resolve(true), reject: () => resolve(false) }
        this.pending.set('loadModel', pending)
        this.worker!.postMessage({ type: 'loadModel', modelBuffer: buffer }, [buffer])
      })
    } catch {
      return false
    }
  }

  async separate(audioBuffer: AudioBuffer): Promise<void> {
    if (!this.modelLoaded) throw new Error('Model not loaded')

    // Get stereo channel data (resample to 44100 if needed)
    const resampled = await this.resampleTo44100(audioBuffer)
    const left = resampled.getChannelData(0)
    const rightSrc = resampled.numberOfChannels > 1
      ? resampled.getChannelData(1)
      : resampled.getChannelData(0)

    // Copy to new buffers so we can transfer them
    const leftCopy = new Float32Array(left)
    const rightCopy = new Float32Array(rightSrc)

    this.worker!.postMessage(
      { type: 'separate', left: leftCopy, right: rightCopy },
      [leftCopy.buffer, rightCopy.buffer],
    )
  }

  private async resampleTo44100(buffer: AudioBuffer): Promise<AudioBuffer> {
    if (buffer.sampleRate === 44100) return buffer
    const ctx = new OfflineAudioContext(
      buffer.numberOfChannels,
      Math.ceil(buffer.duration * 44100),
      44100,
    )
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start()
    return ctx.startRendering()
  }

  onProgress(cb: ProgressCallback): () => void {
    this.progressCallbacks.add(cb)
    return () => this.progressCallbacks.delete(cb)
  }

  onSeparated(cb: SeparatedCallback): () => void {
    this.separatedCallbacks.add(cb)
    return () => this.separatedCallbacks.delete(cb)
  }

  onError(cb: ErrorCallback): () => void {
    this.errorCallbacks.add(cb)
    return () => this.errorCallbacks.delete(cb)
  }

  // IndexedDB helpers for caching the model file between sessions
  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async cacheModel(buffer: ArrayBuffer): Promise<void> {
    try {
      const db = await this.openDB()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        const store = tx.objectStore(IDB_STORE)
        store.put(buffer.slice(0), DEFAULT_MODEL_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // IDB not available (private mode etc.) — silently skip
    }
  }

  async getCachedModel(): Promise<ArrayBuffer | null> {
    try {
      const db = await this.openDB()
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const req = tx.objectStore(IDB_STORE).get(DEFAULT_MODEL_KEY)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => resolve(null)
      })
    } catch {
      return null
    }
  }

  async hasCachedModel(): Promise<boolean> {
    const buf = await this.getCachedModel()
    return buf !== null
  }

  async clearCachedModel(): Promise<void> {
    try {
      const db = await this.openDB()
      await new Promise<void>((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).delete(DEFAULT_MODEL_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    } catch { /* ignore */ }
  }
}
