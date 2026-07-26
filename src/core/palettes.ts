/**
 * Colour and shape vocabularies.
 *
 * A palette owns the dimension it maps, rather than being a bag of colours you
 * point at an arbitrary dimension. That collapses two controls into one in the
 * UI ("colour by: Harmony") and makes invalid combinations unrepresentable.
 *
 * Every entry declares `cvdSafe` honestly. Twelve distinguishable hues do not
 * exist for someone with colour vision deficiency, so palettes that need twelve
 * are marked unsafe and the app pairs them with a redundant channel instead of
 * pretending otherwise.
 */

import type { KeyMark, NoteEvent } from './types'
import { isBlackKey, octaveOf, pitchClass, scaleDegree } from './pitch'

export type ShapeKind =
  | 'capsule'
  | 'rect'
  | 'circle'
  | 'hexagon'
  | 'diamond'
  | 'triangleUp'
  | 'triangleDown'
  | 'chevron'

export interface Palette {
  id: string
  name: string
  /** Short line shown under the swatch in the Studio. */
  note: string
  cvdSafe: boolean
  /** Which musical dimension this palette reads. */
  domain: 'pitchClass' | 'scaleDegree' | 'hand' | 'octave' | 'fixed'
  colors: string[]
  /** Text colour to use on top of each swatch, when the label sits inside. */
  onColor?: string[]
}

const INK = '#0b0d11'
const PAPER = '#f4f6fb'

export const PALETTES: Palette[] = [
  {
    id: 'classroom',
    name: 'Classroom',
    note: 'The education colour set — red C, rainbow upward. Familiar to anyone who has used coloured chime bars.',
    cvdSafe: false,
    domain: 'pitchClass',
    colors: [
      '#E5232B', '#EC5B24', '#F28A1C', '#F6B31A', '#F3E515', '#9ACD32',
      '#3FAE4A', '#0F9E8E', '#2E7FD1', '#7B4FC9', '#B454C4', '#E5479B',
    ],
    onColor: [PAPER, INK, INK, INK, INK, INK, INK, PAPER, PAPER, PAPER, PAPER, PAPER],
  },
  {
    id: 'spectral',
    name: 'Spectral',
    note: 'Twelve evenly spaced hues, tuned for a dark surface. Maximum distinction if your colour vision is typical.',
    cvdSafe: false,
    domain: 'pitchClass',
    colors: [
      '#FF5A5A', '#FF8340', '#FFA83A', '#FFC93D', '#EDE04A', '#A8D95A',
      '#4FC77D', '#3FC2C2', '#4AA3E8', '#6B7BE8', '#A366E0', '#E060C0',
    ],
    onColor: Array(12).fill(INK),
  },
  {
    id: 'function',
    name: 'Harmony',
    note: 'Colour follows scale degree, so the tonic is always blue and the dominant always orange — in every key. Non-scale notes stay grey.',
    cvdSafe: true,
    domain: 'scaleDegree',
    // Okabe–Ito on the seven diatonic degrees; chromatic degrees deliberately grey.
    colors: [
      '#0072B2', '#7A8698', '#56B4E9', '#7A8698', '#009E73', '#F0E442',
      '#7A8698', '#E69F00', '#7A8698', '#CC79A7', '#7A8698', '#D55E00',
    ],
    onColor: [
      PAPER, PAPER, INK, PAPER, PAPER, INK,
      PAPER, INK, PAPER, INK, PAPER, PAPER,
    ],
  },
  {
    id: 'hands',
    name: 'Hands',
    note: 'Two colours only — one per hand. The calmest option, and safe for every kind of colour vision.',
    cvdSafe: true,
    domain: 'hand',
    colors: ['#E69F00', '#0072B2'],
    onColor: [INK, PAPER],
  },
  {
    id: 'register',
    name: 'Register',
    note: 'A single hue that lightens as pitch rises. Reads as height rather than as category.',
    cvdSafe: true,
    domain: 'octave',
    colors: [
      '#1F3A6E', '#25508F', '#2C68AE', '#3E85C9', '#5EA0DC', '#86BCE9',
      '#AED4F2', '#CFE6F8', '#E6F2FC',
    ],
    onColor: [PAPER, PAPER, PAPER, PAPER, INK, INK, INK, INK, INK],
  },
  {
    id: 'ink',
    name: 'Ink',
    note: 'No colour at all. Everything is carried by shape, length, and label — the print-ready baseline.',
    cvdSafe: true,
    domain: 'fixed',
    // Sentinel: resolved against the current surface so Ink works on paper and
    // on a dark stage without needing two copies of the palette.
    colors: ['@ink'],
    onColor: ['@paper'],
  },
]

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

/** Index into a palette's colour array for a given note. */
function paletteIndex(palette: Palette, note: NoteEvent, key: KeyMark): number {
  switch (palette.domain) {
    case 'pitchClass':
      return pitchClass(note.midi)
    case 'scaleDegree':
      return scaleDegree(note.midi, key)
    case 'hand':
      return note.hand === 'right' ? 0 : 1
    case 'octave':
      return Math.max(0, Math.min(palette.colors.length - 1, octaveOf(note.midi)))
    case 'fixed':
      return 0
  }
}

export function colorFor(palette: Palette, note: NoteEvent, key: KeyMark): string {
  return palette.colors[paletteIndex(palette, note, key)] ?? palette.colors[0]
}

export function onColorFor(palette: Palette, note: NoteEvent, key: KeyMark): string {
  const idx = paletteIndex(palette, note, key)
  return palette.onColor?.[idx] ?? INK
}

// ---------------------------------------------------------------------------
// Shape vocabularies
// ---------------------------------------------------------------------------

export interface ShapeSet {
  id: string
  name: string
  note: string
  domain: 'fixed' | 'accidental' | 'duration' | 'hand' | 'scaleDegree'
  shapes: ShapeKind[]
}

export const SHAPE_SETS: ShapeSet[] = [
  {
    id: 'capsule',
    name: 'Capsule',
    note: 'One rounded bar for every note. Length carries duration.',
    domain: 'fixed',
    shapes: ['capsule'],
  },
  {
    id: 'circle',
    name: 'Circle',
    note: 'Round heads, closest in feel to a traditional notehead.',
    domain: 'fixed',
    shapes: ['circle'],
  },
  {
    id: 'accidental',
    name: 'Sharps & flats',
    note: 'Naturals are round, sharps point up, flats point down. A second channel that says the same thing colour does.',
    domain: 'accidental',
    // [natural, sharp, flat]
    shapes: ['circle', 'triangleUp', 'triangleDown'],
  },
  {
    id: 'duration',
    name: 'Duration',
    note: 'Shape changes with note length — what stems and flags do, without the stems and flags.',
    domain: 'duration',
    // [sixteenth, eighth, quarter, half, whole]
    shapes: ['diamond', 'triangleUp', 'circle', 'hexagon', 'rect'],
  },
  {
    id: 'hand',
    name: 'Hands',
    note: 'Right hand rounded, left hand squared.',
    domain: 'hand',
    shapes: ['capsule', 'rect'],
  },
  {
    id: 'degree',
    name: 'Scale degree',
    note: 'A distinct shape per degree, with chromatic notes as diamonds. The strongest redundant channel for colour-blind readers.',
    domain: 'scaleDegree',
    shapes: [
      'hexagon', 'diamond', 'circle', 'diamond', 'triangleUp', 'rect',
      'diamond', 'chevron', 'diamond', 'capsule', 'diamond', 'triangleDown',
    ],
  },
]

export function getShapeSet(id: string): ShapeSet {
  return SHAPE_SETS.find((s) => s.id === id) ?? SHAPE_SETS[0]
}

/** Bucket a duration in beats into the five traditional length classes. */
function durationBucket(beats: number): number {
  if (beats < 0.375) return 0 // sixteenth
  if (beats < 0.75) return 1 // eighth
  if (beats < 1.5) return 2 // quarter
  if (beats < 3) return 3 // half
  return 4 // whole
}

export function shapeFor(set: ShapeSet, note: NoteEvent, key: KeyMark): ShapeKind {
  switch (set.domain) {
    case 'fixed':
      return set.shapes[0]
    case 'accidental':
      if (note.spelling.alter > 0) return set.shapes[1]
      if (note.spelling.alter < 0) return set.shapes[2]
      // A black key with no written accidental (MIDI import) still reads as sharp.
      return isBlackKey(note.midi) ? set.shapes[1] : set.shapes[0]
    case 'duration':
      return set.shapes[durationBucket(note.duration)]
    case 'hand':
      return set.shapes[note.hand === 'right' ? 0 : 1]
    case 'scaleDegree':
      return set.shapes[scaleDegree(note.midi, key)] ?? set.shapes[0]
  }
}
