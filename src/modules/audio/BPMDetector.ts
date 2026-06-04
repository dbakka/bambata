export function detectBPM(audioBuffer: AudioBuffer): number {
  const channelData = audioBuffer.getChannelData(0)
  const sampleRate = audioBuffer.sampleRate

  const downsampleFactor = Math.max(1, Math.floor(sampleRate / 22050))
  const downsampled = new Float32Array(Math.floor(channelData.length / downsampleFactor))
  for (let i = 0; i < downsampled.length; i++) {
    downsampled[i] = channelData[i * downsampleFactor]
  }
  const dsr = sampleRate / downsampleFactor

  const frameSize = 1024
  const hopSize = 512
  const numFrames = Math.floor((downsampled.length - frameSize) / hopSize)

  if (numFrames < 10) return 120

  const onsetStrength = new Float32Array(numFrames)
  let prevEnergy = 0
  for (let i = 0; i < numFrames; i++) {
    let energy = 0
    const start = i * hopSize
    for (let j = start; j < start + frameSize && j < downsampled.length; j++) {
      energy += downsampled[j] * downsampled[j]
    }
    energy /= frameSize
    onsetStrength[i] = Math.max(0, energy - prevEnergy)
    prevEnergy = energy
  }

  const minBPM = 60
  const maxBPM = 200
  const minPeriod = Math.round((60 / maxBPM) * dsr / hopSize)
  const maxPeriod = Math.round((60 / minBPM) * dsr / hopSize)

  let bestPeriod = minPeriod
  let bestScore = -Infinity

  for (let period = minPeriod; period <= maxPeriod; period++) {
    let score = 0
    const limit = onsetStrength.length - period
    for (let i = 0; i < limit; i++) {
      score += onsetStrength[i] * onsetStrength[i + period]
    }
    if (score > bestScore) {
      bestScore = score
      bestPeriod = period
    }
  }

  const bpm = (60 * dsr) / (bestPeriod * hopSize)

  if (bpm < 60) return bpm * 2
  if (bpm > 200) return bpm / 2
  return Math.round(bpm * 10) / 10
}
