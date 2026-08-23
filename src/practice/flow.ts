/**
 * Flow: endless reading that starts tiny and grows with you.
 *
 * The levels ask questions with answers — play this bar, pass this mark. Flow
 * asks nothing. Music keeps arriving, phrase after phrase, generated fresh
 * every time, and the only decision the reader makes is when to stop. What
 * changes is the *music*: it begins with three notes under one hand and slowly
 * becomes wider, two-handed, chordal — or slides back down the moment the
 * reading stops being comfortable.
 *
 * Difficulty is a staircase, not a dial with infinite positions, because each
 * stair is a nameable kind of music ("left hand joins", "chords arrive") and a
 * nameable step is one the reader can feel themselves climbing. Movement along
 * it is driven by a short window of recent notes: clean and quick for long
 * enough and the next phrase is drawn from one stair up; a couple of misses
 * close together and the next phrase steps down *immediately*. Down faster
 * than up, on purpose — nothing ends a session like being stuck above your
 * level, and nothing is lost by a phrase that turns out too easy.
 *
 * There is no clock and no score. Speed is measured silently, because it
 * steers the staircase; it is never shown while playing, because a visible
 * clock makes people rush and rushing measures panic.
 */

import type { KeyMark } from '../core/types'
import { noteKey, type History } from './history'
import { scoreFor, type Prompt } from './drills'

/** One step of the staircase: a kind of music, described by what it may use. */
interface Stair {
  /** How the header names this stair while it is being read. */
  label: string
  /** MIDI bounds the right hand draws from (filtered to the key's scale). */
  rh: [number, number]
  /** Bounds for the left hand, once it has joined. */
  lh?: [number, number]
  /** Chance an event switches hands, when both are in play. */
  swap?: number
  /** Chance a right-hand event is an interval or chord, and how many notes. */
  chord?: number
  chordSize?: number
  /** Chance a right-hand event carries a left-hand bass note under it. */
  together?: number
}

/**
 * The staircase itself. Bounds are in MIDI and filtered to the key's scale, so
 * "three notes" is three in any key — the first three scale notes above middle
 * C, whatever they happen to be called there.
 */
const LADDER: Stair[] = [
  { label: 'three notes', rh: [60, 64] },
  { label: 'five notes', rh: [60, 67] },
  { label: 'a whole octave', rh: [60, 72] },
  { label: 'below the line', rh: [55, 72] },
  { label: 'left hand joins', rh: [55, 72], lh: [48, 55], swap: 0.35 },
  { label: 'both hands, wider', rh: [55, 76], lh: [43, 60], swap: 0.4 },
  { label: 'two at once', rh: [55, 76], lh: [43, 60], swap: 0.35, chord: 0.25, chordSize: 2 },
  { label: 'chords arrive', rh: [53, 79], lh: [40, 60], swap: 0.35, chord: 0.3, chordSize: 3 },
  { label: 'hands together', rh: [53, 79], lh: [36, 60], swap: 0.3, chord: 0.3, chordSize: 3, together: 0.25 },
  { label: 'the full spread', rh: [48, 84], lh: [36, 64], swap: 0.4, chord: 0.35, chordSize: 3, together: 0.35 },
]

export const TOP_STAIR = LADDER.length - 1

export const stairLabel = (stair: number): string =>
  LADDER[Math.max(0, Math.min(TOP_STAIR, stair))].label

/** Events in one phrase: two bars of quarters, the size a prompt reads well at. */
const PHRASE = 8

// ---------------------------------------------------------------------------
// The dial: where on the staircase the next phrase is drawn from.

export interface FlowSample {
  /** Milliseconds this event took, measured from the one before. */
  ms: number
  /** Wrong presses on the way to it. */
  wrong: number
}

export interface Dial {
  stair: number
  /** The highest stair reached this session, for the goodbye card. */
  peak: number
  /** The last few events, newest last. Cleared whenever the stair moves. */
  window: FlowSample[]
}

/** Events the window holds. */
const WINDOW = 8
/** Clean events in a row before the stair goes up. */
const UP_RUN = 6
/** And how quick they have to be, per note, to count as comfortable. */
const UP_MS = 1600
/** Missed events among the last three that send the stair down. */
const DOWN_MISSES = 2
/** Wrong presses in a single event that send it down on their own. */
const DOWN_WRONG = 3
/** Typical pace, over the last four events, that reads as struggling. */
const DOWN_MS = 3400

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Fold one event into the dial.
 *
 * Down is deliberately faster than up: two missed events out of the last
 * three — or one event fought through several wrong notes — steps down at
 * once, while going up takes six clean, comfortable events in a row. The
 * asymmetry is the design. A phrase too easy costs a few seconds; a phrase
 * too hard costs the will to continue.
 *
 * The window is cleared on every move, so a step down is not immediately
 * followed by another on the strength of the same bad patch, and a step up
 * has to be earned entirely on the new stair's music.
 */
export function updateDial(dial: Dial, sample: FlowSample): Dial {
  const window = [...dial.window, sample].slice(-WINDOW)

  const down =
    (sample.wrong >= DOWN_WRONG ||
      window.slice(-3).filter((s) => s.wrong > 0).length >= DOWN_MISSES ||
      (window.length >= 4 && median(window.slice(-4).map((s) => s.ms)) > DOWN_MS)) &&
    dial.stair > 0
  if (down) return { stair: dial.stair - 1, peak: dial.peak, window: [] }

  const recent = window.slice(-UP_RUN)
  const up =
    recent.length === UP_RUN &&
    recent.every((s) => s.wrong === 0) &&
    median(recent.map((s) => s.ms)) <= UP_MS &&
    dial.stair < TOP_STAIR
  if (up) {
    const stair = dial.stair + 1
    return { stair, peak: Math.max(dial.peak, stair), window: [] }
  }

  return { ...dial, window }
}

/**
 * Where a returning reader starts.
 *
 * From the record rather than from zero: someone who has been reading octaves
 * fluently for a month should not be handed three notes. A stair counts as
 * earned when most of the notes it draws from are known — seen a few times,
 * rarely missed, read at a comfortable pace — and the seed is the highest
 * stair reachable by consecutive earned steps from the bottom, so a lucky
 * scatter of known notes high up cannot skip the reader past music they have
 * never met.
 */
export function seedDial(history: History, key: KeyMark): Dial {
  const day = Math.floor(Date.now() / 86_400_000)
  const known = (staff: number, midi: number): boolean => {
    const stat = history.notes[noteKey(staff, midi)]
    if (!stat || stat.seen < 3) return false
    if (stat.missed / stat.seen > 0.2) return false
    if (stat.ms > 2400) return false
    if (day - stat.day > 21) return false
    return true
  }

  let stair = 0
  for (let s = 0; s < LADDER.length; s += 1) {
    const spec = LADDER[s]
    const pool = [
      ...scalePool(key, spec.rh[0], spec.rh[1]).map((m) => [1, m] as const),
      ...(spec.lh ? scalePool(key, spec.lh[0], spec.lh[1]).map((m) => [2, m] as const) : []),
    ]
    if (pool.length === 0) break
    const fraction = pool.filter(([staff, midi]) => known(staff, midi)).length / pool.length
    if (fraction < 0.7) break
    stair = s
  }
  return { stair, peak: stair, window: [] }
}

// ---------------------------------------------------------------------------
// Generation.

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

/** The key's scale notes between two bounds, low to high. */
export function scalePool(key: KeyMark, low: number, high: number): number[] {
  const scale = key.mode === 'minor' ? MINOR : MAJOR
  const tonic = (((key.fifths * 7) % 12) + 12) % 12
  const out: number[] = []
  for (let midi = low; midi <= high; midi += 1) {
    const degree = (((midi % 12) - tonic + 12) % 12)
    if (scale.includes(degree)) out.push(midi)
  }
  return out
}

/** The same deterministic generator the drills use, so a phrase can replay. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * One phrase from one stair.
 *
 * A random walk rather than independent draws, because music moves mostly by
 * step — a pool sampled uniformly produces a leap on every note, which reads
 * as a test, not a tune. Steps of one or two scale notes, the occasional
 * leap, direction turned back at the edges of the pool.
 */
export function flowPhrase(stairIndex: number, key: KeyMark, seed: number, n: number): Prompt {
  const spec = LADDER[Math.max(0, Math.min(TOP_STAIR, stairIndex))]
  const rand = random(seed)
  const right = scalePool(key, spec.rh[0], spec.rh[1])
  const left = spec.lh ? scalePool(key, spec.lh[0], spec.lh[1]) : []

  let ri = Math.floor(right.length / 2)
  let li = Math.floor(left.length / 2)
  let hand: 'left' | 'right' = 'right'
  const events: { notes: number[]; hands: ('left' | 'right')[] }[] = []
  let previous = ''

  const walk = (index: number, pool: number[]): number => {
    const leap = rand() < 0.15
    const size = leap ? 3 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 2)
    // Turned back at the edges rather than clamped to them, or a walk that
    // reaches the top of the pool sits on its highest note for the rest of
    // the phrase.
    let direction = rand() < 0.5 ? -1 : 1
    if (index + direction * size < 0 || index + direction * size >= pool.length) direction = -direction
    return Math.max(0, Math.min(pool.length - 1, index + direction * size))
  }

  for (let i = 0; i < PHRASE; i += 1) {
    if (left.length > 0 && rand() < (spec.swap ?? 0)) hand = hand === 'right' ? 'left' : 'right'
    const pool = hand === 'left' ? left : right
    const index = walk(hand === 'left' ? li : ri, pool)
    if (hand === 'left') li = index
    else ri = index

    let notes = [pool[index]]
    let hands: ('left' | 'right')[] = [hand]

    if (hand === 'right' && spec.chord && rand() < spec.chord) {
      const size = spec.chordSize ?? 3
      notes = Array.from({ length: size }, (_, j) =>
        pool[Math.min(index + j * 2, pool.length - 1)],
      ).filter((v, j, a) => a.indexOf(v) === j)
      hands = notes.map(() => 'right')
    }

    if (hand === 'right' && spec.together && left.length > 0 && rand() < (spec.together ?? 0)) {
      li = walk(li, left)
      const bass = left[li]
      // Under the melody or not at all: a "bass" note above the right hand is
      // just a wrong voicing, and one equal to it is unplayable as two notes.
      if (bass < Math.min(...notes)) {
        notes = [bass, ...notes]
        hands = ['left', ...hands]
      }
    }

    // Never the same event twice running — a repeat reads itself.
    const signature = notes.join()
    if (signature === previous && notes.length === 1) {
      const nudged = walk(index, pool)
      notes = [pool[nudged === index ? Math.max(0, index - 1) : nudged]]
      if (hand === 'left') li = pool.indexOf(notes[0])
      else ri = pool.indexOf(notes[0])
    }
    previous = notes.join()
    events.push({ notes, hands })
  }

  const id = `f${n}`
  const steps = events.map((e) => e.notes)
  const score = scoreFor(steps, key, 'right', id, {
    handAt: (step, midi) => {
      const event = events[step]
      const at = event.notes.indexOf(midi)
      return event.hands[at] ?? 'right'
    },
  })
  return { id, steps, score }
}
