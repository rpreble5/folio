/**
 * The arithmetic every exercise is built out of.
 *
 * Scale degrees, where the tonic sits, and how to keep a pattern inside the
 * range a hand can reach. It lives on its own because both the course and the
 * material it is made of need it, and neither should have to import the other.
 *
 * Everything here works in semitone offsets from a tonic rather than in absolute
 * pitches, which is what lets one written pattern be a real exercise in any key:
 * the shape is the exercise, and the key only decides where it starts.
 */

import type { KeyMark } from '../core/types'

export type Hand = 'left' | 'right'

/** Semitones above the tonic for each degree of a major scale. */
export const MAJOR = [0, 2, 4, 5, 7, 9, 11]

/** The tonic's pitch class, from the key's position on the circle of fifths. */
export const tonicOf = (key: KeyMark) => (((key.fifths * 7) % 12) + 12) % 12

/**
 * The tonic *nearest* a home position, rather than the next one above it.
 *
 * Rounding always upwards costs up to eleven semitones, which is most of an
 * octave: the same riff written in C and in B would sit almost an octave apart,
 * and one of them would be off the end of the staff. Nearest keeps every key
 * within half an octave of where the hand already is.
 */
export function rootNear(pitchClass: number, home: number): number {
  const up = home + ((((pitchClass - (home % 12)) % 12) + 12) % 12)
  return up - home <= 6 ? up : up - 12
}

/**
 * Shift a whole prompt by octaves until it sits inside a hand's range.
 *
 * Applied to the prompt rather than to each note, so the shape is never
 * distorted — a voicing that has to move moves in one piece. It only shifts
 * when the shift actually helps: material genuinely wider than the window is
 * left where it is rather than pushed off the other end.
 */
export function fitOctave(steps: number[][], low: number, high: number): number[][] {
  const flat = steps.flat()
  if (flat.length === 0) return steps
  let shift = 0
  const min = () => Math.min(...flat) + shift
  const max = () => Math.max(...flat) + shift
  while (max() > high && min() - 12 >= low) shift -= 12
  while (min() < low && max() + 12 <= high) shift += 12
  return shift === 0 ? steps : steps.map((step) => step.map((m) => m + shift))
}

/** Middle C is 60. The five-finger positions each hand starts from. */
export const RIGHT_HOME = 60
export const LEFT_HOME = 48

/** The comfortable reading range of each hand, for fitOctave. */
export const LEFT_RANGE: [number, number] = [36, 64]
export const RIGHT_RANGE: [number, number] = [55, 84]

/**
 * Where the hands divide when a prompt uses both.
 *
 * Middle C, which is where a grand staff divides anyway, so a note's staff and
 * the hand that plays it are the same decision made once.
 */
export const SPLIT = 60

/**
 * The scale as MIDI numbers, ascending from a starting octave.
 *
 * Working in scale degrees rather than semitones is what keeps generated phrases
 * inside the key without having to check each note afterwards — a step is one
 * index, a third is two, and both are automatically diatonic.
 */
export function scaleFrom(key: KeyMark, lowest: number, count: number): number[] {
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

/** Every semitone offset turned into a single-note step. */
export const line = (root: number, offsets: number[]): number[][] =>
  offsets.map((o) => [root + o])
