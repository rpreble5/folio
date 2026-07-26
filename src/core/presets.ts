/**
 * Curated starting points.
 *
 * These are not modes — they are just themes with sensible defaults, and every
 * one of them is fully editable. The accessible presets are marked so the
 * Studio can say *why* they are safe rather than burying it in a settings
 * toggle: an accessible default that nobody understands gets switched off.
 */

import type { Surface, Theme } from './theme'

/**
 * The score's dark page sits a shade *lighter* than the app's ground, so it
 * reads as an object resting on a desk rather than a hole cut in the screen.
 */
export const DARK_SURFACE: Surface = {
  background: '#1b1e23',
  panel: '#22262c',
  grid: '#212429',
  gridStrong: '#2f343c',
  text: '#e8eaee',
  muted: '#7a828c',
  accent: '#ece6da',
  staffLine: '#363b44',
}

export const PAPER_SURFACE: Surface = {
  background: '#f7f8fb',
  panel: '#ffffff',
  grid: '#eceef4',
  gridStrong: '#d3d8e3',
  text: '#151a23',
  muted: '#6b7385',
  accent: '#2b3038',
  staffLine: '#aab2c4',
}

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
  showGrid: true,
  showBarlines: true,
  showMeasureNumbers: true,
  showStaffLines: false,
  showLedgerLines: false,
  showBlackKeyRows: true,
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
      // Fifths rather than spectral: semitone neighbours are adjacent rows on a
      // roll, so they need the *most* colour distance, not the least.
      palette: 'fifths',
      shapeSet: 'capsule',
      label: 'none',
      labelScale: 1,
      sizeByVelocity: false,
      outlineChromatics: false,
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
      palette: 'classroom',
      shapeSet: 'circle',
      label: 'letter',
      labelScale: 1,
      sizeByVelocity: false,
      outlineChromatics: false,
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
      palette: 'function',
      shapeSet: 'degree',
      label: 'degree',
      labelScale: 0.95,
      sizeByVelocity: false,
      outlineChromatics: true,
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
      palette: 'hands',
      shapeSet: 'hand',
      label: 'none',
      labelScale: 1,
      sizeByVelocity: true,
      outlineChromatics: false,
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
      showGrid: false,
    },
    encodings: {
      palette: 'ink',
      shapeSet: 'duration',
      label: 'none',
      labelScale: 1,
      sizeByVelocity: false,
      outlineChromatics: true,
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
      showStaffLines: true,
      showLedgerLines: true,
      showBlackKeyRows: false,
      showGrid: false,
    },
    encodings: {
      palette: 'classroom',
      shapeSet: 'accidental',
      label: 'none',
      labelScale: 1,
      sizeByVelocity: false,
      outlineChromatics: false,
    },
    surface: { ...PAPER_SURFACE },
    rules: [],
  },
]

export function getPreset(id: string): Theme & PresetMeta {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}
