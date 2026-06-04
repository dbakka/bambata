import type { Track } from '../types/party'

interface TrackLibraryProps {
  tracks: Track[]
  onRemove?: (trackId: string) => void
  showSwipeCounts?: boolean
  showQueuePosition?: boolean
}

export function TrackLibrary({
  tracks,
  onRemove,
  showSwipeCounts = false,
  showQueuePosition = false,
}: TrackLibraryProps) {
  if (tracks.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 font-mono text-sm">
        No tracks yet. Add tracks to get started.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {tracks.map((track) => (
        <div
          key={track.id}
          className="flex items-center gap-3 p-3 rounded-lg"
          style={{ background: '#0f0f17', border: '1px solid #1e1e2e' }}
        >
          {showQueuePosition && track.queue_position != null && (
            <span
              className="text-xs font-mono w-6 text-center font-bold"
              style={{ color: '#00d2ff' }}
            >
              {track.queue_position}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-200 truncate">{track.title}</span>
              <span className="text-xs text-slate-500 truncate">{track.artist}</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              {track.bpm && (
                <span className="text-xs font-mono" style={{ color: '#475569' }}>
                  {track.bpm} BPM
                </span>
              )}
              {track.musical_key && (
                <span className="text-xs font-mono" style={{ color: '#475569' }}>
                  {track.musical_key}
                </span>
              )}
              {track.energy != null && (
                <span className="text-xs font-mono" style={{ color: '#ff6b35' }}>
                  E{track.energy.toFixed(1)}
                </span>
              )}
            </div>
          </div>
          {showSwipeCounts && (
            <div className="flex items-center gap-1">
              <span
                className="text-xs font-bold font-mono px-2 py-1 rounded"
                style={{ background: '#1e1e2e', color: '#a78bfa' }}
              >
                {track.swipe_count} ↑
              </span>
            </div>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(track.id)}
              className="text-slate-600 hover:text-red-400 transition-colors ml-1 flex-shrink-0"
              title="Remove track"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
