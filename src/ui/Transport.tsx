import { useStore } from '../state/store'
import { beatToSeconds, beatsPerMeasure, timeSignatureAt } from '../core/types'
import { player } from '../audio/player'
import { Slider } from './controls'
import { midiSupport } from '../io/midi'

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
  const midi = useStore((s) => s.midi)
  const connectMidi = useStore((s) => s.connectMidi)
  const disconnectMidi = useStore((s) => s.disconnectMidi)
  const setFollowing = useStore((s) => s.setFollowing)
  const support = midiSupport()

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

      {/* Hidden entirely where MIDI cannot work, rather than shown disabled: a
          greyed button on an iPad invites a tap that can only ever fail, and the
          reason is the browser, which the player cannot do anything about. */}
      {support.ok && (
        <button
          className={`keyboard-btn${midi.connected ? ' keyboard-btn--live' : ''}`}
          onClick={() => (midi.connected ? disconnectMidi() : void connectMidi())}
          disabled={midi.connecting}
          title={
            midi.error ??
            (midi.connected
              ? `${midi.devices.map((d) => d.name).join(', ') || 'No inputs'} · ${midi.noteCount} notes received`
              : 'Play along and your notes light up')
          }
        >
          <span className="keyboard-btn__dot" />
          {midi.connecting
            ? 'Connecting…'
            : !midi.connected
              ? 'Keyboard'
              : // Connected with nothing on the other end is its own state, and
                // it was being reported as "Listening" — which is true, and is
                // exactly the wrong thing to say to someone whose keyboard is
                // not working.
                midi.devices.length === 0
                ? 'No keyboard found'
                : (midi.devices[0]?.name ?? 'Keyboard')}
        </button>
      )}

      {midi.connected && (
        <button
          className={`keyboard-btn${midi.following ? ' keyboard-btn--live' : ''}`}
          onClick={() => setFollowing(!midi.following)}
          title="Let your playing move the position, so the reading view turns itself"
        >
          {midi.following ? 'Following' : 'Follow off'}
        </button>
      )}

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
