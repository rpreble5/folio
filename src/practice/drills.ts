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

import type { BeamState, KeyMark, NoteEvent, NoteType, RestEvent, Score } from '../core/types'
import { markBarStarts } from '../core/types'
import { pitchClass, printedAccidental, spellPitch, spellPitchWith } from '../core/pitch'

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

/**
 * One thing to play.
 *
 * `steps` is a list of simultaneities *in order*: one entry is a single note or a
 * chord, and several entries are a phrase to be played left to right. That one
 * shape covers everything — a single note is `[[60]]`, a triad is
 * `[[60,64,67]]`, a four-note phrase is `[[60],[62],[64],[65]]`, and a phrase
 * with chords in it is just a mixture.
 *
 * Order matters between steps and does not matter within one, which is exactly
 * the distinction a keyboard makes: the notes of a chord arrive in whatever
 * order the hand lands, and the notes of a phrase do not.
 */
export interface Prompt {
  id: string
  steps: number[][]
  /** Renderable on its own, through the ordinary layout and theme. */
  score: Score
}

/** Everything a prompt asks for, flattened. For statistics, not for matching. */
export const pitchesOf = (prompt: Prompt): number[] => prompt.steps.flat()

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

/** How a prompt is written, beyond which notes it holds. */
export interface ScoreOptions {
  /** Prefer sharps or flats. Defaults to whatever the key implies. */
  spell?: 'sharp' | 'flat'
  /** Beats per step. Defaults to a whole bar for a lone step, a quarter otherwise. */
  beatsPerStep?: number
}

/** Beats in a bar. Everything generated here is in four. */
const BAR = 4

/**
 * Build a Score holding exactly one prompt.
 *
 * Rhythm is held constant on purpose: a lone step is a whole note filling a bar,
 * and everything longer is quarter notes. A reading drill should ask one
 * question, and mixing pitch with duration means a wrong answer no longer says
 * which of the two was the problem.
 *
 * Short prompts get a bar of their own length — three notes make a bar of 3/4 —
 * so nothing is padded. Anything longer than a bar is written in 4/4 across as
 * many bars as it needs, with a rest filling whatever is left of the last one. A
 * seven-note blues scale is two bars and a beat of silence, which is how it
 * would actually be written.
 *
 * A full grand staff with rests on the hand that is not playing, rather than a
 * lone treble staff: it is what piano music looks like, so the drill trains the
 * real thing, and without clefs the renderer has nothing to draw the lower staff
 * from.
 *
 * Accidentals are printed where the key signature does not already account for
 * them, which is what makes generated blues material legible — a B♭ in C major
 * needs its flat, and without one the reader is looking at a B.
 */
export function scoreFor(
  steps: number[][],
  key: KeyMark,
  hand: 'left' | 'right',
  id: string,
  options: ScoreOptions = {},
): Score {
  const staff = hand === 'left' ? 2 : 1
  const other = staff === 1 ? 2 : 1
  const single = steps.length === 1
  const beats = options.beatsPerStep ?? (single ? BAR : 1)
  const played = steps.length * beats

  // A short prompt gets a bar its own size; a long one is written in fours.
  const barBeats = played <= BAR ? Math.max(1, played) : BAR
  const bars = Math.max(1, Math.ceil(played / barBeats))
  const total = bars * barBeats

  const type = (b: number): NoteType =>
    b >= 4 ? 'whole' : b >= 2 ? 'half' : b >= 1 ? 'quarter' : 'eighth'

  /*
   * Beam anything shorter than a beat.
   *
   * Eight separate flags is not how eighth notes are written, and the reason is
   * not decoration: a beamed group is read as one shape, which is the whole
   * difference between reading a run and reading eight notes that happen to be
   * adjacent.
   *
   * Eighths are beamed across the half bar and anything shorter across the
   * beat, which is the usual grouping in four. Beaming eighths in pairs instead
   * would say the pulse is the eighth, and it also splits a rising run into
   * four two-note groups whose stems can end up pointing different ways — the
   * shape the beam was there to show, cut into pieces.
   */
  const beamBeats = beats === 0.5 ? 2 : 1
  const perBeam = beats < 1 ? Math.round(beamBeats / beats) : 0
  const beamsAt = (i: number): BeamState[] | undefined => {
    if (perBeam < 2) return undefined
    const place = i % perBeam
    // A group cut short by the end of the material is left unbeamed rather than
    // opened and never closed, which would draw a beam running off the bar.
    if (i - place + perBeam > steps.length) return undefined
    return [place === 0 ? 'begin' : place === perBeam - 1 ? 'end' : 'continue']
  }

  const spell = (midi: number) =>
    options.spell ? spellPitchWith(midi, options.spell) : spellPitch(midi, key)

  const notes: NoteEvent[] = steps.flatMap((step, i) =>
    step.map((midi, j) => {
      const spelling = spell(midi)
      const accidental = printedAccidental(spelling, key)
      return {
        id: `${id}-${i}-${j}`,
        onset: i * beats,
        duration: beats,
        midi,
        spelling,
        hand,
        voice: 1,
        measure: Math.floor((i * beats) / barBeats),
        velocity: 0.8,
        notated: {
          segments: [{ type: type(beats), dots: 0, beats, ...(beamsAt(i) ? { beams: beamsAt(i) } : {}) }],
          ...(accidental ? { accidental } : {}),
        },
      }
    }),
  )
  markBarStarts(notes)

  const rests: RestEvent[] = []
  // One whole-bar rest per bar on the resting hand.
  for (let bar = 0; bar < bars; bar += 1) {
    rests.push({
      id: `${id}-rest-${bar}`,
      onset: bar * barBeats,
      duration: barBeats,
      staff: other,
      voice: 1,
      measure: bar,
      wholeBar: true,
      notated: { segments: [{ type: 'whole', dots: 0, beats: barBeats }] },
    })
  }
  // And whatever is left of the last bar on the playing hand.
  if (total > played) {
    rests.push({
      id: `${id}-tail`,
      onset: played,
      duration: total - played,
      staff,
      voice: 1,
      measure: bars - 1,
      notated: { segments: [{ type: type(total - played), dots: 0, beats: total - played }] },
    })
  }

  return {
    id: `drill-${id}`,
    title: 'Practice',
    composer: '',
    notes,
    rests,
    clefs: [
      { beat: 0, staff: 1, sign: 'G', line: 2, octaveChange: 0 },
      { beat: 0, staff: 2, sign: 'F', line: 4, octaveChange: 0 },
    ],
    tempos: [{ beat: 0, bpm: 88 }],
    timeSignatures: [{ beat: 0, numerator: barBeats, denominator: 4 }],
    keys: [{ ...key, beat: 0 }],
    length: total,
  }
}

/** How many bars a prompt occupies, so the layout can be told. */
export function barsIn(prompt: Prompt): number {
  const ts = prompt.score.timeSignatures[0]
  return Math.max(1, Math.round(prompt.score.length / (ts.numerator * (4 / ts.denominator))))
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
    prompts.push({ id, steps: [pitches], score: scoreFor([pitches], key, hand, id) })
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
