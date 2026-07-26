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
import { inkOn, oklch } from './oklch'

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

// ---------------------------------------------------------------------------
// Hue ordering
// ---------------------------------------------------------------------------

/**
 * How a pitch class is mapped onto the colour wheel.
 *
 * This is the choice that matters most, and the obvious answer is the wrong
 * one. Ordering hues chromatically means semitone neighbours — which are also
 * *adjacent rows* on a piano roll, and the pairs music asks you to
 * distinguish most often — get near-identical colours. The encoding ends up
 * fighting itself precisely where it is needed.
 */
export type HueOrder = 'chromatic' | 'fifths' | 'keys'

/**
 * Position of a pitch class on the circle of fifths.
 *
 * Multiplying by 7 walks the circle, because a fifth is seven semitones and 7
 * is its own inverse modulo 12. Using this as the hue index puts every semitone
 * pair 210° apart — nearly opposite — while a fifth apart lands adjacent, so
 * colour distance tracks harmonic distance instead of working against it.
 */
const fifthsIndex = (pc: number): number => (pc * 7) % 12

const NATURALS = [0, 2, 4, 5, 7, 9, 11]
const LETTER_OF = new Map(NATURALS.map((pc, i) => [pc, i]))
const ACCIDENTALS = [1, 3, 6, 8, 10]
const ACCIDENTAL_OF = new Map(ACCIDENTALS.map((pc, i) => [pc, i]))

/**
 * Warm hue for a white key, cool hue for a black key.
 *
 * Colour then doubles as an accidental indicator, and because every semitone
 * step crosses between the two bands, neighbours are always far apart. Within
 * each band the order is shuffled (×4 mod 7, ×2 mod 5) so that consecutive
 * letters — E and F especially — do not land side by side either.
 */
function keysHue(pc: number): number {
  const letter = LETTER_OF.get(pc)
  // The white band is the wide one because it has to carry seven hues, and
  // because E–F and B–C are the only semitone steps where both notes are white
  // — the lightness split cannot separate those, so hue is all there is.
  if (letter !== undefined) return 20 + ((letter * 4) % 7) * 25
  const accidental = ACCIDENTAL_OF.get(pc) ?? 0
  return 195 + ((accidental * 2) % 5) * 32
}

function hueFor(order: HueOrder, pc: number, offset: number): number {
  if (order === 'keys') return keysHue(pc)
  const index = order === 'fifths' ? fifthsIndex(pc) : pc
  return (index * 30 + offset) % 360
}

interface Generated {
  id: string
  name: string
  note: string
  order: HueOrder
  /** A pair adds a luminance channel on top of hue. See {@link Generated.toneBy}. */
  lightness: number | [number, number]
  /**
   * How a lightness pair is assigned. 'index' alternates note by note; 'keys'
   * gives the first value to white keys and the second to black ones, which
   * mirrors the instrument and separates every semitone step by brightness as
   * well as hue.
   */
  toneBy?: 'index' | 'keys'
  chroma: number
  hueOffset?: number
  cvdSafe?: boolean
}

function generate(spec: Generated): Palette {
  const colors: string[] = []
  const onColor: string[] = []

  for (let pc = 0; pc < 12; pc++) {
    const L = Array.isArray(spec.lightness)
      ? spec.lightness[
          spec.toneBy === 'keys' ? (LETTER_OF.has(pc) ? 0 : 1) : pc % 2
        ]
      : spec.lightness
    colors.push(oklch(L, spec.chroma, hueFor(spec.order, pc, spec.hueOffset ?? 25)))
    onColor.push(inkOn(L))
  }

  return {
    id: spec.id,
    name: spec.name,
    note: spec.note,
    cvdSafe: spec.cvdSafe ?? false,
    domain: 'pitchClass',
    colors,
    onColor,
  }
}

export const PALETTES: Palette[] = [
  generate({
    id: 'fifths',
    name: 'Fifths',
    note: 'Hue follows the circle of fifths, so neighbours land opposite each other and notes a fifth apart look related.',
    order: 'fifths',
    lightness: 0.76,
    chroma: 0.15,
  }),
  generate({
    id: 'keys',
    name: 'Black & White',
    note: 'White keys warm and light, black keys cool and dark — the way the instrument looks.',
    order: 'keys',
    // 0.80 rather than 0.85: above that the gamut clips the chroma hard and the
    // whole white band washes out toward each other.
    lightness: [0.8, 0.56],
    toneBy: 'keys',
    chroma: 0.15,
  }),
  generate({
    id: 'neon',
    name: 'Neon',
    note: 'Fifths order at full chroma. Loudest on a dark page.',
    order: 'fifths',
    lightness: 0.78,
    chroma: 0.21,
  }),
  generate({
    id: 'pastel',
    name: 'Pastel',
    note: 'Fifths order, soft and light. Quiet to read for a long stretch.',
    order: 'fifths',
    lightness: 0.87,
    chroma: 0.075,
  }),
  generate({
    id: 'earth',
    name: 'Earth',
    note: 'Muted and low-chroma. For anyone who finds a rainbow tiring.',
    order: 'fifths',
    lightness: 0.66,
    chroma: 0.07,
  }),
  generate({
    id: 'contrast',
    name: 'Contrast',
    note: 'Lightness alternates note by note, so neighbours differ in brightness as well as hue.',
    order: 'fifths',
    lightness: [0.89, 0.53],
    chroma: 0.12,
  }),
  generate({
    id: 'deep',
    name: 'Deep',
    note: 'Fifths order, darkened for a paper page where bright colours wash out.',
    order: 'fifths',
    lightness: 0.56,
    chroma: 0.14,
  }),
  generate({
    id: 'spectral',
    name: 'Spectral',
    note: 'Hue follows pitch in order — a rainbow, but semitone neighbours end up nearly the same colour.',
    order: 'chromatic',
    lightness: 0.76,
    chroma: 0.15,
  }),
  {
    id: 'classroom',
    name: 'Classroom',
    note: 'The education colour set, familiar from coloured chime bars.',
    cvdSafe: false,
    domain: 'pitchClass',
    colors: [
      '#E5232B', '#EC5B24', '#F28A1C', '#F6B31A', '#F3E515', '#9ACD32',
      '#3FAE4A', '#0F9E8E', '#2E7FD1', '#7B4FC9', '#B454C4', '#E5479B',
    ],
    onColor: [PAPER, INK, INK, INK, INK, INK, INK, PAPER, PAPER, PAPER, PAPER, PAPER],
  },
  {
    id: 'function',
    name: 'Harmony',
    note: 'Colour follows scale degree — tonic blue, dominant orange, in every key.',
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
    note: 'Two colours, one per hand. The calmest option, and safe for every kind of colour vision.',
    cvdSafe: true,
    domain: 'hand',
    colors: ['#E69F00', '#0072B2'],
    onColor: [INK, PAPER],
  },
  {
    id: 'register',
    name: 'Register',
    note: 'One hue that lightens as pitch rises. Reads as height, not category.',
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
    note: 'No colour at all — shape, length and label carry everything.',
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
