/**
 * The theme: a declarative description of how music becomes picture.
 *
 * Themes cascade like CSS. A base encoding covers every note, and rules with
 * selectors layer on top in specificity order. That is what makes "I want G to
 * be a hexagon" a one-line addition rather than a fork of the whole palette —
 * and it keeps a shared theme readable as a diff.
 */

import type { Hand, KeyMark, NoteEvent } from './types'
import { degreeLabel, noteName, octaveOf, pitchClass, scaleDegree, solfege } from './pitch'
import {
  type ShapeKind,
  colorFor,
  getPalette,
  getShapeSet,
  onColorFor,
  shapeFor,
} from './palettes'

export type LayoutMode = 'roll' | 'staff'
export type PitchAxis = 'keyboard' | 'chromatic' | 'diatonic'
export type LabelKind = 'none' | 'letter' | 'letterOctave' | 'solfege' | 'degree' | 'finger'

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export type Selector =
  | { kind: 'hand'; hand: Hand }
  | { kind: 'octave'; octave: number }
  | { kind: 'scaleDegree'; degree: number }
  | { kind: 'pitchClass'; pitchClass: number }
  | { kind: 'pitchClassOctave'; pitchClass: number; octave: number }
  | { kind: 'note'; noteId: string }

/**
 * Higher wins. The gaps are generous so new selector kinds can slot in without
 * renumbering, and `note` sits far above everything so a hand-tweaked single
 * note is never overridden by a broad rule added later.
 */
const SPECIFICITY: Record<Selector['kind'], number> = {
  hand: 10,
  octave: 20,
  scaleDegree: 30,
  pitchClass: 40,
  pitchClassOctave: 60,
  note: 1000,
}

export function matches(sel: Selector, note: NoteEvent, key: KeyMark): boolean {
  switch (sel.kind) {
    case 'hand':
      return note.hand === sel.hand
    case 'octave':
      return octaveOf(note.midi) === sel.octave
    case 'scaleDegree':
      return scaleDegree(note.midi, key) === sel.degree
    case 'pitchClass':
      return pitchClass(note.midi) === sel.pitchClass
    case 'pitchClassOctave':
      return pitchClass(note.midi) === sel.pitchClass && octaveOf(note.midi) === sel.octave
    case 'note':
      return note.id === sel.noteId
  }
}

const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const DEGREE_NAMES = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7']

export function describeSelector(sel: Selector): string {
  switch (sel.kind) {
    case 'hand':
      return sel.hand === 'right' ? 'Right hand' : 'Left hand'
    case 'octave':
      return `Octave ${sel.octave}`
    case 'scaleDegree':
      return `Degree ${DEGREE_NAMES[sel.degree]}`
    case 'pitchClass':
      return `Every ${PC_NAMES[sel.pitchClass]}`
    case 'pitchClassOctave':
      return `${PC_NAMES[sel.pitchClass]}${sel.octave}`
    case 'note':
      return 'This note'
  }
}

// ---------------------------------------------------------------------------
// Style declarations
// ---------------------------------------------------------------------------

/** A partial override. Every field is optional so rules merge cleanly. */
export interface StyleDecl {
  fill?: string
  stroke?: string
  strokeWidth?: number
  shape?: ShapeKind
  label?: LabelKind
  labelColor?: string
  opacity?: number
  /** Multiplier on the note's drawn size. */
  scale?: number
}

export interface Rule {
  id: string
  selector: Selector
  style: StyleDecl
  enabled: boolean
}

/** Fully resolved, ready to draw. No optionals. */
export interface ResolvedStyle {
  fill: string
  stroke: string
  strokeWidth: number
  shape: ShapeKind
  labelText: string
  labelColor: string
  opacity: number
  scale: number
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface LayoutConfig {
  mode: LayoutMode
  pitchAxis: PitchAxis
  /** Horizontal pixels per quarter note. */
  beatWidth: number
  /** Vertical pixels per unit of the pitch axis. */
  laneHeight: number
  /** Horizontal gap between consecutive notes so repeats stay separable. */
  noteGap: number
  cornerRadius: number
  systemGap: number
  showKeyboard: boolean
  showGrid: boolean
  showBarlines: boolean
  showMeasureNumbers: boolean
  showStaffLines: boolean
  showLedgerLines: boolean
  /** Draw a faint band behind the black-key rows. Helps orient on a roll. */
  showBlackKeyRows: boolean
}

export interface Encodings {
  palette: string
  shapeSet: string
  label: LabelKind
  labelScale: number
  /** Louder notes render slightly larger. */
  sizeByVelocity: boolean
  /** Ring every non-scale note. A third channel, free of colour. */
  outlineChromatics: boolean
}

export interface Surface {
  background: string
  panel: string
  grid: string
  gridStrong: string
  text: string
  muted: string
  accent: string
  staffLine: string
}

export interface Theme {
  id: string
  name: string
  description: string
  layout: LayoutConfig
  encodings: Encodings
  surface: Surface
  rules: Rule[]
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function labelFor(kind: LabelKind, note: NoteEvent, key: KeyMark): string {
  switch (kind) {
    case 'none':
      return ''
    case 'letter':
      return noteName(note.spelling)
    case 'letterOctave':
      return noteName(note.spelling, true)
    case 'solfege':
      return solfege(note.midi, key)
    case 'degree':
      return degreeLabel(note.midi, key)
    case 'finger':
      return note.finger ? String(note.finger) : ''
  }
}

const DIATONIC_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11])
const DIATONIC_MINOR = new Set([0, 2, 3, 5, 7, 8, 10])

/**
 * Compute the base style from the theme's encodings, then apply every matching
 * rule in ascending specificity order. Ties break on rule order, so a later
 * rule of equal weight wins — the same "last one wins" intuition as CSS.
 */
export function resolveStyle(note: NoteEvent, theme: Theme, key: KeyMark): ResolvedStyle {
  const palette = getPalette(theme.encodings.palette)
  const shapeSet = getShapeSet(theme.encodings.shapeSet)

  const scale = DIATONIC_MINOR.has(0) && key.mode === 'minor' ? DIATONIC_MINOR : DIATONIC_MAJOR
  const chromatic = !scale.has(scaleDegree(note.midi, key))

  const rawFill = colorFor(palette, note, key)
  const fill = rawFill === '@ink' ? theme.surface.text : rawFill

  const base: ResolvedStyle = {
    fill,
    stroke:
      theme.encodings.outlineChromatics && chromatic ? theme.surface.text : 'transparent',
    strokeWidth: theme.encodings.outlineChromatics && chromatic ? 1.5 : 0,
    shape: shapeFor(shapeSet, note, key),
    labelText: labelFor(theme.encodings.label, note, key),
    labelColor: (() => {
      const on = onColorFor(palette, note, key)
      return on === '@paper' ? theme.surface.background : on
    })(),
    opacity: 1,
    scale: theme.encodings.sizeByVelocity ? 0.82 + note.velocity * 0.28 : 1,
  }

  const applicable = theme.rules
    .filter((r) => r.enabled && matches(r.selector, note, key))
    .sort((a, b) => SPECIFICITY[a.selector.kind] - SPECIFICITY[b.selector.kind])

  for (const rule of applicable) {
    const s = rule.style
    if (s.fill !== undefined) {
      base.fill = s.fill
      // A recoloured note needs its label contrast recomputed, unless the rule
      // pins one explicitly below.
      base.labelColor = readableOn(s.fill)
    }
    if (s.stroke !== undefined) base.stroke = s.stroke
    if (s.strokeWidth !== undefined) base.strokeWidth = s.strokeWidth
    if (s.shape !== undefined) base.shape = s.shape
    if (s.label !== undefined) base.labelText = labelFor(s.label, note, key)
    if (s.labelColor !== undefined) base.labelColor = s.labelColor
    if (s.opacity !== undefined) base.opacity = s.opacity
    if (s.scale !== undefined) base.scale = s.scale
  }

  return base
}

/** Pick black or white text for a background, by relative luminance. */
export function readableOn(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#0b0d11'
  const srgb = [rgb.r, rgb.g, rgb.b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const luminance = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
  return luminance > 0.42 ? '#0b0d11' : '#f4f6fb'
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

/** WCAG contrast ratio, used to flag unreadable custom colours in the Studio. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const rgb = hexToRgb(hex)
    if (!rgb) return 0
    const srgb = [rgb.r, rgb.g, rgb.b].map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
  }
  const la = lum(a)
  const lb = lum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

let ruleCounter = 0
export function newRuleId(): string {
  ruleCounter += 1
  return `r${Date.now().toString(36)}${ruleCounter}`
}

export function cloneTheme(theme: Theme, overrides: Partial<Theme> = {}): Theme {
  return {
    ...theme,
    layout: { ...theme.layout },
    encodings: { ...theme.encodings },
    surface: { ...theme.surface },
    rules: theme.rules.map((r) => ({ ...r, style: { ...r.style } })),
    ...overrides,
  }
}
