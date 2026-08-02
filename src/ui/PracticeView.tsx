/**
 * Rapid fire: a prompt, an answer, immediately the next.
 *
 * The prompt is a one-bar score rendered by the ordinary layout and the user's
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
import { player } from '../audio/player'
import { exitFullscreen, keepAwake } from './screen'
import { layoutScore } from '../render/layout'
import { ScoreView } from '../render/ScoreView'
import { keyAt } from '../core/types'
import { noteName, spellPitch } from '../core/pitch'
import {
  DEFAULT_DRILL,
  generateDrill,
  barsIn,
  pitchesOf,
  summarise,
  type Attempt,
  type DrillConfig,
  type Prompt,
} from '../practice/drills'
import { LEVELS, type Level } from '../practice/levels'
import { loadProgress, recordResult, unlockedCount, type Progress } from '../practice/progress'
import { midiSupport } from '../io/midi'
import { bluetoothSupport } from '../io/blemidi'
import { MidiDoctor } from './MidiDoctor'
import { GhostNote } from './GhostNote'
import { Field, Group, Pills, Range } from './controls'
import type { Theme } from '../core/theme'

/** How long the "right" flash sits before the next prompt. */
const SETTLE_MS = 170

/**
 * How long on one step before a wrong note is shown back to you.
 *
 * Time rather than a count of mistakes, and the difference matters. Counting
 * mistakes helps whoever makes them fastest: hammer five keys in two seconds and
 * the answer appears, sit and think for eight and it does not. That is precisely
 * backwards. A clock helps the person who is stuck and gives the guesser nothing,
 * because a guesser is never stuck for four seconds.
 */
const STUCK_MS = 4000

type Stage = 'menu' | 'free' | 'running' | 'summary'

export function PracticeView() {
  const theme = useStore((s) => s.theme)
  const score = useStore((s) => s.score)
  const cvd = useStore((s) => s.cvd)
  const midi = useStore((s) => s.midi)
  const setScreen = useStore((s) => s.setScreen)
  const connectMidi = useStore((s) => s.connectMidi)
  const connectBluetooth = useStore((s) => s.connectBluetooth)

  const [stage, setStage] = useState<Stage>('menu')
  const [level, setLevel] = useState<Level | null>(null)
  const [config, setConfig] = useState<DrillConfig>(DEFAULT_DRILL)
  const [seed, setSeed] = useState(1)
  const [index, setIndex] = useState(0)
  const [step, setStep] = useState(0)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [flash, setFlash] = useState<'none' | 'right' | 'wrong'>('none')
  // The most recent wrong note on the step in front of the player, and whether
  // they have been on it long enough to be shown it.
  const [lastWrong, setLastWrong] = useState<number | null>(null)
  const [stuck, setStuck] = useState(false)
  /** Beat reached by the play-through, or null when nothing is playing. */
  const [demoBeat, setDemoBeat] = useState<number | null>(null)
  const [doctor, setDoctor] = useState(false)
  const [progress, setProgress] = useState<Progress>(() => loadProgress())

  const key = useMemo(() => keyAt(score, 0), [score])
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const prompt: Prompt | undefined = prompts[index]

  // Held keys and the wrong-note count for the prompt in front of the player.
  // Refs rather than state: they change on every key press and nothing renders
  // them, so state would mean re-rendering the score per keystroke.
  const heldRef = useRef(new Set<number>())
  const stepRef = useRef(0)
  const wrongRef = useRef(0)
  const shownAt = useRef(0)
  const settling = useRef(false)
  // Read inside the note handler, which is registered once per prompt and must
  // not close over a stale value.
  const demoing = useRef(false)
  demoing.current = demoBeat !== null
  /**
   * Ends the play-through early, from outside the effect that runs it.
   *
   * Silencing the player is not enough on its own: the frame loop that follows
   * the playhead keeps running and writes a beat straight back, so the demo
   * would go quiet and still refuse to hand over. Ending it has to stop the
   * clock as well as the sound, and only the effect holds the frame handle.
   */
  const endDemo = useRef<(() => void) | null>(null)

  const beginPrompt = useCallback(() => {
    heldRef.current = new Set()
    stepRef.current = 0
    wrongRef.current = 0
    shownAt.current = performance.now()
    settling.current = false
    setStep(0)
    setFlash('none')
    setLastWrong(null)
    setStuck(false)
  }, [])

  const startLevel = (next: Level) => {
    // The click that got here is the gesture a browser wants before it will
    // make a sound, and a demo that arrives silently is worse than none.
    void player.unlock()
    setLevel(next)
    setPrompts(next.make(key, seed))
    setAttempts([])
    setIndex(0)
    setStage('running')
    beginPrompt()
  }

  const startFree = () => {
    setLevel(null)
    setPrompts(generateDrill(config, key, seed))
    setAttempts([])
    setIndex(0)
    setStage('running')
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

  // A drill is played at the instrument, so it wants the same treatment as the
  // reading view: no chrome, and a screen that does not lock between prompts.
  useEffect(() => exitFullscreen, [])
  useEffect(keepAwake, [])

  useEffect(() => {
    if (stage !== 'running' || !prompt) return

    const stop = session.listen((note, on) => {
      if (settling.current) return

      /*
       * Playing during the play-through means "I have heard enough": stop it and
       * begin, rather than scoring a note against a prompt not yet asked for.
       *
       * The note itself is thrown away. It was played to interrupt, not to
       * answer — counting it would hand out a step nobody read if it happened to
       * be right, and a mistake nobody made if it happened to be wrong.
       */
      if (demoing.current) {
        if (!on) return
        endDemo.current?.()
        return
      }

      if (!on) {
        heldRef.current.delete(note)
        return
      }

      const steps = prompt.steps
      const current = steps[stepRef.current] ?? []
      const previous = stepRef.current > 0 ? steps[stepRef.current - 1] : []

      if (!current.includes(note)) {
        // A note from the step just finished is a re-strike, not a mistake —
        // fingers land untidily and punishing that teaches nothing.
        if (previous.includes(note)) return
        wrongRef.current += 1
        setFlash('wrong')
        setLastWrong(note)
        // The prompt stays. Getting it wrong is information, not a failure, and
        // moving on would rob the answer of the one thing it is for.
        return
      }

      heldRef.current.add(note)

      /*
       * A step is done when all of its notes are down at once — the difference
       * between reading a chord and reading three notes in a row.
       *
       * Checked only on a note that belongs to the current step, which is what
       * makes a repeated note work: with the note still held from the step
       * before, the set would already look complete, and the phrase would run
       * itself. Requiring the press to be part of this step forces a real
       * re-strike.
       */
      if (!current.every((p) => heldRef.current.has(p))) {
        setFlash('none')
        return
      }

      const next = stepRef.current + 1
      stepRef.current = next
      setStep(next)
      setLastWrong(null)
      setStuck(false)

      if (next < steps.length) {
        // Held notes are not cleared: playing a phrase legato is correct, and
        // the next step is judged on its own notes being down, not on the
        // previous ones being up.
        setFlash('none')
        return
      }

      settling.current = true
      setFlash('right')
      setAttempts((list) => [
        ...list,
        {
          promptId: prompt.id,
          pitches: pitchesOf(prompt),
          ms: Math.round(performance.now() - shownAt.current),
          wrong: wrongRef.current,
        },
      ])
      window.setTimeout(() => {
        setIndex((i) => i + 1)
        beginPrompt()
      }, SETTLE_MS)
    })

    return stop
  }, [stage, prompt, beginPrompt])

  /**
   * Play the prompt once before the attempt.
   *
   * Only for levels that ask for it — a scale or a riff has a shape, and hearing
   * a shape before reading it is how anyone learns one. Playing a single note
   * before asking which note it is would simply be the answer.
   *
   * The attempt's clock starts when the demo *ends*, not when the prompt
   * appears, or listening would count against the reader as hesitation.
   */
  useEffect(() => {
    if (stage !== 'running' || !prompt || !level?.demo) return

    let frame = 0
    let cancelled = false
    const bpm = prompt.score.tempos[0]?.bpm ?? 88

    const finish = () => {
      if (cancelled) return
      cancelled = true
      cancelAnimationFrame(frame)
      player.stop()
      endDemo.current = null
      setDemoBeat(null)
      beginPrompt()
    }

    // Reached the end on its own, or cut short by the reader — the same ending
    // either way, so the attempt starts from the same place.
    endDemo.current = finish

    setDemoBeat(0)
    player.play(prompt.score, 0, 1, finish)

    const tick = () => {
      if (cancelled) return
      setDemoBeat(player.elapsed() * (bpm / 60))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      player.stop()
      endDemo.current = null
      setDemoBeat(null)
    }
  }, [stage, prompt?.id, level, beginPrompt])

  /**
   * Let the wrong-note wash fade.
   *
   * It is a flash, and it was staying lit for as long as someone was stuck —
   * a permanent red tint under the music, competing with the ghost that arrives
   * a moment later. Being wrong should be a beat, not a state.
   */
  useEffect(() => {
    if (flash !== 'wrong') return
    const timer = window.setTimeout(() => setFlash('none'), 700)
    return () => window.clearTimeout(timer)
  }, [flash, lastWrong])

  /**
   * Start the stuck clock for each step.
   *
   * Keyed on the step as well as the prompt, so a four-note phrase gives four
   * independent chances to be helped rather than one clock running the whole bar.
   */
  useEffect(() => {
    if (stage !== 'running' || !prompt) return
    setStuck(false)
    const timer = window.setTimeout(() => setStuck(true), STUCK_MS)
    return () => window.clearTimeout(timer)
  }, [stage, prompt?.id, step])

  // A fresh prompt restarts the clock. Keyed on the prompt so a settings change
  // mid-run does not leave the timer measuring the previous one.
  useEffect(() => {
    if (stage === 'running' && prompt) beginPrompt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.id])

  // Finishing the last prompt ends the run, and a level's result is recorded.
  useEffect(() => {
    if (stage !== 'running' || prompts.length === 0 || index < prompts.length) return
    const clean = attempts.filter((a) => a.wrong === 0).length / Math.max(1, attempts.length)
    if (level) setProgress((p) => recordResult(p, level.id, clean))
    setStage('summary')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, prompts.length, stage])

  const support = midiSupport()
  const summary = useMemo(() => summarise(attempts), [attempts])
  const unlocked = unlockedCount(progress)

  /**
   * The user's theme, with the four things a drill wants differently.
   *
   * Not a different look — every colour, shape, label and notation choice is
   * theirs, because reading *their* notation is the whole exercise. Only the
   * page furniture changes: much larger, since a prompt is one bar read from a
   * stand; no bar number, since it is not a piece; unjustified, so the bar takes
   * the room it needs rather than stretching to the page; and one bar per line so
   * nothing can arrive beside it.
   */
  const bars = prompt ? barsIn(prompt) : 1
  const promptTheme = useMemo(() => {
    // Long material needs a smaller staff, or two bars of a scale will not fit
    // across a phone held in portrait.
    const laneHeight = Math.max(theme.layout.laneHeight, bars > 1 ? 10 : 13)
    // Spacing's unit is in pixels rather than staff spaces, so enlarging the
    // staff without enlarging it too would keep the old gaps and read as cramped.
    const grew = laneHeight / Math.max(1, theme.layout.laneHeight)
    return {
      ...theme,
      layout: {
        ...theme.layout,
        laneHeight,
        // However many bars the prompt is, all on one line: a prompt that wraps
        // is two prompts as far as the eye is concerned.
        barsPerSystem: bars,
        showMeasureNumbers: false,
        spacing: theme.layout.spacing
          ? { ...theme.layout.spacing, justify: 0, unit: theme.layout.spacing.unit * grew }
          : undefined,
      },
    }
  }, [theme, bars])

  // Wide enough for four quarters plus a clef, key and time signature, narrow
  // enough that an unjustified bar does not sit in an acre of nothing.
  const layout = useMemo(
    () => (prompt ? layoutScore(prompt.score, promptTheme, 300 + prompt.steps.length * 52) : null),
    [prompt, promptTheme],
  )

  /**
   * Light the steps already played.
   *
   * What has been done, not what comes next. Lighting the next note would turn
   * a reading drill into a follow-the-dot game, but showing the phrase filling
   * in behind you is the thing that makes a four-note prompt feel like progress
   * rather than four chances to fail.
   */
  const activeIds = useMemo(() => {
    const ids = new Set<string>()
    if (!prompt) return ids

    // During the play-through, light what is sounding — that is the whole point
    // of it, since the ear and the eye have to be pointed at the same note for
    // one to teach the other.
    if (demoBeat !== null) {
      for (const note of prompt.score.notes) {
        if (note.onset <= demoBeat && note.onset + note.duration > demoBeat) ids.add(note.id)
      }
      return ids
    }

    for (let i = 0; i < step; i += 1) {
      for (let j = 0; j < prompt.steps[i].length; j += 1) ids.add(`${prompt.id}-${i}-${j}`)
    }
    return ids
  }, [prompt, step, demoBeat])

  /**
   * Where the step being answered is, in the layout's coordinates.
   *
   * Taken from the placed note rather than recomputed: the ghost has to sit
   * beside the real thing, and the only way to be sure of that is to ask the
   * layout where it put it.
   */
  const stepX = useMemo(() => {
    if (!layout || !prompt) return null
    const placed = layout.systems[0]?.notes.find((n) =>
      n.note.id.startsWith(`${prompt.id}-${step}-`),
    )
    return placed ? placed.x : null
  }, [layout, prompt, step])

  const patch = (next: Partial<DrillConfig>) => {
    setConfig((c) => ({ ...c, ...next }))
  }

  const ready = support.ok && midi.connected && midi.devices.length > 0
  const passed = level ? summary.clean / Math.max(1, summary.total) >= level.pass : false

  return (
    <div className="practice" style={{ background: theme.surface.background }}>
      <header className="practice__top" style={{ color: theme.surface.text }}>
        <span className="practice__title">
          {stage === 'running' && level ? level.name : 'Rapid fire'}
        </span>
        <span className="practice__spacer" />
        {stage === 'running' && (
          <span className="practice__count">
            {index + 1} <i>/</i> {prompts.length}
          </span>
        )}
        <button
          className="read__btn read__btn--text"
          onClick={() => (stage === 'running' ? setStage('menu') : setScreen('score'))}
        >
          {stage === 'running' ? 'Stop' : 'Done'}
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
        ) : !ready ? (
          <Connect
            midi={midi}
            muted={theme.surface.muted}
            keyMark={key}
            onCable={() => void connectMidi()}
            onBluetooth={() => void connectBluetooth()}
            onDiagnose={() => setDoctor(true)}
          />
        ) : stage === 'summary' ? (
          <div className="practice__summary" style={{ color: theme.surface.text }}>
            <div className="practice__score">
              {summary.clean} <i>/</i> {summary.total}
            </div>
            <div className="practice__stat" style={{ color: theme.surface.muted }}>
              first try · {(summary.median / 1000).toFixed(2)}s typical
            </div>
            {level && (
              <div
                className={`practice__verdict${passed ? ' practice__verdict--pass' : ''}`}
                style={{ color: passed ? undefined : theme.surface.muted }}
              >
                {passed
                  ? index >= LEVELS.length - 1 || unlocked > LEVELS.indexOf(level) + 1
                    ? 'Passed'
                    : 'Passed — next level unlocked'
                  : `${Math.round(level.pass * 100)}% needed to pass`}
              </div>
            )}
            {summary.slowest.length > 0 && (
              <div className="practice__slow" style={{ color: theme.surface.muted }}>
                slowest to read:{' '}
                {summary.slowest
                  .map((s) => `${noteName(spellPitch(s.midi, key), true)} ${(s.ms / 1000).toFixed(1)}s`)
                  .join(' · ')}
              </div>
            )}
            <div className="practice__actions">
              <button
                className="pill pill--accent"
                onClick={() => {
                  setSeed((s) => s + 1)
                  if (level) startLevel(level)
                  else startFree()
                }}
              >
                Again
              </button>
              <button className="pill pill--solid" onClick={() => setStage('menu')}>
                Levels
              </button>
            </div>
          </div>
        ) : stage === 'running' && prompt && layout ? (
          <div className={`practice__prompt practice__prompt--${flash}`}>
            {/* The ghost is painted over this stack rather than added to the
                score, so the music never moves when the hint appears. */}
            <div className="prompt-stack">
              <ScoreView
                score={prompt.score}
                theme={promptTheme}
                layout={layout}
                playheadBeat={-1}
                playing={false}
                activeIds={activeIds}
                selectedId={null}
                cvd={cvd}
                onSelectNote={() => {}}
              />
              {stuck && lastWrong !== null && stepX !== null && (
                <GhostNote
                  layout={layout}
                  theme={promptTheme}
                  key={`${prompt.id}-${step}-${lastWrong}`}
                  keyMark={key}
                  x={stepX}
                  midi={lastWrong}
                  beats={prompt.steps.length === 1 ? 4 : 1}
                />
              )}
            </div>
          </div>
        ) : stage === 'free' ? (
          <FreePlay
            config={config}
            keyMark={key}
            patch={patch}
            onStart={startFree}
            onBack={() => setStage('menu')}
          />
        ) : (
          <Levels
            progress={progress}
            unlocked={unlocked}
            surface={theme.surface}
            onPick={startLevel}
            onFree={() => setStage('free')}
          />
        )}
      </div>

      {doctor && <MidiDoctor onClose={() => setDoctor(false)} />}

      {stage === 'running' && prompt && (
        <div className="practice__hint" style={{ color: theme.surface.muted }}>
          {demoBeat !== null
            ? 'listen — play any note to start'
            : prompt.steps.length > 1
            ? 'play them in order'
            : prompt.steps[0].length > 1
              ? 'play every note together'
              : 'play what you see'}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * The course.
 *
 * Every colour here comes from the score's own surface rather than the app's
 * chrome variables. The screen is painted with the page colour, so a card built
 * from --surface-2 is the dark chrome sitting on a white page — and the text on
 * it, taken from the same theme, was dark ink on a dark card and simply could not
 * be read. One screen, one palette.
 */
function Levels({
  progress,
  unlocked,
  surface,
  onPick,
  onFree,
}: {
  progress: Progress
  unlocked: number
  surface: Theme['surface']
  onPick(level: Level): void
  onFree(): void
}) {
  const card = { background: surface.panel, color: surface.text }
  return (
    <div className="levels">
      {LEVELS.map((level, i) => {
        const best = progress.best[level.id] ?? 0
        const done = best >= level.pass
        const open = i < unlocked
        return (
          <button
            key={level.id}
            className={`level${done ? ' level--done' : ''}${open ? '' : ' level--locked'}`}
            onClick={() => open && onPick(level)}
            disabled={!open}
            style={card}
          >
            <span className="level__mark" style={{ background: surface.grid }}>
              {done ? '✓' : open ? i + 1 : '·'}
            </span>
            <span className="level__body">
              <span className="level__name">{level.name}</span>
              <span className="level__goal" style={{ color: surface.muted }}>
                {open ? level.goal : 'Pass the level before this one to open it.'}
              </span>
            </span>
            {best > 0 && (
              <span className="level__best" style={{ color: surface.muted }}>
                {Math.round(best * 100)}%
              </span>
            )}
          </button>
        )
      })}

      <button className="level level--free" onClick={onFree} style={card}>
        <span className="level__mark" style={{ boxShadow: `inset 0 0 0 1px ${surface.grid}` }}>
          ∞
        </span>
        <span className="level__body">
          <span className="level__name">Free play</span>
          <span className="level__goal" style={{ color: surface.muted }}>
            Single notes or chords, your range, your settings. No passing mark.
          </span>
        </span>
      </button>
    </div>
  )
}

function FreePlay({
  config,
  keyMark,
  patch,
  onStart,
  onBack,
}: {
  config: DrillConfig
  keyMark: ReturnType<typeof keyAt>
  patch(next: Partial<DrillConfig>): void
  onStart(): void
  onBack(): void
}) {
  return (
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
              { value: 'key', label: `In ${keyLabel(keyMark)}` },
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
          display={noteName(spellPitch(config.low, keyMark), true)}
          min={36}
          max={84}
          value={config.low}
          onChange={(low) => patch({ low: Math.min(low, config.high - 4) })}
        />
        <Range
          name="Highest"
          display={noteName(spellPitch(config.high, keyMark), true)}
          min={40}
          max={96}
          value={config.high}
          onChange={(high) => patch({ high: Math.max(high, config.low + 4) })}
        />
      </Group>

      <div className="practice__actions">
        <button className="pill pill--accent" onClick={onStart}>
          Start
        </button>
        <button className="pill pill--solid" onClick={onBack}>
          Levels
        </button>
      </div>
    </div>
  )
}

function Connect({
  midi,
  muted,
  keyMark,
  onCable,
  onBluetooth,
  onDiagnose,
}: {
  midi: ReturnType<typeof useStore.getState>['midi']
  muted: string
  keyMark: ReturnType<typeof keyAt>
  onCable(): void
  onBluetooth(): void
  onDiagnose(): void
}) {
  return (
    <div className="practice__intro">
      <p className="practice__note" style={{ color: muted }}>
        {midi.connected
          ? 'Connected, but no keyboard is sending anything.'
          : 'Connect a keyboard and play what you see. Prompts are drawn in your own style, so this is practice at reading the notation you designed.'}
      </p>

      {/* The one readout that separates "not connected" from "connected and
          silent". Everything else only reacts to a note that matches something,
          so none of it can tell those apart. */}
      {midi.connected && (
        <p className="practice__note" style={{ color: muted }}>
          {midi.noteCount > 0
            ? `${midi.noteCount} notes received — last was ${noteName(spellPitch(midi.lastNote ?? 60, keyMark), true)}`
            : 'Nothing received yet. Over USB this works straight away; over Bluetooth, Android’s own pairing screen does not switch MIDI on, so the piano has to be connected from inside an app.'}
        </p>
      )}

      <div className="practice__actions">
        <button className="pill pill--accent" onClick={onCable}>
          {midi.connected ? 'Look again' : 'Connect by cable'}
        </button>
        {bluetoothSupport().ok && (
          <button className="pill pill--solid" onClick={onBluetooth}>
            Bluetooth
          </button>
        )}
        <button className="pill pill--solid" onClick={onDiagnose}>
          Diagnose
        </button>
      </div>
    </div>
  )
}

function keyLabel(key: { fifths: number; mode: 'major' | 'minor' }): string {
  const majors = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯']
  const flats = ['C', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭']
  const name = key.fifths >= 0 ? majors[Math.min(7, key.fifths)] : flats[Math.min(7, -key.fifths)]
  return key.mode === 'minor' ? `${name} minor` : name
}
