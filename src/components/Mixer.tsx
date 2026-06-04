import { useDJStore } from '../store/djStore'

export function Mixer() {
  const crossfader = useDJStore((s) => s.mixer.crossfader)
  const masterVolume = useDJStore((s) => s.mixer.masterVolume)
  const setCrossfader = useDJStore((s) => s.setCrossfader)
  const setMasterVolume = useDJStore((s) => s.setMasterVolume)

  return (
    <div
      className="flex flex-col items-center gap-6 px-4 py-6 rounded-xl border"
      style={{ background: '#111118', borderColor: '#2a2a3a', minWidth: '140px' }}
    >
      <span className="text-xs font-mono font-bold tracking-widest" style={{ color: '#6a6a8a' }}>
        MIXER
      </span>

      {/* Master volume */}
      <div className="flex flex-col items-center gap-1">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
          className="h-24 appearance-none cursor-pointer"
          style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: '#a78bfa' }}
        />
        <span className="text-[9px] font-mono" style={{ color: '#6a6a8a' }}>MASTER</span>
        <span className="text-[9px] font-mono" style={{ color: '#a78bfa' }}>
          {Math.round(masterVolume * 100)}%
        </span>
      </div>

      {/* VU meter placeholder */}
      <div className="flex gap-1">
        {[...Array(2)].map((_, col) => (
          <div key={col} className="flex flex-col gap-[2px]">
            {[...Array(8)].map((_, row) => (
              <div
                key={row}
                className="w-2 h-2 rounded-sm"
                style={{
                  background: row < 2 ? '#ef4444' : row < 4 ? '#facc15' : '#22c55e',
                  opacity: 0.2 + Math.random() * 0.6,
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Crossfader */}
      <div className="flex flex-col items-center gap-2 w-full">
        <div className="flex justify-between w-full px-1">
          <span className="text-[9px] font-mono" style={{ color: '#00d2ff' }}>A</span>
          <span className="text-[9px] font-mono" style={{ color: '#ff6b35' }}>B</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={crossfader}
          onChange={(e) => setCrossfader(parseFloat(e.target.value))}
          className="w-full cursor-pointer"
          style={{ accentColor: '#a78bfa' }}
        />
        <span className="text-[9px] font-mono" style={{ color: '#6a6a8a' }}>XFADER</span>
      </div>
    </div>
  )
}
