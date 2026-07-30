/**
 * The theme: a declarative description of how music becomes picture.
 *
 * Themes cascade like CSS. A base encoding covers every note, and rules with
 * selectors layer on top in specificity order. That is what makes "I want G to
 * be a hexagon" a one-line addition rather than a fork of the whole palette —
 * and it keeps a shared theme readable as a diff.
 */

import type { Hand, KeyMark, NoteEvent, NoteType } from './types'
import { degreeLabel, noteName, octaveOf, pitchClass, scaleDegree, solfege } from './pitch'
import { lightnessOf, scaleChroma, shiftLightness, withLightness } from './oklch'
import {
  type ColorConfig,
  type ShapeKind,
  buildPalette,
  chromaScale,
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

/**
 * Where a label sits relative to its note. Inside needs the note tall enough to
 * hold the text, so the Studio measures and says when it is not.
 */
export type LabelPlace = 'inside' | 'above' | 'below'

/**
 * Which notes carry a label.
 *
 * Text is the slowest channel here — a letter has to be looked at directly,
 * where a colour does not — so labelling everything is heavy and mostly wasted
 * at tempo. Choosing a subset is also the path off them: all, then only the
 * accidentals, then none, as the colours take over.
 */
export type LabelOn = 'all' | 'accidentals' | 'outsideKey' | 'longNotes' | 'firstInBar'

export const LABEL_TARGETS: { id: LabelOn; label: string }[] = [
  { id: 'all', label: 'Every note' },
  { id: 'accidentals', label: 'Sharps & flats' },
  { id: 'outsideKey', label: 'Outside the key' },
  { id: 'longNotes', label: 'Long notes' },
  { id: 'firstInBar', label: 'First in bar' },
]

export type LabelFont = 'sans' | 'serif' | 'mono' | 'rounded'

export const LABEL_FONTS: { id: LabelFont; label: string; stack: string }[] = [
  { id: 'sans', label: 'Sans', stack: 'ui-sans-serif, system-ui, sans-serif' },
  { id: 'rounded', label: 'Rounded', stack: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" },
  { id: 'serif', label: 'Serif', stack: "ui-serif, Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'Mono', stack: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
]

export const fontStack = (id: LabelFont): string =>
  LABEL_FONTS.find((f) => f.id === id)?.stack ?? LABEL_FONTS[0].stack

export type LabelCase = 'as-is' | 'upper' | 'lower'

/**
 * What colour a label takes.
 *
 * These are three different jobs, not three tastes. 'contrast' maximises
 * legibility and is what a beginner reading letter-by-letter wants. 'tint'
 * takes the note's own colour and moves it lighter or darker, which keeps the
 * text tied to the pitch it names and — being quieter — lets the colour stay
 * the thing being read while the letter confirms it. That is the wean: the
 * label recedes without disappearing. 'ink' makes every label the same neutral,
 * so the text carries no pitch information at all and reads as annotation.
 */
export type LabelInk = 'contrast' | 'tint' | 'ink'

/**
 * Which way a tinted label moves from its note's colour.
 *
 * 'auto' is the one worth having. A fixed direction only ever suits half a
 * palette — push everything darker and the labels on dark notes disappear,
 * push everything lighter and the ones on pale notes do. Deciding per note
 * from the note's own lightness means one setting reads on every colour, which
 * is what a twelve-hue palette needs to be usable at all.
 */
export type TintDir = 'auto' | 'darker' | 'lighter'

export const TINT_DIRS: { id: TintDir; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'darker', label: 'Darker' },
  { id: 'lighter', label: 'Lighter' },
]

/**
 * Signed shade for this note: away from mid-lightness, so a pale note gets
 * darker text and a deep one gets lighter.
 *
 * The threshold is OKLab 0.5 rather than a luminance midpoint, because the
 * question here is not "which of black or white contrasts" but "which
 * direction has room left" — and in a perceptually uniform space that is
 * simply which side of the middle the note sits on.
 */
export function tintDelta(dir: TintDir, amount: number, noteFill: string): number {
  const magnitude = Math.abs(amount)
  if (dir === 'darker') return -magnitude
  if (dir === 'lighter') return magnitude
  return lightnessOf(noteFill) > 0.5 ? -magnitude : magnitude
}

export const LABEL_INKS: { id: LabelInk; label: string }[] = [
  { id: 'contrast', label: 'Auto' },
  { id: 'tint', label: 'Note shade' },
  { id: 'ink', label: 'Page ink' },
]

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

/**
 * How horizontal space is allotted.
 *
 * The roll's rule is that a column's width is its duration, exactly. Engraved
 * notation's rule is that width grows with duration but far more slowly — a
 * whole note gets more room than a quarter, nowhere near four times as much.
 *
 * Those turn out to be the same rule at two settings of one exponent:
 *
 *     space ∝ gap ^ power
 *
 * `power` 1 is strict proportion, which is the roll. 0 gives every column the
 * same room whatever it holds. Traditional engraving sits near 0.5 — a power of
 * 0.53 reproduces the spacing tables in Gould and Ross to within a few percent
 * across the whole range from a breve to a thirty-second. So this is one
 * continuous control whose ends are both meaningful, rather than two modes.
 *
 * The rest is the springs-and-rods model engravers describe: `spring` is the
 * stretchable duration-derived space, and the rods are the fixed widths that
 * glyphs need whatever the tempo — an accidental before the head, a dot after
 * it, the head itself. Justification stretches the springs and leaves the rods
 * alone, which is why a crowded bar stays legible when a line is stretched.
 */
export interface SpacingConfig {
  /** 1 = width is duration (the roll). ~0.53 = engraved. 0 = every column equal. */
  power: number
  /** Pixels for a one-beat column before justification. A target, not a floor. */
  unit: number
  /** Fixed room before a head that carries an accidental, in head widths. */
  accidental: number
  /** Fixed room after a head that carries augmentation dots, in head widths. */
  dot: number
  /** Room for the clef, key and time signature at the head of a system. */
  prefix: number
  /** 0 leaves systems ragged. 1 stretches each one to the full page width. */
  justify: number
  /** Least gap between adjacent heads, in head widths. The rod that always applies. */
  crowd: number
}

/**
 * Which pieces of traditional notation to draw.
 *
 * Every one is a switch because that is the point of the app: reproducing a
 * printed page is the starting position, not the destination. A reader who has
 * learned to see rhythm in the beams can turn the beams off; one who never wants
 * a stem can drop them and keep the authentic heads; one who wants a printed
 * page with a single purple note changes nothing here at all.
 *
 * They compose with the visual channels rather than replacing them. A stem takes
 * its colour from the note it belongs to, so recolouring by pitch recolours the
 * stems too — which is either exactly right or exactly wrong depending on taste,
 * hence `inkFollowsNote`.
 */
export interface NotationConfig {
  /** Authentic noteheads, in place of whatever the shape channel says. */
  heads: boolean
  stems: boolean
  beams: boolean
  flags: boolean
  dots: boolean
  accidentals: boolean
  rests: boolean
  clef: boolean
  keySignature: boolean
  timeSignature: boolean
  /** Stem and beam thickness, in staff spaces. Engraving uses about 0.12. */
  weight: number
  /** Beam thickness, in staff spaces. Engraving uses half a space. */
  beamWeight: number
  /** Stems and beams in the note's own colour, rather than the page's ink. */
  inkFollowsNote: boolean
  /** Opacity for the furniture, so it can sit behind the colour rather than over it. */
  opacity: number
}

export interface LayoutConfig {
  mode: LayoutMode
  pitchAxis: PitchAxis
  /**
   * Present and engraved-spaced, or absent and proportional. Absent on every
   * roll preset, so the roll's placement code is never even reached.
   */
  spacing?: SpacingConfig
  /** Present and traditional notation is drawn. Absent on every roll preset. */
  notation?: NotationConfig
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
  staff: StaffStyle
}

/**
 * Per-line and per-space styling for the staff.
 *
 * Lines are indexed 0–9 from the bottom of the bass staff up, spaces 0–8
 * between consecutive lines — space 4 being the gap that holds middle C.
 * Overrides are sparse: anything absent falls back to the shared staff line
 * style, so a theme only records what was actually changed.
 */
export interface SpaceStyle {
  fill: string
  opacity: number
  texture: TextureKind
}

export interface StaffStyle {
  lines: Record<number, Partial<LineStyle>>
  spaces: Record<number, SpaceStyle>
}

export const STAFF_LINE_COUNT = 10
export const STAFF_SPACE_COUNT = 9

/** Human names for the staff's lines, bottom to top. */
export const STAFF_LINE_NAMES = [
  'G2', 'B2', 'D3', 'F3', 'A3',
  'E4', 'G4', 'B4', 'D5', 'F5',
]

export const emptyStaffStyle = (): StaffStyle => ({ lines: {}, spaces: {} })

/** Everything on, at engraving's own weights. A printed page, to depart from. */
export const fullNotation = (): NotationConfig => ({
  heads: true,
  stems: true,
  beams: true,
  flags: true,
  dots: true,
  accidentals: true,
  rests: true,
  clef: true,
  keySignature: true,
  timeSignature: true,
  weight: 0.12,
  beamWeight: 0.5,
  inkFollowsNote: true,
  opacity: 1,
})

/** Engraved spacing as published convention has it. The point to depart from. */
export const engravedSpacing = (): SpacingConfig => ({
  power: 0.53,
  unit: 34,
  accidental: 1.05,
  dot: 0.55,
  prefix: 4.2,
  justify: 1,
  crowd: 1.35,
})

/** A line's effective style: the shared one, with any per-line override on top. */
export function staffLineStyle(staff: StaffStyle, index: number, base: LineStyle): LineStyle {
  return { ...base, ...(staff.lines[index] ?? {}) }
}

/**
 * Which notes render hollow instead of solid.
 *
 * Fill is a third channel alongside colour and shape, and like them, what it
 * encodes is a choice rather than a fixed rule. Outlining the accidentals is
 * the obvious use, but the same treatment reads just as well applied to notes
 * outside the key, or to one hand.
 *
 * `writtenLong` is the one target that reproduces a rule from traditional
 * notation rather than inventing one: a half note and a whole note are hollow,
 * everything shorter is solid. That is the whole of the convention that survives
 * here — the rest of it is stems and flags, which say duration a second time and
 * would contradict length.
 */
export type OutlineWhat =
  | 'none'
  | 'accidentals'
  | 'outsideKey'
  | 'leftHand'
  | 'longNotes'
  | 'writtenLong'
export type OutlineStyle = 'hollow' | 'tinted'

export const OUTLINE_TARGETS: { id: OutlineWhat; label: string }[] = [
  { id: 'none', label: 'Nothing' },
  { id: 'accidentals', label: 'Sharps & flats' },
  { id: 'outsideKey', label: 'Outside the key' },
  { id: 'leftHand', label: 'Left hand' },
  { id: 'writtenLong', label: 'Half & whole notes' },
  { id: 'longNotes', label: 'Two beats or more' },
]

/** Note types an engraver draws with a hollow head. */
const HOLLOW_TYPES = new Set<NoteType>(['half', 'whole', 'breve'])

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
  /** Which notes carry a label — the way off them as much as onto them. */
  labelOn: LabelOn
  labelFont: LabelFont
  labelWeight: number
  labelOpacity: number
  labelCase: LabelCase
  labelPlace: LabelPlace
  labelTracking: number
  labelInk: LabelInk
  /**
   * How far a 'tint' label moves from the note's colour, in OKLab lightness.
   * A magnitude — the direction comes from labelTintDir. Zero would make the
   * text the same colour as the note it sits on, which is why the Studio
   * measures the result rather than trusting the number.
   */
  labelTint: number
  labelTintDir: TintDir
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
/**
 * '@note' is a rule, not a colour: the line wears the colour of the pitch it
 * sits on, and keeps wearing it when the palette changes. Only staff lines have
 * a pitch, so anything else asking for it falls back to the derived default.
 */
export function lineColor(
  line: LineStyle,
  role: LineRole,
  surface: Surface,
  noteColor?: string,
): string {
  if (line.color === '@note') return noteColor ?? surface.staffLine
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
    case 'writtenLong':
      return isWrittenLong(note)
  }
}

/**
 * Was this note engraved with a hollow head?
 *
 * The first segment decides it, because that is the head the note begins on: a
 * half tied to a quarter is drawn hollow-then-solid, and since we merge the tie
 * into one shape, the shape takes the head it starts with.
 *
 * Duration is the fallback for MIDI and the built-in pieces, which carry no
 * written types at all. It is a proxy and it is wrong in the places a proxy is
 * wrong — two tied quarters sound two beats and are engraved solid — but silently
 * filling every note of a MIDI import would be worse.
 */
function isWrittenLong(note: NoteEvent): boolean {
  const first = note.notated?.segments[0]
  return first ? HOLLOW_TYPES.has(first.type) : note.duration >= 2
}

/** Does this note carry a label under the current target? */
function shouldLabel(note: NoteEvent, theme: Theme, key: KeyMark): boolean {
  const scale = key.mode === 'minor' ? DIATONIC_MINOR : DIATONIC_MAJOR
  switch (theme.encodings.labelOn) {
    case 'all':
      return true
    case 'accidentals':
      return note.spelling.alter !== 0 || !isNatural(pitchClass(note.midi))
    case 'outsideKey':
      return !scale.has(scaleDegree(note.midi, key))
    case 'longNotes':
      return note.duration >= 2
    case 'firstInBar':
      return note.firstInBar === true
  }
}

const applyCase = (text: string, kind: LabelCase): string =>
  kind === 'upper' ? text.toUpperCase() : kind === 'lower' ? text.toLowerCase() : text

/**
 * What is actually behind a label.
 *
 * Only a label sitting inside a filled note has the note behind it. Above or
 * below, and inside a hollow note — whose middle is empty — the page shows
 * through. Deciding this here rather than in the renderer means every ink mode
 * is measured against what the reader will really see.
 */
export function labelBackdrop(fill: string, filled: boolean, theme: Theme): string {
  return theme.encodings.labelPlace === 'inside' && filled ? fill : theme.surface.background
}

/**
 * A label's colour, given the note it names and what sits behind the text.
 *
 * 'tint' moves the note's own colour in OKLab, so the hue survives the move and
 * the text still reads as belonging to that pitch. Whether the result is
 * legible is a separate question, which contrastRatio answers and the Studio
 * reports — the control stays free, the consequence is shown.
 */
function inkFor(
  ink: LabelInk,
  tint: number,
  dir: TintDir,
  noteFill: string,
  backdrop: string,
  surface: Surface,
  onColor?: string,
): string {
  switch (ink) {
    case 'ink':
      return surface.text
    case 'tint':
      return shiftLightness(noteFill, tintDelta(dir, tint, noteFill))
    case 'contrast':
      // A palette may name its own on-colour, which is a considered choice and
      // beats a computed black or white. Off the note there is no such choice.
      if (backdrop !== noteFill) return readableOn(backdrop)
      if (onColor === undefined) return readableOn(noteFill)
      return onColor === '@paper' ? surface.background : onColor
  }
}

export function resolveStyle(note: NoteEvent, theme: Theme, key: KeyMark): ResolvedStyle {
  const palette = buildPalette(theme.encodings.color)
  const shapeSet = getShapeSet(theme.encodings.shapeSet)

  const rawFill = colorFor(palette, note, key)
  const baseFill = rawFill === '@ink' ? theme.surface.text : rawFill
  // Brightness and saturation are applied after the hue is chosen, so they
  // compose with any colour source rather than being baked into each palette.
  // Chroma second: scaling it holds lightness, so the order does not matter to
  // the result, but doing brightness first keeps a greyed note at the lightness
  // the brightness channel asked for.
  const fill = scaleChroma(
    shiftLightness(baseFill, lightnessDelta(theme.encodings.color, note)),
    chromaScale(theme.encodings.color, note, key),
  )
  const outlined = shouldOutline(note, theme, key)

  const base: ResolvedStyle = {
    fill,
    // A hollow note carries its colour in the outline instead, so the pitch
    // encoding survives the treatment rather than being spent on it.
    stroke: outlined ? fill : 'transparent',
    strokeWidth: outlined ? 2 : 0,
    shape: shapeFor(shapeSet, note, key),
    labelText: shouldLabel(note, theme, key)
      ? applyCase(labelFor(theme.encodings.label, note, key), theme.encodings.labelCase)
      : '',
    labelColor: inkFor(
      theme.encodings.labelInk,
      theme.encodings.labelTint,
      theme.encodings.labelTintDir,
      fill,
      labelBackdrop(fill, !outlined, theme),
      theme.surface,
      onColorFor(palette, note, key),
    ),
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
      // A recoloured note needs its label recomputed under the same ink mode,
      // unless the rule pins a colour explicitly below. Recomputing rather than
      // always reaching for readableOn is what keeps a tinted label tied to the
      // note after a per-note override changes it.
      base.labelColor = inkFor(
        theme.encodings.labelInk,
        theme.encodings.labelTint,
        theme.encodings.labelTintDir,
        s.fill,
        labelBackdrop(s.fill, base.filled, theme),
        theme.surface,
      )
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

/**
 * Pick black or white text for a background, by relative luminance.
 *
 * The crossover is where the two choices contrast equally, which WCAG's formula
 * puts at luminance 0.179, not at the midpoint. Judging by eye and using 0.42
 * looked reasonable and was not: it handed white text to every colour between
 * 0.179 and 0.42, bottoming out near 2.2:1 — worse than the 4.5:1 that black
 * would have given the same colour. This is exactly what the Studio's contrast
 * readout surfaced, on the palette's own mid-bright greens.
 */
const READABLE_CROSSOVER = 0.179

export function readableOn(hex: string): string {
  return luminanceOf(hex) > READABLE_CROSSOVER ? '#0b0d11' : '#f4f6fb'
}

/** WCAG relative luminance. */
function luminanceOf(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const srgb = [rgb.r, rgb.g, rgb.b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

/** WCAG contrast ratio, used to flag unreadable custom colours in the Studio. */
export function contrastRatio(a: string, b: string): number {
  const la = luminanceOf(a)
  const lb = luminanceOf(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The worst contrast any label on this page actually has, and the note causing it.
 *
 * Measured over the score's own notes rather than the palette. Sweeping the
 * palette was the first attempt and it lied in both directions: it warned about
 * hollow accidentals in a piece with no accidentals in it, and it could not see
 * a per-note override that recolours one note into invisibility. Resolving the
 * real notes costs a pass over the score and answers the question the reader is
 * actually asking, which is whether *this* is legible.
 */
export function worstLabelContrast(
  notes: NoteEvent[],
  theme: Theme,
  keyOf: (note: NoteEvent) => KeyMark,
): { ratio: number; fill: string } | null {
  let worst: { ratio: number; fill: string } | null = null

  for (const note of notes) {
    const style = resolveStyle(note, theme, keyOf(note))
    if (!style.labelText) continue
    const backdrop = labelBackdrop(style.fill, style.filled, theme)
    // Fading a label composites it toward its backdrop, so the contrast the
    // reader gets is the blended colour's, not the ink's.
    const ink = blend(style.labelColor, backdrop, theme.encodings.labelOpacity * style.opacity)
    const ratio = contrastRatio(ink, backdrop)
    if (!worst || ratio < worst.ratio) worst = { ratio, fill: style.fill }
  }
  return worst
}

/** Composite a colour over another at a given alpha. */
export function blend(fg: string, bg: string, alpha: number): string {
  const a = hexToRgb(fg)
  const b = hexToRgb(bg)
  if (!a || !b) return fg
  const mix = (x: number, y: number) => Math.round(x * alpha + y * (1 - alpha))
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(mix(a.r, b.r))}${hex(mix(a.g, b.g))}${hex(mix(a.b, b.b))}`
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
