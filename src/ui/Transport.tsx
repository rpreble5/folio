import { useStore } from '../state/store'
import { beatToSeconds, beatsPerMeasure, timeSignatureAt } from '../core/types'
import { player } from '../audio/player'
import { Slider } from './controls'

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
  const bpm = Math.round((score.tempos[0]?.bpm ?? 100) * tempoScale)

  const toggle = () => {
    if (playing) {
      player.stop()
      setPlaying(false)
      return
    }
    if (playheadBeat >= score.length - 1e-6) setPlayhead(0)
    setPlaying(true)
  }

  return (
    <div className="transport">
      <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
            <rect width="3.6" height="13" rx="1.1" />
            <rect x="7.4" width="3.6" height="13" rx="1.1" />
          </svg>
        ) : (
          <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor">
            <path d="M1.2 1.05a.9.9 0 0 1 1.37-.77l8.2 5.2a.9.9 0 0 1 0 1.53l-8.2 5.2a.9.9 0 0 1-1.37-.76Z" />
          </svg>
        )}
      </button>

      <div className="transport__scrub">
        <Slider
          label="Position"
          min={0}
          max={Math.max(score.length, 1)}
          step={0.05}
          value={Math.min(playheadBeat, score.length)}
          onChange={(beat) => {
            // Scrubbing stops playback; the schedule is built once at play time,
            // so resuming from a new point means starting a fresh one.
            if (playing) {
              player.stop()
              setPlaying(false)
            }
            setPlayhead(beat)
          }}
        />
      </div>

      <div className="transport__readout">
        {formatTime(elapsed)} / {formatTime(total)}
      </div>

      <div className="transport__readout">
        bar {Math.min(bar, totalBars)} of {totalBars}
      </div>

      <div className="transport__readout" style={{ minWidth: 52 }}>
        {bpm} bpm
      </div>

      <div className="transport__tempo">
        <Slider
          label="Tempo"
          min={0.4}
          max={1.4}
          step={0.05}
          value={tempoScale}
          onChange={(next) => {
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
