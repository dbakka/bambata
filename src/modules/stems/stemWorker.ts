import * as ort from 'onnxruntime-web'

// Let Vite resolve WASM paths automatically via import.meta.url bundling
ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency ?? 4, 8)

let session: ort.InferenceSession | null = null
let inputName = 'mix'
let outputName = 'output'

// Demucs v3 time-domain model: 8s @ 44100 Hz fixed segment
// Matches the export in scripts/setup-demucs-onnx.py
const SEGMENT_SAMPLES = 352800   // 8 * 44100
const HOP_SAMPLES = Math.floor(SEGMENT_SAMPLES / 2)
const STEMS = ['drums', 'bass', 'other', 'vocals'] as const

type StemName = (typeof STEMS)[number]

function buildHannWindow(size: number): Float32Array {
  const win = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
  }
  return win
}

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data

  try {
    if (type === 'loadModel') {
      const { modelBuffer } = e.data as { modelBuffer: ArrayBuffer }

      session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })

      inputName = session.inputNames[0]
      outputName = session.outputNames[0]

      self.postMessage({
        type: 'modelLoaded',
        inputNames: session.inputNames,
        outputNames: session.outputNames,
      })
    }

    else if (type === 'separate') {
      if (!session) throw new Error('Model not loaded')
      const { left, right } = e.data as { left: Float32Array; right: Float32Array }
      await separateAudio(left, right)
    }

    else if (type === 'ping') {
      self.postMessage({ type: 'pong' })
    }

  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) })
  }
}

async function separateAudio(left: Float32Array, right: Float32Array) {
  const numSamples = left.length
  const numChunks = Math.ceil(numSamples / HOP_SAMPLES)
  const window = buildHannWindow(SEGMENT_SAMPLES)

  const stemData: Record<StemName, [Float32Array, Float32Array]> = {
    drums:  [new Float32Array(numSamples), new Float32Array(numSamples)],
    bass:   [new Float32Array(numSamples), new Float32Array(numSamples)],
    other:  [new Float32Array(numSamples), new Float32Array(numSamples)],
    vocals: [new Float32Array(numSamples), new Float32Array(numSamples)],
  }
  const weights = new Float32Array(numSamples)

  for (let ci = 0; ci < numChunks; ci++) {
    const offset = ci * HOP_SAMPLES

    // Build padded chunk tensor [1, 2, SEGMENT_SAMPLES]
    const chunkData = new Float32Array(2 * SEGMENT_SAMPLES)
    for (let j = 0; j < SEGMENT_SAMPLES; j++) {
      const si = offset + j
      chunkData[j] = si < numSamples ? left[si] : 0
      chunkData[SEGMENT_SAMPLES + j] = si < numSamples ? right[si] : 0
    }

    const inputTensor = new ort.Tensor('float32', chunkData, [1, 2, SEGMENT_SAMPLES])
    const results = await session!.run({ [inputName]: inputTensor })
    // Output shape: [1, 4, 2, SEGMENT_SAMPLES] — stems × channels × samples
    const outData = results[outputName].data as Float32Array

    for (let s = 0; s < 4; s++) {
      const stemName = STEMS[s]
      const leftBase = s * 2 * SEGMENT_SAMPLES
      const rightBase = s * 2 * SEGMENT_SAMPLES + SEGMENT_SAMPLES

      for (let j = 0; j < SEGMENT_SAMPLES; j++) {
        const si = offset + j
        if (si >= numSamples) break
        const w = window[j]
        stemData[stemName][0][si] += outData[leftBase + j] * w
        stemData[stemName][1][si] += outData[rightBase + j] * w
      }
    }

    for (let j = 0; j < SEGMENT_SAMPLES; j++) {
      const si = offset + j
      if (si < numSamples) weights[si] += window[j]
    }

    self.postMessage({ type: 'progress', percent: Math.round(((ci + 1) / numChunks) * 100) })
  }

  // Normalize by overlap weights
  for (const name of STEMS) {
    for (let c = 0; c < 2; c++) {
      const ch = stemData[name][c]
      for (let i = 0; i < numSamples; i++) {
        if (weights[i] > 1e-8) ch[i] /= weights[i]
      }
    }
  }

  // Transfer all Float32Array buffers back zero-copy
  const transfer: Transferable[] = []
  const result: Record<string, [Float32Array, Float32Array]> = {}
  for (const name of STEMS) {
    result[name] = stemData[name]
    transfer.push(stemData[name][0].buffer as ArrayBuffer)
    transfer.push(stemData[name][1].buffer as ArrayBuffer)
  }

  self.postMessage({ type: 'separated', result }, { transfer })
}
