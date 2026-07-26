import { useStore } from '../state/store'
import { beatToSeconds, beatsPerMeasure, timeSignatureAt } from '../core/types'
import { player } from '../audio/player'

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function Transport() {
  const score = useStore((s) => s.score)
  const playing = useStore((s) => s.playing)
  const playheadBeat = useStore((s) => s.playheadBeat)
  const tempoScale = useStore((s) => s.tempoScale)
  const setPlaying = useStore((s) => s.setPlaying)
  const setPlayhead = useStore((s) => s.setPlayhead)
  const setTempoScale = useStore((s) => s.setTempoScale)

  const barLength = beatsPerMeasure(timeSignatureAt(score, playheadBeat))
  const bar = Math.floor(playheadBeat / barLength) + 1
  const totalBars = Math.max(1, Math.ceil(score.length / barLength))

  const elapsed = beatToSeconds(score, playheadBeat) / tempoScale
  const total = beatToSeconds(score, score.length) / tempoScale

  const toggle = () => {
    if (playing) {
      player.stop()
      setPlaying(false)
    } else {
      // Restart from the top if we are sitting at the end.
      if (playheadBeat >= score.length - 1e-6) setPlayhead(0)
      setPlaying(true)
    }
  }

  return (
    <div className="transport">
      <button
        className="transport__play"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (space)' : 'Play (space)'}
      >
        {playing ? (
          <svg width="13" height="14" viewBox="0 0 13 14" fill="currentColor">
            <rect x="0" y="0" width="4.5" height="14" rx="1.2" />
            <rect x="8.5" y="0" width="4.5" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg width="14" height="15" viewBox="0 0 14 15" fill="currentColor">
            <path d="M1.5 1.2a1 1 0 0 1 1.52-.85l9.4 5.8a1 1 0 0 1 0 1.7l-9.4 5.8a1 1 0 0 1-1.52-.85Z" />
          </svg>
        )}
      </button>

      <div className="transport__scrub">
        <input
          type="range"
          min={0}
          max={Math.max(score.length, 1)}
          step={0.05}
          value={Math.min(playheadBeat, score.length)}
          aria-label="Position"
          onChange={(e) => {
            const beat = Number(e.target.value)
            // Scrubbing while playing restarts the schedule from the new point,
            // which the playback effect handles when it sees the beat jump.
            if (playing) player.stop()
            setPlayhead(beat)
            if (playing) setPlaying(false)
          }}
        />
      </div>

      <div className="transport__time">
        {formatTime(elapsed)} / {formatTime(total)}
      </div>

      <div className="transport__time" style={{ minWidth: 68 }}>
        bar {Math.min(bar, totalBars)}/{totalBars}
      </div>

      <div className="transport__tempo">
        <span>{Math.round((score.tempos[0]?.bpm ?? 100) * tempoScale)} bpm</span>
        <input
          type="range"
          min={0.4}
          max={1.4}
          step={0.05}
          value={tempoScale}
          aria-label="Tempo"
          onChange={(e) => {
            const next = Number(e.target.value)
            if (playing) {
              player.stop()
              setPlaying(false)
            }
            setTempoScale(next)
          }}
        />
      </div>
    </div>
  )
}
