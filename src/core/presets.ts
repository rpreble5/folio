/**
 * Curated starting points.
 *
 * These are not modes — they are just themes with sensible defaults, and every
 * one of them is fully editable. The accessible presets are marked so the
 * Studio can say *why* they are safe rather than burying it in a settings
 * toggle: an accessible default that nobody understands gets switched off.
 */

import type { LineSet, LineStyle, Surface, Theme } from './theme'
import { makeSurface } from './theme'

/**
 * Pages to start from. Any colour works — the rest of the surface is derived
 * from it — but a curated set saves everyone from picking greys by hand.
 */
export const PAGES: { id: string; name: string; color: string }[] = [
  { id: 'slate', name: 'Slate', color: '#1b1e23' },
  { id: 'ink', name: 'Ink', color: '#101216' },
  { id: 'walnut', name: 'Walnut', color: '#221c19' },
  { id: 'forest', name: 'Forest', color: '#161f1b' },
  { id: 'paper', name: 'Paper', color: '#f7f8fb' },
  { id: 'cream', name: 'Cream', color: '#f6f1e6' },
  { id: 'sepia', name: 'Sepia', color: '#eee2cf' },
  { id: 'mist', name: 'Mist', color: '#e9eef2' },
]

const line = (over: Partial<LineStyle> = {}): LineStyle => ({
  show: true,
  width: 1,
  dash: 'solid',
  opacity: 1,
  color: '@auto',
  ...over,
})

const rollLines = (): LineSet => ({
  beat: line({ width: 1, opacity: 0.9 }),
  bar: line({ width: 1.5 }),
  // Faint but present: alignment stays precise at low contrast, so the anchor
  // can do its job without adding much clutter.
  anchor: line({ width: 1, opacity: 0.55, dash: 'dashed' }),
  staff: line({ show: false }),
  ledger: line({ show: false }),
})

const staffLines = (): LineSet => ({
  beat: line({ show: false }),
  bar: line({ width: 1.5 }),
  anchor: line({ show: false }),
  staff: line({ width: 1 }),
  ledger: line({ width: 1 }),
})

/**
 * The score's dark page sits a shade *lighter* than the app's ground, so it
 * reads as an object resting on a desk rather than a hole cut in the screen.
 */
export const DARK_SURFACE: Surface = makeSurface('#1b1e23')

export const PAPER_SURFACE: Surface = makeSurface('#f7f8fb')

const baseLayout = {
  mode: 'roll' as const,
  pitchAxis: 'keyboard' as const,
  barsPerSystem: 0,
  beatWidth: 84,
  laneHeight: 15,
  noteGap: 2,
  cornerRadius: 5,
  systemGap: 46,
  showKeyboard: true,
  showMeasureNumbers: true,
  showBlackKeyRows: true,
  lines: rollLines(),
  anchorOn: 'octave' as const,
}

export interface PresetMeta {
  /** Surfaced as a badge in the preset grid. */
  accessible?: 'Colour-blind safe' | 'High contrast' | 'Print ready'
}

export const PRESETS: (Theme & PresetMeta)[] = [
  {
    id: 'chromatic-roll',
    name: 'Chromatic Roll',
    description:
      'Pitch maps straight onto keyboard geometry, so what you see is where your hands go. Length is duration. The clearest first read for a complete beginner.',
    layout: { ...baseLayout },
    encodings: {
      // Fifths rather than rainbow: semitone neighbours are adjacent rows on a
      // roll, so they need the *most* colour distance, not the least.
      color: { source: 'pitch', order: 'fifths', tone: 'bright', rotate: 0,
        basis: 'pitchClass', accidentalShade: 'same',
        lightnessBy: 'none', lightnessSpread: 0.14 },
      shapeSet: 'capsule',
      label: 'none',
      labelScale: 1,
      sizeByVelocity: false,
      outlineWhat: 'accidentals',
      outlineStyle: 'tinted',
    },
    surface: { ...DARK_SURFACE },
    rules: [],
  },
  {
    id: 'classroom',
    name: 'Classroom',
    description:
      'The colour set used by chime bars and coloured bells, with letter names inside every note. Familiar ground if you have played in a school music room.',
    layout: { ...baseLayout, laneHeight: 17, cornerRadius: 8 },
    encodings: {
      color: { source: 'classroom', order: 'chromatic', tone: 'bright', rotate: 0,
        basis: 'pitchClass', accidentalShade: 'same',
        lightnessBy: 'none', lightnessSpread: 0.14 },
      shapeSet: 'circle',
      label: 'letter',
      labelScale: 1,
      sizeByVelocity: false,
      outlineWhat: 'none',
      outlineStyle: 'tinted',
    },
    surface: { ...DARK_SURFACE },
    rules: [],
  },
  {
    id: 'harmony',
    name: 'Harmony',
    accessible: 'Colour-blind safe',
    description:
      'Colour follows the note’s role in the key rather than its letter, so the tonic is blue and the dominant orange no matter what you play. Shapes repeat the same information, so the colour is never load-bearing on its own.',
    layout: { ...baseLayout, laneHeight: 16 },
    encodings: {
      color: { source: 'harmony', order: 'fifths', tone: 'bright', rotate: 0,
        basis: 'pitchClass', accidentalShade: 'same',
        lightnessBy: 'none', lightnessSpread: 0.14 },
      shapeSet: 'degree',
      label: 'degree',
      labelScale: 0.95,
      sizeByVelocity: false,
      outlineWhat: 'outsideKey',
      outlineStyle: 'tinted',
    },
    surface: { ...DARK_SURFACE },
    rules: [],
  },
  {
    id: 'hands',
    accessible: 'Colour-blind safe',
    name: 'Two Hands',
    description:
      'Two colours, one per hand, and nothing else competing for attention. The quietest way to read a piece when you are working out coordination.',
    layout: { ...baseLayout, laneHeight: 15 },
    encodings: {
      color: { source: 'hands', order: 'fifths', tone: 'bright', rotate: 0,
        basis: 'pitchClass', accidentalShade: 'same',
        lightnessBy: 'none', lightnessSpread: 0.14 },
      shapeSet: 'hand',
      label: 'none',
      labelScale: 1,
      sizeByVelocity: true,
      outlineWhat: 'none',
      outlineStyle: 'tinted',
    },
    surface: { ...DARK_SURFACE },
    rules: [],
  },
  {
    id: 'ink',
    name: 'Ink',
    accessible: 'Print ready',
    description:
      'No colour at all. Shape carries duration, position carries pitch, and the whole thing photocopies. Proof that the redesign is not just decoration.',
    layout: {
      ...baseLayout,
      laneHeight: 14,
      cornerRadius: 3,
      showBlackKeyRows: false,
      lines: { ...rollLines(), beat: line({ show: false }) },
    },
    encodings: {
      color: { source: 'ink', order: 'fifths', tone: 'bright', rotate: 0,
        basis: 'pitchClass', accidentalShade: 'same',
        lightnessBy: 'none', lightnessSpread: 0.14 },
      shapeSet: 'duration',
      label: 'none',
      labelScale: 1,
      sizeByVelocity: false,
      outlineWhat: 'accidentals',
      outlineStyle: 'hollow',
    },
    surface: { ...PAPER_SURFACE },
    rules: [],
  },
  {
    id: 'classic-plus',
    name: 'Classic+',
    description:
      'A real five-line staff at real diatonic spacing — but stems and flags are gone, replaced by length and colour. The bridge back to standard notation once you are ready for it.',
    layout: {
      ...baseLayout,
      mode: 'staff',
      pitchAxis: 'diatonic',
      laneHeight: 9,
      beatWidth: 58,
      cornerRadius: 7,
      showKeyboard: false,
      showBlackKeyRows: false,
      lines: staffLines(),
      anchorOn: 'none' as const,
    },
    encodings: {
      // Letter basis: a sharp shares its natural's hue and the accidental rides
      // on shape and fill instead, which this preset already provides.
      color: { source: 'pitch', order: 'chromatic', tone: 'deep', rotate: 0,
        basis: 'letter', accidentalShade: 'darker',
        lightnessBy: 'none', lightnessSpread: 0.14 },
      shapeSet: 'accidental',
      label: 'none',
      labelScale: 1,
      sizeByVelocity: false,
      outlineWhat: 'accidentals',
      outlineStyle: 'hollow',
    },
    surface: { ...PAPER_SURFACE },
    rules: [],
  },
]

export function getPreset(id: string): Theme & PresetMeta {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}
