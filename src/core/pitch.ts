/** Pitch maths: spelling, scale degrees, and piano keyboard geometry. */

import type { KeyMark, Spelling, Step } from './types'

export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** Semitones above C for each letter name. */
const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Diatonic index (0..6) for each letter name — the vertical axis of a staff. */
const STEP_INDEX: Record<Step, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }

/** 0–6 for C–B. The note's *written* letter, ignoring any accidental. */
export function letterIndex(step: Step): number {
  return STEP_INDEX[step]
}

export function spellingToMidi(s: Spelling): number {
  return (s.octave + 1) * 12 + STEP_SEMITONES[s.step] + s.alter
}

/**
 * Continuous diatonic position — how many letter-name steps above C-1 a pitch
 * sits. This is the staff's vertical axis, and note that it deliberately
 * ignores `alter`: C#4 and C4 occupy the same line, distinguished by an
 * accidental rather than by height. That non-linearity is exactly what the
 * chromatic and keyboard axes exist to escape.
 */
export function diatonicIndex(s: Spelling): number {
  return s.octave * 7 + STEP_INDEX[s.step]
}

/** 0 = C, 1 = C#, … 11 = B. */
export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1
}

/** The natural whose letter each pitch class takes, and by how much it is altered. */
const SHARP_SPELLING: [Step, number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
]

const FLAT_SPELLING: [Step, number][] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
]

/**
 * How to write a pitch, given the key it is in.
 *
 * MIDI knows only which key went down, so a black key has two equally true
 * names and the key signature decides between them: sharp keys spell F♯, flat
 * keys spell G♭. Getting this wrong does not just look wrong — the spelling is
 * what puts the notehead on a line or a space, so a G♭ written as F♯ appears a
 * step too low on the staff.
 *
 * Every black-key spelling stays inside the octave it started in, because the
 * octave boundary falls at C and none of the five reaches across it.
 */
export function spellPitch(midi: number, key: KeyMark): Spelling {
  const table = key.fifths < 0 ? FLAT_SPELLING : SHARP_SPELLING
  const [step, alter] = table[pitchClass(midi)]
  return { step, alter, octave: octaveOf(midi) }
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

export function isBlackKey(midi: number): boolean {
  return BLACK_KEYS.has(pitchClass(midi))
}

/**
 * Position along a piano keyboard, measured in white-key widths from C-1.
 *
 * White keys land on integers. Black keys land between their neighbours, offset
 * slightly toward the geometry of a real keyboard rather than at a naive
 * midpoint — on an actual piano the black keys within a group are not evenly
 * centred, and matching that is what makes the display read as *the instrument*
 * rather than as a grid that resembles it.
 */
const BLACK_OFFSETS: Record<number, number> = {
  1: 0.55, // C# sits slightly left of centre between C and D
  3: 0.45, // D# slightly right
  6: 0.6, // F#
  8: 0.5, // G#
  10: 0.4, // A#
}

export function keyboardPosition(midi: number): number {
  const pc = pitchClass(midi)
  const oct = Math.floor(midi / 12)
  const whitesBelow: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 }

  if (!BLACK_KEYS.has(pc)) return oct * 7 + whitesBelow[pc]

  // Anchor to the white key immediately below, then nudge by the offset.
  const belowPc = pc - 1
  return oct * 7 + whitesBelow[belowPc] + BLACK_OFFSETS[pc]
}

// ---------------------------------------------------------------------------
// Key context
// ---------------------------------------------------------------------------

/** Tonic pitch class for a key signature. */
export function tonicOf(key: KeyMark): number {
  const majorTonic = (((key.fifths * 7) % 12) + 12) % 12
  return key.mode === 'minor' ? (majorTonic + 9) % 12 : majorTonic
}

/**
 * Scale degree 0..11 relative to the tonic. Returned as a chromatic distance so
 * that non-diatonic notes stay addressable — a palette can give the five
 * chromatic degrees a neutral grey while the seven diatonic degrees carry hue.
 */
export function scaleDegree(midi: number, key: KeyMark): number {
  return (((pitchClass(midi) - tonicOf(key)) % 12) + 12) % 12
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]

export function isDiatonic(midi: number, key: KeyMark): boolean {
  const degree = scaleDegree(midi, key)
  const scale = key.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : MAJOR_SCALE
  return scale.includes(degree)
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export function noteName(s: Spelling, includeOctave = false): string {
  const accidental = s.alter > 0 ? '♯'.repeat(s.alter) : s.alter < 0 ? '♭'.repeat(-s.alter) : ''
  return `${s.step}${accidental}${includeOctave ? s.octave : ''}`
}

const SOLFEGE_MOVABLE = ['Do', 'Ra', 'Re', 'Me', 'Mi', 'Fa', 'Fi', 'Sol', 'Le', 'La', 'Te', 'Ti']
const SOLFEGE_FIXED = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']

/** Movable-do follows the key; fixed-do pins Do to C. */
export function solfege(midi: number, key: KeyMark, movable = true): string {
  return movable ? SOLFEGE_MOVABLE[scaleDegree(midi, key)] : SOLFEGE_FIXED[pitchClass(midi)]
}

const DEGREE_LABELS = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7']

export function degreeLabel(midi: number, key: KeyMark): string {
  return DEGREE_LABELS[scaleDegree(midi, key)]
}

const KEY_NAMES_MAJOR = [
  'C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯',
]
const KEY_NAMES_MINOR = [
  'a♭', 'e♭', 'b♭', 'f', 'c', 'g', 'd', 'a', 'e', 'b', 'f♯', 'c♯', 'g♯', 'd♯', 'a♯',
]

export function keyName(key: KeyMark): string {
  const idx = key.fifths + 7
  const name = key.mode === 'minor' ? KEY_NAMES_MINOR[idx] : KEY_NAMES_MAJOR[idx]
  if (!name) return 'C major'
  return key.mode === 'minor'
    ? `${name.toUpperCase()[0]}${name.slice(1)} minor`
    : `${name} major`
}
