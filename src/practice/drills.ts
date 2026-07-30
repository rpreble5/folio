/**
 * Rapid-fire drills: one prompt, one answer, immediately the next.
 *
 * The whole point is that a prompt is drawn in *the user's own notation*. Someone
 * who has coloured their score by pitch class and dropped the letter labels needs
 * practice reading that, and no general-purpose trainer can give it to them. So a
 * prompt is not a special widget — it is a one-note Score, laid out and rendered
 * by exactly the same code as a real piece. Whatever they designed, they drill.
 *
 * Generation is deterministic from a seed. A run that turns up a horrible
 * sequence can be repeated, and a failing test can be replayed, neither of which
 * is possible with Math.random.
 */

import type { KeyMark, Score } from '../core/types'
import { markBarStarts } from '../core/types'
import { pitchClass, spellPitch } from '../core/pitch'

export type DrillKind = 'note' | 'chord'

export interface DrillConfig {
  kind: DrillKind
  /** Lowest and highest MIDI note a prompt may use. */
  low: number
  high: number
  /** Draw only from the key's own scale, rather than all twelve. */
  inKey: boolean
  /** Which staff prompts appear on. */
  hands: 'right' | 'left' | 'both'
  /** Notes per chord, when the kind is chord. */
  chordSize: number
  /** Prompts in a run. */
  length: number
}

export const DEFAULT_DRILL: DrillConfig = {
  kind: 'note',
  // Two octaves either side of middle C — the range a beginner reads without
  // ledger lines, which is the range worth being fluent in first.
  low: 55,
  high: 79,
  inKey: true,
  hands: 'right',
  chordSize: 3,
  length: 20,
}

export interface Prompt {
  id: string
  /** What has to be played. Order does not matter within a chord. */
  pitches: number[]
  /** Renderable on its own, through the ordinary layout and theme. */
  score: Score
}

export interface Attempt {
  promptId: string
  pitches: number[]
  /** Milliseconds from the prompt appearing to the last right note. */
  ms: number
  /** Notes played that were not in the prompt. */
  wrong: number
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

/** A deterministic generator, so a run can be repeated exactly. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Every pitch a prompt may use, given the range and the key. */
function pool(config: DrillConfig, key: KeyMark): number[] {
  const scale = key.mode === 'minor' ? MINOR : MAJOR
  const tonic = ((key.fifths * 7) % 12 + 12) % 12
  const out: number[] = []

  for (let midi = config.low; midi <= config.high; midi += 1) {
    if (config.inKey) {
      const degree = (((pitchClass(midi) - tonic) % 12) + 12) % 12
      if (!scale.includes(degree)) continue
    }
    out.push(midi)
  }
  return out
}

/**
 * Build a Score holding exactly one prompt.
 *
 * A whole note in one bar. No rhythm to read, deliberately — a reading drill
 * should ask one question, and mixing pitch with duration means a wrong answer
 * no longer says which of the two was the problem.
 *
 * A full grand staff with a whole-bar rest on the hand that is not playing,
 * rather than a lone treble staff. Two reasons: it is what piano music actually
 * looks like, so the drill trains the real thing; and without clefs the renderer
 * has nothing to draw the lower staff *from*, which produced five bare lines
 * with no clef sitting under the prompt like a mistake.
 */
function scoreFor(pitches: number[], key: KeyMark, hand: 'left' | 'right', id: string): Score {
  const staff = hand === 'left' ? 2 : 1
  const notes = pitches.map((midi, i) => ({
    id: `${id}-${i}`,
    onset: 0,
    duration: 4,
    midi,
    spelling: spellPitch(midi, key),
    hand,
    voice: 1,
    measure: 0,
    velocity: 0.8,
    notated: { segments: [{ type: 'whole' as const, dots: 0, beats: 4 }] },
  }))
  markBarStarts(notes)

  return {
    id: `drill-${id}`,
    title: 'Practice',
    composer: '',
    notes,
    rests: [
      {
        id: `${id}-rest`,
        onset: 0,
        duration: 4,
        staff: staff === 1 ? 2 : 1,
        voice: 1,
        measure: 0,
        wholeBar: true,
        notated: { segments: [{ type: 'whole' as const, dots: 0, beats: 4 }] },
      },
    ],
    clefs: [
      { beat: 0, staff: 1, sign: 'G', line: 2, octaveChange: 0 },
      { beat: 0, staff: 2, sign: 'F', line: 4, octaveChange: 0 },
    ],
    tempos: [{ beat: 0, bpm: 90 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keys: [{ ...key, beat: 0 }],
    length: 4,
  }
}

export function generateDrill(config: DrillConfig, key: KeyMark, seed: number): Prompt[] {
  const rand = random(seed)
  const notes = pool(config, key)
  if (notes.length === 0) return []

  const prompts: Prompt[] = []
  let previous: number[] = []

  for (let i = 0; i < config.length; i += 1) {
    const hand: 'left' | 'right' =
      config.hands === 'both' ? (rand() < 0.5 ? 'left' : 'right') : config.hands

    let pitches: number[] = []
    // Two prompts running are never identical: repeating one turns a reading
    // drill into a memory drill, and the second answer proves nothing.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      pitches = draw(config, notes, rand)
      if (pitches.join() !== previous.join()) break
    }
    previous = pitches

    const id = `p${i}`
    prompts.push({ id, pitches, score: scoreFor(pitches, key, hand, id) })
  }

  return prompts
}

function draw(config: DrillConfig, notes: number[], rand: () => number): number[] {
  if (config.kind === 'note') return [notes[Math.floor(rand() * notes.length)]]

  // Chords are built by stacking from the pool rather than by naming a triad:
  // in-key stacking already produces the diatonic triads, and out of key it
  // produces the clusters that are worth being able to read.
  const size = Math.max(2, Math.min(5, config.chordSize))
  const room = Math.max(0, notes.length - (size - 1) * 2 - 1)
  const root = Math.floor(rand() * (room + 1))
  return Array.from({ length: size }, (_, i) => notes[Math.min(root + i * 2, notes.length - 1)])
    .filter((v, i, a) => a.indexOf(v) === i)
}

export interface DrillSummary {
  total: number
  clean: number
  /** Median milliseconds, which is the honest middle when one prompt stalls. */
  median: number
  /** Slowest pitches, worst first, with their times. */
  slowest: { midi: number; ms: number }[]
}

/**
 * What a run says about the reader — and about the style.
 *
 * Median rather than mean, because one prompt where the phone rang would drag a
 * mean anywhere. `slowest` is the interesting column: a note that is reliably
 * slow is usually not a gap in the reader's knowledge but a pitch whose colour or
 * shape is not pulling its weight.
 */
export function summarise(attempts: Attempt[]): DrillSummary {
  if (attempts.length === 0) return { total: 0, clean: 0, median: 0, slowest: [] }

  const times = attempts.map((a) => a.ms).sort((a, b) => a - b)
  const middle = Math.floor(times.length / 2)
  const median =
    times.length % 2 === 0 ? Math.round((times[middle - 1] + times[middle]) / 2) : times[middle]

  // A chord's time belongs to all of its notes: any one of them could have been
  // the one that was slow to read, and over a run the guilty one rises anyway.
  const byPitch = new Map<number, number[]>()
  for (const attempt of attempts) {
    for (const midi of attempt.pitches) {
      const list = byPitch.get(midi)
      if (list) list.push(attempt.ms)
      else byPitch.set(midi, [attempt.ms])
    }
  }

  const slowest = Array.from(byPitch.entries())
    .map(([midi, list]) => ({
      midi,
      ms: Math.round(list.reduce((sum, v) => sum + v, 0) / list.length),
    }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3)

  return {
    total: attempts.length,
    clean: attempts.filter((a) => a.wrong === 0).length,
    median,
    slowest,
  }
}
