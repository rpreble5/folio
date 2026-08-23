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
  notesOf,
  pitchesOf,
  summarise,
  type Attempt,
  type DrillConfig,
  type Prompt,
} from '../practice/drills'
import { buildRun, type Scored } from '../practice/adapt'
import { buildSession, canPlanSession } from '../practice/plan'
import { commonSlips, mostMissed, slowestNotes, type History } from '../practice/history'
import { weanRules, withWeaning } from '../practice/weaning'
import { LEVELS, LEVEL_GROUPS, type Level, type LevelGroup } from '../practice/levels'
import {
  isPassed,
  loadProgress,
  recordResult,
  unlockedCount,
  type Progress,
} from '../practice/progress'
import { loadTempo, saveTempo, stepTempo, TEMPI } from '../practice/settings'
import { midiSupport } from '../io/midi'
import { bluetoothSupport } from '../io/blemidi'
import { MidiDoctor } from './MidiDoctor'
import { GhostNote } from './GhostNote'
import { Field, Group, Pills, Range } from './controls'
import type { Theme } from '../core/theme'

/**
 * How long the "right" flash sits before the next prompt.
 *
 * Also the window the hand-off animation gets: the answered bar spends it
 * leaving, so the pause is doing two jobs rather than being dead time with a
 * cut at the end of it.
 */
const SETTLE_MS = 260

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

type Stage = 'menu' | 'free' | 'running' | 'summary' | 'record'

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
  const history = useStore((s) => s.history)
  const recordReading = useStore((s) => s.recordReading)
  const clearPracticeHistory = useStore((s) => s.clearPracticeHistory)
  /**
   * Which prompts of the run count toward the pass mark.
   *
   * A range, because the assessed part is not always at the front: a level run
   * is the level and then extra turns, and a session is a warm-up and some
   * review before the level it is assessing.
   */
  const [scored, setScored] = useState<Scored>({ from: 0, to: 0 })
  /**
   * The answered prompt is on its way out.
   *
   * A prompt used to be replaced by a hard cut — and in a run of forty that is
   * forty hard cuts at the exact spot the eyes are locked to. The settle after
   * a right answer was already being spent, so it is spent on this instead.
   */
  const [leaving, setLeaving] = useState(false)
  /**
   * The level just passed, if this run passed one that was not passed before.
   *
   * Carried back to the list because that is where unlocking is *seen* — the
   * summary can say it in words, but the thing that actually happened is a card
   * further down having stopped being grey.
   */
  const [justPassed, setJustPassed] = useState<string | null>(null)
  /** What to call each prompt in the header, when a run has parts. */
  const [labels, setLabels] = useState<string[]>([])
  /**
   * Whether each prompt plays itself through first.
   *
   * Per prompt rather than per level, because a session draws from several
   * levels that disagree — and taking it from the level being *assessed* meant
   * a session ending in a scale played the answer for its reading warm-up.
   */
  const [demos, setDemos] = useState<boolean[]>([])
  const [bpm, setBpm] = useState<number>(() => loadTempo())
  /**
   * Bumped to play the prompt through again.
   *
   * Changing the tempo while the play-through is sounding restarts it at the
   * new one — the reader is listening, and a control that takes effect on some
   * later prompt cannot be judged by ear. Changing it during an *attempt*
   * deliberately does nothing until the next prompt: a demo starting up
   * underneath someone mid-phrase would be worse than a slow one.
   */
  const [replay, setReplay] = useState(0)
  const nudgeTempo = (direction: 1 | -1) => {
    setBpm((current) => {
      const next = stepTempo(current, direction)
      saveTempo(next)
      return next
    })
    if (demoing.current) setReplay((n) => n + 1)
  }

  const key = useMemo(() => keyAt(score, 0), [score])
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const prompt: Prompt | undefined = prompts[index]

  // Held keys and the wrong-note count for the prompt in front of the player.
  // Refs rather than state: they change on every key press and nothing renders
  // them, so state would mean re-rendering the score per keystroke.
  const heldRef = useRef(new Set<number>())
  const stepRef = useRef(0)
  const wrongRef = useRef(0)
  const slipsRef = useRef<{ staff: number; asked: number; played: number }[]>([])
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
    setLeaving(false)
    heldRef.current = new Set()
    stepRef.current = 0
    wrongRef.current = 0
    slipsRef.current = []
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
    const run = buildRun(next.make(key, seed), history, next.id, seed)
    setLevel(next)
    setPrompts(run.prompts)
    setScored(run.scored)
    setLabels([])
    setDemos(run.prompts.map(() => !!next.demo))
    setAttempts([])
    setIndex(0)
    setStage('running')
    beginPrompt()
  }

  /**
   * Erase the course record: every pass, every timing, every miss.
   *
   * Both stores at once, because a half-reset is worse than either whole state
   * — levels locked again but a history that still calls their bars familiar
   * would make the first "new" run adapt to a person who supposedly never
   * played.
   */
  const resetRecord = () => {
    try {
      localStorage.removeItem('folio.progress.v1')
    } catch {
      // Private browsing. The in-memory state still resets below.
    }
    clearPracticeHistory()
    setProgress(loadProgress())
    setJustPassed(null)
  }

  const startFree = () => {
    const run = buildRun(generateDrill(config, key, seed), history, 'free', seed)
    setLevel(null)
    setPrompts(run.prompts)
    setScored(run.scored)
    setLabels([])
    setDemos([])
    setAttempts([])
    setIndex(0)
    setStage('running')
    beginPrompt()
  }

  /**
   * A whole session: warm up, review, then the level being learnt.
   *
   * The level is set to the assessed part, so finishing a session passes and
   * unlocks exactly as playing that level would — the session is a better way
   * to arrive at it, not a different currency.
   */
  const startSession = () => {
    void player.unlock()
    const session = buildSession(key, seed, history, progress)
    setLevel(session.level)
    setPrompts(session.prompts)
    setScored(session.scored)
    setLabels(session.labels)
    setDemos(session.demos)
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
        /*
         * Which note was this aimed at? The nearest one of the current step, by
         * pitch — for a single note there is nothing to decide, and for a chord
         * a slip lands closest to the note the finger meant. The pair is what
         * turns "three wrong notes" into "E4 keeps coming out as G4".
         */
        const asked = current.reduce((a, b) =>
          Math.abs(b - note) < Math.abs(a - note) ? b : a,
        )
        slipsRef.current.push({
          staff: prompt.score.notes.find((n) => n.midi === asked)?.hand === 'left' ? 2 : 1,
          asked,
          played: note,
        })
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
      // Start the answered prompt on its way out. Nothing else changes yet —
      // the music stays put and readable while it fades, which is why the
      // travel is a few pixels rather than a slide.
      setLeaving(true)
      const ms = Math.round(performance.now() - shownAt.current)
      setAttempts((list) => [
        ...list,
        { promptId: prompt.id, pitches: pitchesOf(prompt), ms, wrong: wrongRef.current },
      ])
      // Written down rather than summarised and forgotten. This is the whole
      // of what the next run has to go on.
      recordReading({
        levelId: level?.id ?? 'free',
        promptId: prompt.id,
        notes: notesOf(prompt),
        ms,
        wrong: wrongRef.current,
        slips: slipsRef.current,
      })
      window.setTimeout(() => {
        setIndex((i) => i + 1)
        beginPrompt()
      }, SETTLE_MS)
    })

    return stop
  }, [stage, prompt, beginPrompt, level?.id])

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
    if (stage !== 'running' || !prompt || !(demos[index] ?? false)) return

    let frame = 0
    let cancelled = false
    /*
     * The prompt is written at one tempo and played at the reader's.
     *
     * The player takes a multiplier rather than a tempo, so the chosen tempo is
     * expressed as a ratio against whatever the prompt was written at. Changing
     * the number written into the prompt instead would mean rebuilding every
     * score on every nudge of the control.
     */
    const written = prompt.score.tempos[0]?.bpm ?? 88
    const scale = bpm / written

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
    player.play(prompt.score, 0, scale, finish)

    const tick = () => {
      if (cancelled) return
      // elapsed() is wall clock, and the music is going past at the tempo
      // actually chosen — so that is the number that converts it to beats.
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
    // bpm is read, not depended on: a tempo change during an attempt must not
    // restart the play-through. `replay` is the deliberate way to ask for that,
    // and it is only bumped while the demo is actually sounding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, prompt?.id, index, demos, beginPrompt, replay])

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
    // Scored on the level as written, not on the extra turns. The extras are
    // there because something went wrong; counting them would make being bad at
    // a level the reason it is harder to pass.
    const assessed = attempts.slice(scored.from, scored.to)
    const clean = assessed.filter((a) => a.wrong === 0).length / Math.max(1, assessed.length)
    if (level) {
      // Crossing the line, not merely being over it: replaying a level you
      // already passed should not announce itself as news.
      const crossed = !isPassed(progress, level.id) && clean >= level.pass
      setProgress((p) => recordResult(p, level.id, clean))
      if (crossed) setJustPassed(level.id)
    }
    setStage('summary')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, prompts.length, stage])

  const support = midiSupport()
  const summary = useMemo(
    () => summarise(attempts.slice(scored.from, scored.to)),
    [attempts, scored],
  )
  /** Turns played outside the assessed range: extras, or a session's warm-up. */
  const extras = Math.max(0, attempts.length - (scored.to - scored.from))
  const remembered = useMemo(() => slowestNotes(history, 3), [history])
  /*
   * What today's session would be, described.
   *
   * Built on the menu so the card can say what it holds rather than being a
   * button labelled "practice" that does something unexplained. Only offered
   * once something has been passed: before that a session is a warm-up nobody
   * has learnt, a review of nothing, and level one — which the list says better.
   */
  const sessionPlan = useMemo(
    () => (canPlanSession(progress) ? buildSession(key, seed, history, progress) : null),
    [key, seed, history, progress],
  )
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
  const weaned = useMemo(() => withWeaning(theme, history), [theme, history])
  const bars = prompt ? barsIn(prompt) : 1
  /*
   * How many bars share a line.
   *
   * All of them, normally: a prompt is one thing to read and splitting it makes
   * the eye travel. But a dense prompt — sixteen eighth notes across two bars —
   * on one line of a phone comes out at a five-pixel staff space, which is not
   * reading, it is guessing. Past a certain number of columns the prompt is
   * better as two lines of legible music than one line of illegible music.
   */
  const columns = prompt ? prompt.steps.length : 1
  const barsPerSystem = columns > 8 ? 1 : bars
  const promptTheme = useMemo(() => {
    // Long material needs a smaller staff, or two bars of a scale will not fit
    // across a phone held in portrait.
    const laneHeight = Math.max(weaned.layout.laneHeight, bars > 1 ? 10 : 13)
    // Spacing's unit is in pixels rather than staff spaces, so enlarging the
    // staff without enlarging it too would keep the old gaps and read as cramped.
    const grew = laneHeight / Math.max(1, weaned.layout.laneHeight)
    return {
      ...weaned,
      layout: {
        ...weaned.layout,
        laneHeight,
        barsPerSystem,
        showMeasureNumbers: false,
        spacing: theme.layout.spacing
          ? { ...theme.layout.spacing, justify: 0, unit: theme.layout.spacing.unit * grew }
          : undefined,
      },
    }
  }, [theme, bars, barsPerSystem])

  // Wide enough for four quarters plus a clef, key and time signature, narrow
  // enough that an unjustified bar does not sit in an acre of nothing.
  const layout = useMemo(
    () =>
      prompt
        ? layoutScore(
            prompt.score,
            promptTheme,
            // Width for the widest system, not for the whole prompt: a prompt
            // split over two lines needs room for one line of it.
            300 + Math.ceil(prompt.steps.length / (bars / barsPerSystem)) * 52,
          )
        : null,
    [prompt, promptTheme, bars, barsPerSystem],
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
  const stepAt = useMemo(() => {
    if (!layout || !prompt) return null
    // Every system, not just the first: a long prompt is laid out on two lines,
    // and looking only at the first one meant the hint silently stopped
    // appearing for any step in the second bar.
    for (const system of layout.systems) {
      const placed = system.notes.find((n) => n.note.id.startsWith(`${prompt.id}-${step}-`))
      if (placed) return { x: placed.x, top: system.top }
    }
    return null
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
          {/* A session says which part of itself you are in — warm up, review,
              or the level's own name — because "review" is the difference
              between a bar that matters and one that does not. */}
          {stage === 'running'
            ? labels[index] ?? level?.name ?? 'Rapid fire'
            : 'Rapid fire'}
        </span>
        <span className="practice__spacer" />
        {/* Only where it does something. A tempo control on a reading drill,
            which never plays itself, is a dial wired to nothing. Free play
            leaves the level null, so it drops out here too. */}
        {(stage === 'menu' || demos.some(Boolean)) && (
          <Tempo bpm={bpm} muted={theme.surface.muted} onStep={nudgeTempo} />
        )}
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
            {extras > 0 && (
              <div className="practice__stat" style={{ color: theme.surface.muted }}>
                {extras === 1 ? 'one extra turn' : `${extras} extra turns`} on what went wrong
              </div>
            )}
            {/* From the record rather than from this run: three prompts is far
                too little to say which note somebody finds hard, and the answer
                is much more useful when it is drawn from every run there has
                been. */}
            {remembered.length > 0 && (
              <div className="practice__slow" style={{ color: theme.surface.muted }}>
                slowest to read:{' '}
                {remembered
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
          <div
            className={
              `practice__prompt practice__prompt--${flash}` +
              `${leaving ? ' practice__prompt--leaving' : ''}`
            }
          >
            {/* The ghost is painted over this stack rather than added to the
                score, so the music never moves when the hint appears. */}
            {/* Keyed on the position in the run, so each prompt is a new
                element and arrives with its own entry — including when the same
                bar comes round again as an extra turn. */}
            <div
              className={`prompt-stack${leaving ? ' prompt-stack--leaving' : ''}`}
              key={index}
            >
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
              {stuck && lastWrong !== null && stepAt !== null && (
                <GhostNote
                  layout={layout}
                  theme={promptTheme}
                  key={`${prompt.id}-${step}-${lastWrong}`}
                  keyMark={key}
                  x={stepAt.x}
                  top={stepAt.top}
                  midi={lastWrong}
                  beats={prompt.steps.length === 1 ? 4 : 1}
                />
              )}
            </div>
          </div>
        ) : stage === 'record' ? (
          <RecordPanel
            history={history}
            keyMark={key}
            surface={theme.surface}
            weaning={theme.encodings.labelWean ?? false}
            onBack={() => setStage('menu')}
          />
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
            session={sessionPlan}
            justPassed={justPassed}
            onSession={startSession}
            onPick={startLevel}
            onFree={() => setStage('free')}
            onRecord={() => setStage('record')}
            onReset={resetRecord}
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
/**
 * How fast the play-through plays, as a metronome mark.
 *
 * A stepper rather than a slider: the tempi are the ones a metronome offers, so
 * there is nothing between two of them to drag to, and a slider would promise
 * a precision the scale does not have. Two taps and a number, which is also the
 * only shape of control that survives being used with one hand at a keyboard.
 */
function Tempo({
  bpm,
  muted,
  onStep,
}: {
  bpm: number
  muted: string
  onStep(direction: 1 | -1): void
}) {
  const end = (direction: 1 | -1) =>
    direction < 0 ? bpm <= TEMPI[0] : bpm >= TEMPI[TEMPI.length - 1]
  return (
    <span className="tempo" style={{ color: muted }}>
      <button
        className="tempo__step"
        onClick={() => onStep(-1)}
        disabled={end(-1)}
        aria-label="Slower"
      >
        −
      </button>
      {/* The note value the mark is against, so the number means something on
          its own — 104 is not a tempo, a quarter note at 104 is. */}
      <span className="tempo__mark" aria-label={`Quarter note equals ${bpm}`}>
        <span className="tempo__note" aria-hidden="true">
          ♩
        </span>
        {bpm}
      </span>
      <button
        className="tempo__step"
        onClick={() => onStep(1)}
        disabled={end(1)}
        aria-label="Faster"
      >
        +
      </button>
    </span>
  )
}

function Levels({
  progress,
  unlocked,
  surface,
  session,
  justPassed,
  onSession,
  onPick,
  onFree,
  onRecord,
  onReset,
}: {
  progress: Progress
  unlocked: number
  surface: Theme['surface']
  session: { summary: string; prompts: unknown[] } | null
  justPassed: string | null
  onSession(): void
  onPick(level: Level): void
  onFree(): void
  onRecord(): void
  onReset(): void
}) {
  const card = { background: surface.panel, color: surface.text }
  const done = (level: Level) => (progress.best[level.id] ?? 0) >= level.pass

  /*
   * The one-shot arrival, shown once and then let go.
   *
   * Held locally rather than read from the prop every render, because switching
   * tabs remounts the cards and would otherwise replay the whole thing every
   * time — a moment that repeats on demand is not a moment.
   */
  const [landed, setLanded] = useState<string | null>(justPassed)
  useEffect(() => {
    if (!landed) return
    const timer = window.setTimeout(() => setLanded(null), 1400)
    return () => window.clearTimeout(timer)
  }, [landed])
  const landedIndex = landed ? LEVELS.findIndex((l) => l.id === landed) : -1
  const openedId = landedIndex >= 0 ? LEVELS[landedIndex + 1]?.id : undefined

  /*
   * The level you would play next: the first one open and not yet passed, or —
   * once everything open has been passed — the one waiting to unlock. There is
   * always exactly one, which is the whole point of a single chain.
   */
  const next = (() => {
    const unfinished = LEVELS.findIndex((l, i) => i < unlocked && !done(l))
    return unfinished >= 0 ? unfinished : Math.min(unlocked, LEVELS.length - 1)
  })()
  const [tab, setTab] = useState<LevelGroup>(LEVELS[next].group)

  const shown = LEVELS.map((level, i) => ({ level, i })).filter((e) => e.level.group === tab)
  // One expanded card per tab, and never none: the level you would play next if
  // it is in this tab, otherwise whichever of these you would reach first. A tab
  // whose levels are all locked still has to say what it is for.
  const focus = shown.some((e) => e.i === next) ? next : (shown[0]?.i ?? -1)

  return (
    <div className="levels">
      {/* Above the tabs, because it is the answer to the question the tabs
          exist to help you answer yourself. Someone who knows what they want
          scrolls past it; someone who just sat down does not have to decide. */}
      {session && session.prompts.length > 0 && (
        <button className="level level--session" onClick={onSession} style={card}>
          <span className="level__mark level__mark--session">▶</span>
          <span className="level__body">
            <span className="level__name">Practise</span>
            <span className="level__goal" style={{ color: surface.muted }}>
              {session.summary}
            </span>
          </span>
        </button>
      )}

      <div className="levels__tabs" role="tablist">
        {LEVEL_GROUPS.map((group) => {
          const mine = LEVELS.filter((l) => l.group === group)
          const passed = mine.filter(done).length
          const on = group === tab
          return (
            <button
              key={group}
              role="tab"
              aria-selected={on}
              className={`levels__tab${on ? ' levels__tab--on' : ''}`}
              style={{
                color: on ? surface.text : surface.muted,
                // The underline is the only thing that moves, and it is drawn in
                // the reader's accent so the control belongs to their palette
                // rather than to the app's chrome.
                boxShadow: on ? `inset 0 -2px 0 0 ${surface.accent}` : 'none',
              }}
              onClick={() => setTab(group)}
            >
              {group}
              <span className="levels__tally" style={{ color: surface.muted }}>
                {passed}/{mine.length}
              </span>
            </button>
          )
        })}
      </div>

      {shown.map(({ level, i }) => {
        const best = progress.best[level.id] ?? 0
        const passed = done(level)
        const open = i < unlocked
        return (
          <button
            key={level.id}
            className={
              `level${passed ? ' level--done' : ''}${open ? '' : ' level--locked'}` +
              `${level.id === landed ? ' level--landed' : ''}` +
              `${level.id === openedId ? ' level--opened' : ''}`
            }
            onClick={() => open && onPick(level)}
            disabled={!open}
            style={card}
          >
            <span className="level__mark" style={{ background: surface.grid }}>
              <span className="level__tick">{passed ? '✓' : open ? i + 1 : '·'}</span>
            </span>
            <span className="level__body">
              <span className="level__name">{level.name}</span>
              {/* Only the one you are on explains itself. Thirteen cards each
                  carrying a line of description is a list nobody can see the
                  end of, and the twelve you are not about to play are the ones
                  whose description you do not need. */}
              {i === focus && (
                <span className="level__goal" style={{ color: surface.muted }}>
                  {open ? level.goal : `${level.goal} — pass the level before it to open this.`}
                </span>
              )}
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
        </span>
      </button>

      {/* One quiet row: the way into the record, and the way out of it all.
          A row rather than a stack because the list already runs the height of
          a phone, and these are footnotes, not cards. */}
      <div className="levels__footer">
        <button className="levels__link" style={{ color: surface.muted }} onClick={onRecord}>
          Your reading record
        </button>
        <span className="levels__dot" style={{ color: surface.muted }}>
          ·
        </span>
        <ResetLine muted={surface.muted} onReset={onReset} />
      </div>
    </div>
  )
}

/**
 * The record: what the practice history actually says, in sentences.
 *
 * Everything on this page is already known — it is the same ledger that drives
 * the extra turns, the session's review and the label weaning. Showing it is
 * what turns "the app adapts" from something taken on faith into something a
 * person can check, and the slips section is the start of the confusion
 * matrix: not that E4 keeps going wrong, but what it keeps coming out as.
 */
function RecordPanel({
  history,
  keyMark,
  surface,
  weaning,
  onBack,
}: {
  history: History
  keyMark: ReturnType<typeof keyAt>
  surface: Theme['surface']
  weaning: boolean
  onBack(): void
}) {
  const slow = slowestNotes(history, 5).filter((s) => s.ms > 0)
  const missed = mostMissed(history, 5)
  const slips = commonSlips(history, 5)
  const wean = weaning ? weanRules(history) : null
  const name = (midi: number) => noteName(spellPitch(midi, keyMark), true)
  const staffName = (staff: number) => (staff === 2 ? 'bass' : 'treble')
  const empty = slow.length === 0 && missed.length === 0 && slips.length === 0

  return (
    <div className="record" style={{ color: surface.text }}>
      {empty ? (
        <p className="practice__note" style={{ color: surface.muted }}>
          Play a few levels and this page starts filling in — which notes are
          slow, which go wrong, and what they come out as instead.
        </p>
      ) : (
        <>
          {slow.length > 0 && (
            <section className="record__group">
              <h3 className="record__title" style={{ color: surface.muted }}>
                Slowest to read
              </h3>
              {slow.map((s) => (
                <div className="record__row" key={`s-${s.staff}-${s.midi}`}>
                  <span>
                    {name(s.midi)}
                    <i style={{ color: surface.muted }}> · {staffName(s.staff)}</i>
                  </span>
                  <span style={{ color: surface.muted }}>{(s.ms / 1000).toFixed(1)}s</span>
                </div>
              ))}
            </section>
          )}

          {missed.length > 0 && (
            <section className="record__group">
              <h3 className="record__title" style={{ color: surface.muted }}>
                Most often wrong
              </h3>
              {missed.map((m) => (
                <div className="record__row" key={`m-${m.staff}-${m.midi}`}>
                  <span>
                    {name(m.midi)}
                    <i style={{ color: surface.muted }}> · {staffName(m.staff)}</i>
                  </span>
                  <span style={{ color: surface.muted }}>
                    {Math.round(m.rate * 100)}% of {m.seen}
                  </span>
                </div>
              ))}
            </section>
          )}

          {slips.length > 0 && (
            <section className="record__group">
              <h3 className="record__title" style={{ color: surface.muted }}>
                What they come out as
              </h3>
              {slips.map((s) => (
                <div className="record__row" key={`p-${s.staff}-${s.asked}-${s.played}`}>
                  <span>
                    {name(s.asked)} <i style={{ color: surface.muted }}>played as</i>{' '}
                    {name(s.played)}
                  </span>
                  <span style={{ color: surface.muted }}>×{s.times}</span>
                </div>
              ))}
            </section>
          )}

          {wean && (wean.faded > 0 || wean.weaned > 0) && (
            <p className="record__wean" style={{ color: surface.muted }}>
              {wean.weaned > 0 &&
                `${wean.weaned} ${wean.weaned === 1 ? 'letter' : 'letters'} gone`}
              {wean.weaned > 0 && wean.faded > 0 && ' · '}
              {wean.faded > 0 && `${wean.faded} fading`}
              {' — read fluently, so the labels are stepping back.'}
            </p>
          )}
        </>
      )}

      <button className="pill pill--solid" onClick={onBack}>
        Back
      </button>
    </div>
  )
}

/**
 * Starting over, quietly.
 *
 * A practice record is a diary, and a diary you cannot clear is a small
 * betrayal — but the control for it must not look like a feature. One line of
 * muted text at the very bottom, and a second press to mean it: the first turns
 * the line into the question, and anything else — including just waiting —
 * turns it back. No browser dialog, which would be another app's furniture in
 * the middle of this one.
 */
function ResetLine({ muted, onReset }: { muted: string; onReset(): void }) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const timer = window.setTimeout(() => setArming(false), 4000)
    return () => window.clearTimeout(timer)
  }, [arming])
  return (
    <button
      className={`levels__reset${arming ? ' levels__reset--armed' : ''}`}
      style={{ color: muted }}
      onClick={() => {
        if (!arming) {
          setArming(true)
          return
        }
        setArming(false)
        onReset()
      }}
    >
      {arming ? 'Erase all progress and history? Press again to confirm.' : 'Start the course over'}
    </button>
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
        {/* Always present. Hiding it when unsupported left the person whose
            browser lacks Web Bluetooth with no control and no explanation —
            the same mistake this app has made once before with the Keyboard
            button. Pressing it when unsupported explains instead of connecting. */}
        <button
          className="pill pill--solid"
          onClick={() => {
            const support = bluetoothSupport()
            if (support.ok) onBluetooth()
            else useStore.getState().showToast(support.reason ?? 'Bluetooth is unavailable here.')
          }}
        >
          Bluetooth
        </button>
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
