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
import { lightnessOf, shiftLightness, withLightness } from './oklch'
import {
  type ColorConfig,
  type ShapeKind,
  buildPalette,
  colorFor,
  getShapeSet,
  isNatural,
  lightnessDelta,
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
  filled?: boolean
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
  /** False draws the note hollow, with its colour moved to the outline. */
  filled: boolean
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export type DashKind = 'solid' | 'dotted' | 'dashed' | 'long'

export const DASH_KINDS: { id: DashKind; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'long', label: 'Long' },
]

/** SVG dash pattern, scaled by the line's own width so it stays proportionate. */
export function dashArray(kind: DashKind, width: number): string | undefined {
  const w = Math.max(0.5, width)
  switch (kind) {
    case 'solid':
      return undefined
    case 'dotted':
      return `${w} ${w * 2.5}`
    case 'dashed':
      return `${w * 4} ${w * 3}`
    case 'long':
      return `${w * 10} ${w * 4}`
  }
}

export interface LineStyle {
  show: boolean
  width: number
  dash: DashKind
  opacity: number
  /** '@auto' derives from the page, so a line follows a page colour change. */
  color: string
}

export type LineRole = 'beat' | 'bar' | 'staff' | 'ledger' | 'anchor'

export type LineSet = Record<LineRole, LineStyle>

/**
 * Which pitches get a heavier reference line across the page.
 *
 * Aligning a mark to a line is far more precise than judging its height in
 * empty space, so a roll without any horizontal reference makes pitch hard to
 * read. One strong line per octave gives the eye somewhere to measure from,
 * and the rest of the grid can stay faint because that precision survives very
 * low contrast.
 */
export type AnchorOn = 'none' | 'octave' | 'tonic'

export const ANCHOR_OPTIONS: { id: AnchorOn; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'octave', label: 'Every C' },
  { id: 'tonic', label: 'Key note' },
]

export interface LayoutConfig {
  mode: LayoutMode
  pitchAxis: PitchAxis
  /**
   * How many bars fill one line. Zero means auto, which picks whichever count
   * lands nearest {@link beatWidth}. Pixels-per-beat is always derived from
   * this and the width available, never set directly — that is what keeps a
   * line spanning the full page.
   */
  barsPerSystem: number
  /** Preferred horizontal pixels per quarter note. Only a target, used by auto. */
  beatWidth: number
  /** Vertical pixels per unit of the pitch axis. */
  laneHeight: number
  /** Horizontal gap between consecutive notes so repeats stay separable. */
  noteGap: number
  cornerRadius: number
  systemGap: number
  showKeyboard: boolean
  showMeasureNumbers: boolean
  /** Draw a faint band behind the black-key rows. Helps orient on a roll. */
  showBlackKeyRows: boolean
  lines: LineSet
  anchorOn: AnchorOn
  /** Texture on the page itself, well below the notes' own scale. */
  pageTexture: TextureConfig
}

/**
 * Which notes render hollow instead of solid.
 *
 * Fill is a third channel alongside colour and shape, and like them, what it
 * encodes is a choice rather than a fixed rule. Outlining the accidentals is
 * the obvious use, but the same treatment reads just as well applied to notes
 * outside the key, or to one hand.
 */
export type OutlineWhat = 'none' | 'accidentals' | 'outsideKey' | 'leftHand' | 'longNotes'
export type OutlineStyle = 'hollow' | 'tinted'

export const OUTLINE_TARGETS: { id: OutlineWhat; label: string }[] = [
  { id: 'none', label: 'Nothing' },
  { id: 'accidentals', label: 'Sharps & flats' },
  { id: 'outsideKey', label: 'Outside the key' },
  { id: 'leftHand', label: 'Left hand' },
  { id: 'longNotes', label: 'Long notes' },
]

// ---------------------------------------------------------------------------
// Trails
// ---------------------------------------------------------------------------

export type TrailCap = 'round' | 'flat'

/**
 * The stroke a note leaves for its duration.
 *
 * Head and trail are drawn as two overlapping shapes in the same colour, so
 * what you see is their union. That is what makes the melt work for any head:
 * there is no joint to compute between a triangle and a bar, only a silhouette
 * where the trail emerges from inside the head.
 *
 * It also collapses a fork — a capsule that filled its whole duration and a
 * notehead with a separate tail were two renderers. Now a capsule is just a
 * trail at full thickness with no taper.
 */
export interface TrailConfig {
  /** Fraction of the note's height at its thickest. */
  thickness: number
  /** 0 keeps an even weight, 1 narrows to nothing by the end. */
  taper: number
  /** How far the trail swells to meet the head. 1 is a full fillet. */
  melt: number
  cap: TrailCap
  opacity: number
}

// ---------------------------------------------------------------------------
// Texture
// ---------------------------------------------------------------------------

export type TextureKind = 'none' | 'grain' | 'dots' | 'lines' | 'cross' | 'weave'

export const TEXTURE_KINDS: { id: TextureKind; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'grain', label: 'Grain' },
  { id: 'dots', label: 'Dots' },
  { id: 'lines', label: 'Hatch' },
  { id: 'cross', label: 'Cross' },
  { id: 'weave', label: 'Weave' },
]

export interface TextureConfig {
  kind: TextureKind
  /** Tile scale. Below roughly three cycles inside a mark it reads as noise. */
  scale: number
  strength: number
  /** Whether the texture lightens or darkens what it sits on. */
  ink: 'light' | 'dark'
}

export const NO_TEXTURE: TextureConfig = { kind: 'none', scale: 1, strength: 0.3, ink: 'dark' }

export interface Encodings {
  color: ColorConfig
  shapeSet: string
  label: LabelKind
  labelScale: number
  /** Louder notes render slightly larger. */
  sizeByVelocity: boolean
  outlineWhat: OutlineWhat
  outlineStyle: OutlineStyle
  trail: TrailConfig
  texture: TextureConfig
  /**
   * Ramp the note's texture along its trail, so a held note visibly breaks up
   * as it rings. A real note decays, so the grain is describing something true
   * rather than decorating.
   */
  trailGrain: boolean
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

/**
 * Derive a whole surface from one page colour.
 *
 * Everything is a lightness move away from the page in OKLab, so the page's own
 * hue carries through — a sepia page gets warm greys, a slate page cool ones —
 * and any colour can be a page rather than only the two that were hand-picked.
 */
export function makeSurface(background: string): Surface {
  const L = lightnessOf(background)
  const dark = L < 0.5
  // Absolute targets with a capped chroma, not relative shifts: the further a
  // derived colour travels from the page, the less of the page's saturation it
  // should bring, or a warm cream yields pink gridlines.
  const away = (amount: number, cap = 0.022) =>
    withLightness(background, dark ? L + amount : L - amount, cap)

  return {
    background,
    panel: away(0.04),
    grid: away(0.035),
    gridStrong: away(0.11),
    staffLine: away(dark ? 0.17 : 0.3, 0.018),
    muted: away(dark ? 0.36 : 0.42, 0.014),
    text: away(dark ? 0.66 : 0.72, 0.012),
    accent: away(dark ? 0.72 : 0.78, 0.012),
  }
}

/** Resolve a line's colour, honouring the '@auto' sentinel. */
export function lineColor(line: LineStyle, role: LineRole, surface: Surface): string {
  if (line.color !== '@auto') return line.color
  switch (role) {
    case 'beat':
      return surface.grid
    case 'bar':
      return surface.gridStrong
    case 'anchor':
      return surface.gridStrong
    case 'staff':
    case 'ledger':
      return surface.staffLine
  }
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
/** Does this note match the current outline target? */
function shouldOutline(note: NoteEvent, theme: Theme, key: KeyMark): boolean {
  const scale = key.mode === 'minor' ? DIATONIC_MINOR : DIATONIC_MAJOR

  switch (theme.encodings.outlineWhat) {
    case 'none':
      return false
    case 'accidentals':
      // Written spelling wins, but a black key from a MIDI import has none.
      return note.spelling.alter !== 0 || !isNatural(((note.midi % 12) + 12) % 12)
    case 'outsideKey':
      return !scale.has(scaleDegree(note.midi, key))
    case 'leftHand':
      return note.hand === 'left'
    case 'longNotes':
      return note.duration >= 2
  }
}

export function resolveStyle(note: NoteEvent, theme: Theme, key: KeyMark): ResolvedStyle {
  const palette = buildPalette(theme.encodings.color)
  const shapeSet = getShapeSet(theme.encodings.shapeSet)

  const rawFill = colorFor(palette, note, key)
  const baseFill = rawFill === '@ink' ? theme.surface.text : rawFill
  // Brightness is applied after the hue is chosen, so it composes with any
  // colour source rather than needing to be baked into each palette.
  const fill = shiftLightness(baseFill, lightnessDelta(theme.encodings.color, note))
  const outlined = shouldOutline(note, theme, key)

  const base: ResolvedStyle = {
    fill,
    // A hollow note carries its colour in the outline instead, so the pitch
    // encoding survives the treatment rather than being spent on it.
    stroke: outlined ? fill : 'transparent',
    strokeWidth: outlined ? 2 : 0,
    shape: shapeFor(shapeSet, note, key),
    labelText: labelFor(theme.encodings.label, note, key),
    labelColor: (() => {
      // A hollow note has the page behind it, so a label sitting inside needs
      // the page's text colour rather than one chosen to contrast with the fill.
      if (outlined) return theme.surface.text
      const on = onColorFor(palette, note, key)
      return on === '@paper' ? theme.surface.background : on
    })(),
    opacity: 1,
    scale: theme.encodings.sizeByVelocity ? 0.82 + note.velocity * 0.28 : 1,
    filled: !outlined,
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
    if (s.filled !== undefined) {
      base.filled = s.filled
      base.stroke = s.filled ? 'transparent' : base.fill
      base.strokeWidth = s.filled ? 0 : 2
    }
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
