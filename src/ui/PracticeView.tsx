/**
 * Rapid fire: a prompt, an answer, immediately the next.
 *
 * The prompt is a one-note score rendered by the ordinary layout and the user's
 * own theme, which is the entire point — someone who has coloured by pitch class
 * and dropped the letter labels needs practice reading *that*, and no
 * general-purpose trainer can give it to them.
 *
 * Two things are deliberately absent. There is no countdown and no timer on
 * screen: a clock makes people rush, and rushing measures panic rather than
 * fluency. And a wrong note costs nothing but the prompt staying put — no buzzer,
 * no penalty screen. The mission is to make music less intimidating, and a drill
 * that punishes is a drill people stop opening.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { session, useStore } from '../state/store'
import { layoutScore } from '../render/layout'
import { ScoreView } from '../render/ScoreView'
import { keyAt } from '../core/types'
import { noteName } from '../core/pitch'
import { spellPitch } from '../core/pitch'
import {
  DEFAULT_DRILL,
  generateDrill,
  summarise,
  type Attempt,
  type DrillConfig,
  type Prompt,
} from '../practice/drills'
import { midiSupport } from '../io/midi'
import { MidiDoctor } from './MidiDoctor'
import { Field, Group, Pills, Range } from './controls'

/** How long the "right" flash sits before the next prompt. */
const SETTLE_MS = 170

export function PracticeView() {
  const theme = useStore((s) => s.theme)
  const score = useStore((s) => s.score)
  const cvd = useStore((s) => s.cvd)
  const midi = useStore((s) => s.midi)
  const setScreen = useStore((s) => s.setScreen)
  const connectMidi = useStore((s) => s.connectMidi)

  const [config, setConfig] = useState<DrillConfig>(DEFAULT_DRILL)
  const [seed, setSeed] = useState(1)
  const [index, setIndex] = useState(0)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [flash, setFlash] = useState<'none' | 'right' | 'wrong'>('none')
  const [running, setRunning] = useState(false)
  const [doctor, setDoctor] = useState(false)

  const key = useMemo(() => keyAt(score, 0), [score])
  const prompts = useMemo(
    () => generateDrill(config, key, seed),
    [config, key, seed],
  )
  const prompt: Prompt | undefined = prompts[index]
  const done = running && index >= prompts.length

  // Held keys and wrong-note count for the prompt in front of the player. Refs
  // rather than state: they change on every key press and nothing renders them
  // directly, so putting them in state would re-render the score per keystroke.
  const heldRef = useRef(new Set<number>())
  const wrongRef = useRef(0)
  const shownAt = useRef(0)
  const settling = useRef(false)

  const beginPrompt = useCallback(() => {
    heldRef.current = new Set()
    wrongRef.current = 0
    shownAt.current = performance.now()
    settling.current = false
    setFlash('none')
  }, [])

  const start = () => {
    setAttempts([])
    setIndex(0)
    setRunning(true)
    beginPrompt()
  }

  const again = () => {
    setSeed((s) => s + 1)
    setAttempts([])
    setIndex(0)
    setRunning(true)
    beginPrompt()
  }

  /**
   * A drill takes the keyboard raw.
   *
   * The follower must not run here: a prompt has nothing to do with where the
   * piece being read has got to, and letting it advance would leave the reading
   * view somewhere random by the time the drill ends.
   */
  useEffect(() => {
    session.setMode('raw')
    return () => session.setMode('follow')
  }, [])

  useEffect(() => {
    if (!running || !prompt) return

    const wanted = new Set(prompt.pitches)

    const stop = session.listen((note, on) => {
      if (settling.current) return

      if (!on) {
        heldRef.current.delete(note)
        return
      }
      if (heldRef.current.has(note)) return
      heldRef.current.add(note)

      if (!wanted.has(note)) {
        wrongRef.current += 1
        setFlash('wrong')
        // The prompt stays. Getting it wrong is information, not a failure, and
        // moving on would rob the answer of the one thing it is for.
        return
      }

      // Every note of the chord has to be down at once, which is the difference
      // between reading a chord and reading three notes in a row.
      const complete = prompt.pitches.every((p) => heldRef.current.has(p))
      if (!complete) {
        setFlash('none')
        return
      }

      settling.current = true
      setFlash('right')
      const attempt: Attempt = {
        promptId: prompt.id,
        pitches: prompt.pitches,
        ms: Math.round(performance.now() - shownAt.current),
        wrong: wrongRef.current,
      }
      setAttempts((list) => [...list, attempt])
      window.setTimeout(() => {
        setIndex((i) => i + 1)
        beginPrompt()
      }, SETTLE_MS)
    })

    return stop
  }, [running, prompt, beginPrompt])

  // A fresh prompt restarts the clock. Keyed on the prompt itself so a config
  // change mid-run does not leave the timer measuring the previous one.
  useEffect(() => {
    if (running && prompt) beginPrompt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.id])

  const support = midiSupport()
  const summary = useMemo(() => summarise(attempts), [attempts])

  /**
   * The user's theme, with the four things a drill wants differently.
   *
   * Not a different look — every colour, shape, label and notation choice is
   * theirs, because reading *their* notation is the whole exercise. Only the
   * page furniture changes:
   *
   *   - Much larger. A prompt is read from a music stand at arm's length, and it
   *     is one note; there is no reason for it to be score-sized.
   *   - No bar number. There is one bar and it is not a piece.
   *   - Unjustified. Justification stretches a bar to the page width, which for
   *     one whole note means the note at the far left of an empty acre.
   *   - One bar per line, so nothing else can arrive beside it.
   */
  const promptTheme = useMemo(() => {
    const laneHeight = Math.max(theme.layout.laneHeight, 13)
    // Spacing's unit is in pixels rather than staff spaces, so enlarging the
    // staff without enlarging it too would keep the gaps at their old size and
    // read as cramped. Scale it by the same factor the staff grew by.
    const grew = laneHeight / Math.max(1, theme.layout.laneHeight)
    return {
      ...theme,
      layout: {
        ...theme.layout,
        laneHeight,
        barsPerSystem: 1,
        showMeasureNumbers: false,
        spacing: theme.layout.spacing
          ? { ...theme.layout.spacing, justify: 0, unit: theme.layout.spacing.unit * grew }
          : undefined,
      },
    }
  }, [theme])

  // Narrow, so an unjustified bar takes the room it needs rather than the room
  // it was given — but not so narrow that the clef, key and time signature have
  // to share space with the note they are supposed to precede.
  const layout = useMemo(
    () => (prompt ? layoutScore(prompt.score, promptTheme, 330) : null),
    [prompt, promptTheme],
  )

  const patch = (next: Partial<DrillConfig>) => {
    setConfig((c) => ({ ...c, ...next }))
    setRunning(false)
    setAttempts([])
    setIndex(0)
  }

  return (
    <div className="practice" style={{ background: theme.surface.background }}>
      <header className="practice__top" style={{ color: theme.surface.text }}>
        <span className="practice__title">Rapid fire</span>
        <span className="practice__spacer" />
        {running && !done && (
          <span className="practice__count">
            {index + 1} <i>/</i> {prompts.length}
          </span>
        )}
        <button className="read__btn read__btn--text" onClick={() => setScreen('score')}>
          Done
        </button>
      </header>

      <div className="practice__stage">
        {!support.ok ? (
          <div className="practice__intro">
            <p className="practice__note" style={{ color: theme.surface.muted }}>
              {support.reason}
            </p>
            <button className="pill pill--solid" onClick={() => setDoctor(true)}>
              Diagnose
            </button>
          </div>
        ) : !midi.connected || midi.devices.length === 0 ? (
          <div className="practice__intro">
            <p className="practice__note" style={{ color: theme.surface.muted }}>
              {midi.connected
                ? 'Connected, but no keyboard is sending anything.'
                : 'Connect a keyboard and play what you see. Prompts are drawn in your own style, so this is practice at reading the notation you designed.'}
            </p>

            {/* The one readout that separates "not connected" from "connected
                and silent". Everything else in the app only reacts to a note
                that matches something, so none of it can tell those apart. */}
            {midi.connected && (
              <p className="practice__note" style={{ color: theme.surface.muted }}>
                {midi.noteCount > 0
                  ? `${midi.noteCount} notes received — last was ${noteName(spellPitch(midi.lastNote ?? 60, key), true)}`
                  : 'Nothing received yet. Over USB this works straight away; over Bluetooth, Android’s own pairing screen does not switch MIDI on, so the piano has to be connected from inside an app.'}
              </p>
            )}

            <div className="practice__actions">
              <button className="pill pill--accent" onClick={() => void connectMidi()}>
                {midi.connected ? 'Look again' : 'Connect keyboard'}
              </button>
              <button className="pill pill--solid" onClick={() => setDoctor(true)}>
                Diagnose
              </button>
            </div>
          </div>
        ) : done ? (
          <div className="practice__summary" style={{ color: theme.surface.text }}>
            <div className="practice__score">
              {summary.clean} <i>/</i> {summary.total}
            </div>
            <div className="practice__stat" style={{ color: theme.surface.muted }}>
              first try · {(summary.median / 1000).toFixed(2)}s typical
            </div>
            {summary.slowest.length > 0 && (
              <div className="practice__slow" style={{ color: theme.surface.muted }}>
                slowest to read:{' '}
                {summary.slowest
                  .map((s) => `${noteName(spellPitch(s.midi, key), true)} ${(s.ms / 1000).toFixed(1)}s`)
                  .join(' · ')}
              </div>
            )}
            <div className="practice__actions">
              <button className="pill pill--accent" onClick={again}>
                Again
              </button>
              <button className="pill pill--solid" onClick={() => setRunning(false)}>
                Change settings
              </button>
            </div>
          </div>
        ) : running && prompt && layout ? (
          <div className={`practice__prompt practice__prompt--${flash}`}>
            <ScoreView
              score={prompt.score}
              theme={promptTheme}
              layout={layout}
              playheadBeat={-1}
              playing={false}
              activeIds={new Set()}
              selectedId={null}
              cvd={cvd}
              onSelectNote={() => {}}
            />
          </div>
        ) : (
          <div className="practice__setup">
            <Group label="What to read">
              <Field name="Prompt">
                <Pills
                  fill
                  options={[
                    { value: 'note', label: 'Single notes' },
                    { value: 'chord', label: 'Chords' },
                  ]}
                  value={config.kind}
                  onChange={(kind) => patch({ kind })}
                />
              </Field>
              <Field name="Hand">
                <Pills
                  fill
                  options={[
                    { value: 'right', label: 'Right' },
                    { value: 'left', label: 'Left' },
                    { value: 'both', label: 'Both' },
                  ]}
                  value={config.hands}
                  onChange={(hands) => patch({ hands })}
                />
              </Field>
              <Field name="Notes">
                <Pills
                  fill
                  options={[
                    { value: 'key', label: `In ${keyLabel(key)}` },
                    { value: 'all', label: 'All twelve' },
                  ]}
                  value={config.inKey ? 'key' : 'all'}
                  onChange={(v) => patch({ inKey: v === 'key' })}
                />
              </Field>
            </Group>

            <Group label="How much">
              <Range
                name="Prompts"
                display={`${config.length}`}
                min={5}
                max={60}
                value={config.length}
                onChange={(length) => patch({ length })}
              />
              {config.kind === 'chord' && (
                <Range
                  name="Notes per chord"
                  display={`${config.chordSize}`}
                  min={2}
                  max={5}
                  value={config.chordSize}
                  onChange={(chordSize) => patch({ chordSize })}
                />
              )}
              <Range
                name="Lowest"
                display={noteName(spellPitch(config.low, key), true)}
                min={36}
                max={84}
                value={config.low}
                onChange={(low) => patch({ low: Math.min(low, config.high - 4) })}
              />
              <Range
                name="Highest"
                display={noteName(spellPitch(config.high, key), true)}
                min={40}
                max={96}
                value={config.high}
                onChange={(high) => patch({ high: Math.max(high, config.low + 4) })}
              />
            </Group>

            <div className="practice__actions">
              <button className="pill pill--accent" onClick={start}>
                Start
              </button>
            </div>
          </div>
        )}
      </div>

      {doctor && <MidiDoctor onClose={() => setDoctor(false)} />}

      {running && !done && (
        <div className="practice__hint" style={{ color: theme.surface.muted }}>
          {config.kind === 'chord' ? 'play every note together' : 'play what you see'}
        </div>
      )}
    </div>
  )
}

function keyLabel(key: { fifths: number; mode: 'major' | 'minor' }): string {
  const majors = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯']
  const flats = ['C', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭']
  const name = key.fifths >= 0 ? majors[Math.min(7, key.fifths)] : flats[Math.min(7, -key.fifths)]
  return key.mode === 'minor' ? `${name} minor` : name
}
