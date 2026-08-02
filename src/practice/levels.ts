/**
 * A short course, in order.
 *
 * Eight levels, each unlocking the next. Deliberately small: a curriculum that
 * tries to cover everything ends up covering nothing, and the point of gating is
 * to say *this next*, which only works if the list is short enough to see.
 *
 * Two kinds of material, and the difference matters:
 *
 *   - **Warm-ups are fixed.** The same notes in the same order every time. You
 *     are not reading them by the third day, and that is the point — a warm-up is
 *     for getting the hands moving, and one that changes underneath you is a
 *     test rather than a warm-up.
 *   - **Everything else is generated** from a seed, so it is different each
 *     attempt but reproducible when something goes wrong.
 *
 * Levels are ordered by what they ask of the reader, not by how the music
 * sounds: hand position first, then steps, then leaps, then chords. Reading a
 * third is genuinely harder than reading a second, and reading a chord is harder
 * than either, because the eye has to take three heights at once.
 */

import type { KeyMark } from '../core/types'
import type { Prompt } from './drills'
import { scoreFor } from './drills'

export type Hand = 'left' | 'right'

export interface Level {
  id: string
  name: string
  /** One line, shown on the card. What this level asks of you. */
  goal: string
  make(key: KeyMark, seed: number): Prompt[]
  /**
   * Fraction of prompts that must be right first time to pass.
   *
   * Not 100%: a bar that demands perfection is a bar people stop attempting, and
   * the aim is fluency rather than a clean sheet. Warm-ups sit lower still,
   * because fumbling one is not a reading failure.
   */
  pass: number
}

/** Deterministic, so a level plays the same way twice when it needs to. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Semitones above the tonic for each degree of a major scale. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11]

/** The tonic's pitch class, from the key's position on the circle of fifths. */
const tonicOf = (key: KeyMark) => (((key.fifths * 7) % 12) + 12) % 12

/**
 * The scale as MIDI numbers, ascending from a starting octave.
 *
 * Working in scale degrees rather than semitones is what keeps generated phrases
 * inside the key without having to check each note afterwards — a step is one
 * index, a third is two, and both are automatically diatonic.
 */
function scaleFrom(key: KeyMark, lowest: number, count: number): number[] {
  const tonic = tonicOf(key)
  const out: number[] = []
  let degree = 0
  let octave = Math.floor(lowest / 12)

  while (out.length < count) {
    const midi = octave * 12 + tonic + MAJOR[degree % 7]
    if (midi >= lowest) out.push(midi)
    degree += 1
    if (degree % 7 === 0) octave += 1
  }
  return out
}

const build = (steps: number[][], key: KeyMark, hand: Hand, id: string): Prompt => ({
  id,
  steps,
  score: scoreFor(steps, key, hand, id),
})

/**
 * The five-finger pattern, up and down.
 *
 * The oldest exercise there is, and still the right first one: five notes under
 * five fingers with no thumb crossing, so the hand never has to move.
 */
function fiveFinger(key: KeyMark, hand: Hand, lowest: number): Prompt[] {
  const notes = scaleFrom(key, lowest, 5)
  const up = notes
  const down = [...notes].reverse()

  return [
    build([[up[0]], [up[1]], [up[2]], [up[3]]], key, hand, 'w0'),
    build([[up[4]], [down[1]], [down[2]], [down[3]]], key, hand, 'w1'),
    build([[up[0]], [up[2]], [up[4]], [up[2]]], key, hand, 'w2'),
    build([[up[4]], [up[3]], [up[2]], [up[1]]], key, hand, 'w3'),
  ]
}

/** A phrase that moves by a fixed set of intervals, in scale degrees. */
function phrases(
  key: KeyMark,
  hand: Hand,
  lowest: number,
  span: number,
  intervals: number[],
  length: number,
  count: number,
  seed: number,
): Prompt[] {
  const rand = random(seed)
  const notes = scaleFrom(key, lowest, span)
  const out: Prompt[] = []

  for (let i = 0; i < count; i += 1) {
    // Start somewhere the whole phrase can fit without running off either end.
    const reach = intervals.reduce((m, v) => Math.max(m, Math.abs(v)), 0) * (length - 1)
    let index = Math.floor(rand() * Math.max(1, notes.length - reach))
    const steps: number[][] = [[notes[index]]]

    for (let n = 1; n < length; n += 1) {
      const move = intervals[Math.floor(rand() * intervals.length)]
      const direction = rand() < 0.5 ? -1 : 1
      let next = index + move * direction
      // Turn back rather than clamp: a phrase that runs into the ceiling and
      // stays there repeats a note, which reads as a mistake in the material.
      if (next < 0 || next >= notes.length) next = index - move * direction
      index = Math.max(0, Math.min(notes.length - 1, next))
      steps.push([notes[index]])
    }

    out.push(build(steps, key, hand, `p${i}`))
  }
  return out
}

/** Root-position triads built by stacking scale degrees. */
function triads(key: KeyMark, hand: Hand, lowest: number, count: number, seed: number): Prompt[] {
  const rand = random(seed)
  const notes = scaleFrom(key, lowest, 12)
  return Array.from({ length: count }, (_, i) => {
    const root = Math.floor(rand() * (notes.length - 5))
    return build([[notes[root], notes[root + 2], notes[root + 4]]], key, hand, `t${i}`)
  })
}

/** Phrases where the first and last steps are chords and the middle is melody. */
function chordPhrases(key: KeyMark, hand: Hand, lowest: number, count: number, seed: number): Prompt[] {
  const rand = random(seed)
  const notes = scaleFrom(key, lowest, 10)
  return Array.from({ length: count }, (_, i) => {
    const root = Math.floor(rand() * (notes.length - 6))
    const chord = [notes[root], notes[root + 2], notes[root + 4]]
    const a = notes[root + 1 + Math.floor(rand() * 3)]
    const b = notes[root + 1 + Math.floor(rand() * 3)]
    return build([chord, [a], [b]], key, hand, `c${i}`)
  })
}

/** Alternate hands prompt by prompt, so both stay in play. */
function alternating(make: (hand: Hand, seed: number) => Prompt[], seed: number): Prompt[] {
  const right = make('right', seed)
  const left = make('left', seed + 101)
  const out: Prompt[] = []
  for (let i = 0; i < Math.max(right.length, left.length); i += 1) {
    if (right[i]) out.push({ ...right[i], id: `r${i}` })
    if (left[i]) out.push({ ...left[i], id: `l${i}` })
  }
  return out
}

/** Middle C is 60. The five-finger positions each hand starts from. */
const RIGHT_HOME = 60
const LEFT_HOME = 48

export const LEVELS: Level[] = [
  {
    id: 'warm-right',
    name: 'Warm up · right hand',
    goal: 'Five notes under five fingers. No thumb crossing, no hand movement.',
    make: (key) => fiveFinger(key, 'right', RIGHT_HOME),
    pass: 0.7,
  },
  {
    id: 'warm-left',
    name: 'Warm up · left hand',
    goal: 'The same pattern an octave and a half below, read on the bass staff.',
    make: (key) => fiveFinger(key, 'left', LEFT_HOME),
    pass: 0.7,
  },
  {
    id: 'steps-right',
    name: 'Steps',
    goal: 'Short phrases that move one note at a time. The easiest interval to read.',
    make: (key, seed) => phrases(key, 'right', RIGHT_HOME, 8, [1], 3, 8, seed),
    pass: 0.75,
  },
  {
    id: 'steps-both',
    name: 'Steps · both hands',
    goal: 'The same, alternating hands, so the bass staff stops being unfamiliar.',
    make: (key, seed) =>
      alternating(
        (hand, s) => phrases(key, hand, hand === 'left' ? LEFT_HOME : RIGHT_HOME, 8, [1], 3, 4, s),
        seed,
      ),
    pass: 0.75,
  },
  {
    id: 'skips',
    name: 'Skips',
    goal: 'Phrases that leap a third. Line to line, or space to space.',
    make: (key, seed) => phrases(key, 'right', RIGHT_HOME, 8, [2], 3, 8, seed),
    pass: 0.75,
  },
  {
    id: 'mixed',
    name: 'Steps & skips',
    goal: 'Four notes mixing both, over a wider range. Reading rather than guessing.',
    make: (key, seed) => phrases(key, 'right', RIGHT_HOME - 7, 12, [1, 2], 4, 10, seed),
    pass: 0.75,
  },
  {
    id: 'triads',
    name: 'Triads',
    goal: 'Three notes at once. The eye has to take all three heights together.',
    make: (key, seed) => triads(key, 'right', RIGHT_HOME, 8, seed),
    pass: 0.7,
  },
  {
    id: 'chord-phrases',
    name: 'Chords in phrases',
    goal: 'A chord, then a melody out of it. Both kinds of reading in one bar.',
    make: (key, seed) => chordPhrases(key, 'right', RIGHT_HOME, 8, seed),
    pass: 0.7,
  },
]

export const levelById = (id: string): Level | undefined => LEVELS.find((l) => l.id === id)
