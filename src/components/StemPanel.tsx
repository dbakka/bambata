import { useRef, useState } from 'react'
import { useDJStore } from '../store/djStore'
import type { StemName, DeckId } from '../types'

const STEM_COLORS: Record<StemName, string> = {
  drums:  '#f472b6',
  bass:   '#fb923c',
  other:  '#a78bfa',
  vocals: '#34d399',
}

const STEM_ICONS: Record<StemName, string> = {
  drums:  '🥁',
  bass:   '🎸',
  other:  '🎹',
  vocals: '🎤',
}

const STEMS: StemName[] = ['drums', 'bass', 'other', 'vocals']

export function StemPanel() {
  const modelInputRef = useRef<HTMLInputElement>(null)
  const [isOpen, setIsOpen] = useState(true)
  const [separatingDeck, setSeparatingDeck] = useState<DeckId | null>(null)
  const [error, setError] = useState('')

  const stems = useDJStore((s) => s.stems)
  const deckA = useDJStore((s) => s.deckA)
  const deckB = useDJStore((s) => s.deckB)
  const loadStemModel = useDJStore((s) => s.loadStemModel)
  const separateStems = useDJStore((s) => s.separateStems)
  const setStemMode = useDJStore((s) => s.setStemMode)
  const setStemGain = useDJStore((s) => s.setStemGain)

  const handleModelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    try {
      await loadStemModel(file)
    } catch (err) {
      setError(String(err))
    }
    if (modelInputRef.current) modelInputRef.current.value = ''
  }

  const handleSeparate = async (deck: DeckId) => {
    setError('')
    setSeparatingDeck(deck)
    try {
      await separateStems(deck)
    } catch (err) {
      setError(String(err))
    }
    setSeparatingDeck(null)
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: '#111118', borderColor: '#2a2a3a' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer"
        style={{ background: '#0a0a0f' }}
        onClick={() => setIsOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-bold tracking-widest" style={{ color: '#6a6a8a' }}>
            STEM SEPARATION
          </span>
          <ModelStatus loaded={stems.isModelLoaded} cached={stems.isModelCached} />
        </div>
        <span className="text-[10px]" style={{ color: '#6a6a8a' }}>{isOpen ? '▲' : '▼'}</span>
      </div>

      {isOpen && (
        <div className="p-4 flex flex-col gap-4">
          {/* Model load section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => modelInputRef.current?.click()}
                className="text-xs font-mono px-3 py-1.5 rounded border transition-colors"
                style={{ borderColor: '#a78bfa40', color: '#a78bfa', background: '#a78bfa15' }}
              >
                {stems.isModelLoaded ? 'REPLACE MODEL' : 'LOAD MODEL (.onnx)'}
              </button>
              <input
                ref={modelInputRef}
                type="file"
                accept=".onnx"
                className="hidden"
                onChange={handleModelFile}
              />
              {stems.isModelCached && !stems.isModelLoaded && (
                <span className="text-xs font-mono" style={{ color: '#facc15' }}>
                  Cached model found — reload page to use it
                </span>
              )}
              {stems.isModelLoaded && (
                <span className="text-xs font-mono" style={{ color: '#22c55e' }}>
                  Model ready
                </span>
              )}
            </div>

            {!stems.isModelLoaded && (
              <ModelInstructions />
            )}

            {error && (
              <div className="text-xs font-mono px-3 py-2 rounded" style={{ background: '#ef444415', color: '#ef4444' }}>
                {error}
              </div>
            )}
          </div>

          {/* Deck separation buttons */}
          <div className="flex gap-4">
            {(['A', 'B'] as DeckId[]).map((deck) => {
              const deckState = deck === 'A' ? deckA : deckB
              const hasStems = deck === 'A' ? stems.hasStemsA : stems.hasStemsB
              const stemMode = deck === 'A' ? stems.steamModeA : stems.steamModeB
              const color = deck === 'A' ? '#00d2ff' : '#ff6b35'
              const isSep = separatingDeck === deck

              return (
                <div
                  key={deck}
                  className="flex-1 flex flex-col gap-2 p-3 rounded-lg border"
                  style={{ borderColor: color + '30', background: color + '08' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold" style={{ color }}>
                      DECK {deck}
                    </span>
                    {hasStems && (
                      <button
                        onClick={() => setStemMode(deck, !stemMode)}
                        className="text-[10px] font-mono px-2 py-0.5 rounded border"
                        style={{
                          borderColor: stemMode ? color + 'cc' : color + '30',
                          color: stemMode ? '#000' : color,
                          background: stemMode ? color : 'transparent',
                        }}
                      >
                        {stemMode ? 'STEMS ON' : 'STEMS OFF'}
                      </button>
                    )}
                  </div>

                  {!deckState.isLoaded ? (
                    <span className="text-[10px] font-mono" style={{ color: '#3a3a5a' }}>
                      No track loaded
                    </span>
                  ) : isSep ? (
                    <ProgressBar percent={stems.progress} color={color} />
                  ) : hasStems ? (
                    <span className="text-[10px] font-mono" style={{ color: '#22c55e' }}>
                      Stems ready — toggle above to use
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSeparate(deck)}
                      disabled={!stems.isModelLoaded || stems.isProcessing}
                      className="text-[10px] font-mono px-3 py-1.5 rounded border w-full transition-colors disabled:opacity-30"
                      style={{ borderColor: color + '40', color }}
                    >
                      SEPARATE STEMS
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Stem gain controls */}
          {(stems.hasStemsA || stems.hasStemsB) && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-mono tracking-widest" style={{ color: '#6a6a8a' }}>
                STEM MIX
              </span>
              <div className="flex gap-4">
                {STEMS.map((stem) => (
                  <StemFader
                    key={stem}
                    stem={stem}
                    value={stems.gains[stem]}
                    onChange={(v) => setStemGain(stem, v)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ModelStatus({ loaded, cached }: { loaded: boolean; cached: boolean }) {
  const color = loaded ? '#22c55e' : cached ? '#facc15' : '#3a3a5a'
  const label = loaded ? 'LOADED' : cached ? 'CACHED' : 'NO MODEL'
  return (
    <span
      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
      style={{ background: color + '20', color }}
    >
      {label}
    </span>
  )
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="w-full rounded-full overflow-hidden" style={{ background: '#1a1a25', height: 6 }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
      <span className="text-[10px] font-mono" style={{ color }}>
        Processing… {percent.toFixed(0)}%
      </span>
    </div>
  )
}

function StemFader({ stem, value, onChange }: {
  stem: StemName
  value: number
  onChange: (v: number) => void
}) {
  const color = STEM_COLORS[stem]
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <span className="text-base">{STEM_ICONS[stem]}</span>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-20 appearance-none cursor-pointer"
        style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: color }}
      />
      <span className="text-[9px] font-mono uppercase" style={{ color: '#6a6a8a' }}>{stem}</span>
      <span className="text-[9px] font-mono" style={{ color }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

function ModelInstructions() {
  return (
    <div
      className="text-[10px] font-mono p-3 rounded-lg leading-relaxed"
      style={{ background: '#0a0a0f', color: '#6a6a8a', border: '1px solid #1a1a25' }}
    >
      <div className="mb-1" style={{ color: '#a78bfa' }}>Load the Demucs ONNX model:</div>
      <div style={{ color: '#ccc' }}>demucs.onnx is already in the project root (341 MB).</div>
      <div>Click LOAD MODEL and select it — or run the export script to regenerate it:</div>
      <div className="mt-1" style={{ color: '#facc15' }}>python3 scripts/setup-demucs-onnx.py</div>
      <div className="mt-1" style={{ color: '#3a3a5a' }}>
        Model architecture: Demucs v3 (time-domain, 8s segments, 4-stem).
        Cached in IndexedDB after first load — works fully offline.
      </div>
    </div>
  )
}
