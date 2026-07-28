/**
 * Colour and shape vocabularies.
 *
 * Colour is parametric rather than a fixed list. A palette is really two
 * independent choices — how hue maps onto pitch (the *order*) and how bright
 * and saturated it is (the *tone*) — so enumerating every combination would
 * mean a wall of near-identical swatches. Exposing the two axes separately
 * gives the same range from a handful of controls, and makes a new palette idea
 * nearly free.
 *
 * Every option declares `cvdSafe` honestly. Twelve distinguishable hues do not
 * exist for someone with colour vision deficiency, so anything needing twelve
 * is marked unsafe and paired with a redundant channel rather than pretending.
 */

import type { KeyMark, NoteEvent } from './types'
import { isBlackKey, letterIndex, octaveOf, pitchClass, scaleDegree } from './pitch'
import { inkOn, oklch, shiftLightness } from './oklch'

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
  note: string
  cvdSafe: boolean
  /** Which musical dimension this palette reads. */
  domain: 'pitchClass' | 'letter' | 'scaleDegree' | 'hand' | 'octave' | 'fixed'
  colors: string[]
  /** Text colour for a label sitting inside the note. */
  onColor?: string[]
  /**
   * Used by the 'letter' domain for notes carrying an accidental, so a sharp
   * can sit a shade off its natural while keeping the same hue.
   */
  altColors?: string[]
  altOnColor?: string[]
}

const INK = '#0b0d11'
const PAPER = '#f4f6fb'

// ---------------------------------------------------------------------------
// Hue ordering
// ---------------------------------------------------------------------------

/**
 * How a pitch class maps onto the colour wheel.
 *
 * The obvious answer is the wrong one. Ordering hues chromatically puts
 * semitone neighbours next to each other on the wheel — and semitone
 * neighbours are also adjacent rows on a roll, and the pairs music asks you to
 * distinguish most often. The encoding ends up weakest exactly where it is
 * needed most.
 */
export type HueOrder = 'chromatic' | 'fifths' | 'keys'

export const HUE_ORDERS: { id: HueOrder; name: string; note: string }[] = [
  {
    id: 'fifths',
    name: 'Fifths',
    note: 'Hue follows the circle of fifths, so neighbouring notes land opposite each other and notes a fifth apart look related. Easiest to read.',
  },
  {
    id: 'chromatic',
    name: 'Rainbow',
    note: 'Hue follows pitch straight up. The page reads as a rainbow, at the cost of semitone neighbours looking alike.',
  },
  {
    id: 'keys',
    name: 'Keys',
    note: 'White keys warm and light, black keys cool and dark — the way the instrument looks.',
  },
]

/**
 * Position of a pitch class on the circle of fifths.
 *
 * Multiplying by seven walks the circle, because a fifth is seven semitones and
 * seven is its own inverse modulo twelve. As a hue index this puts every
 * semitone pair about 210° apart while a fifth lands adjacent, so colour
 * distance tracks harmonic distance instead of fighting it.
 */
const fifthsIndex = (pc: number): number => (pc * 7) % 12

const NATURALS = [0, 2, 4, 5, 7, 9, 11]
const LETTER_OF = new Map(NATURALS.map((pc, i) => [pc, i]))
const ACCIDENTAL_OF = new Map([1, 3, 6, 8, 10].map((pc, i) => [pc, i]))

export const isNatural = (pc: number): boolean => LETTER_OF.has(pc)

/**
 * Warm hue for a white key, cool for a black one. Every semitone step crosses
 * between the bands, and within each band the order is shuffled (×4 mod 7,
 * ×2 mod 5) so consecutive letters do not land side by side either — E–F and
 * B–C matter most, being the only semitone steps between two white keys.
 */
function keysHue(pc: number): number {
  const letter = LETTER_OF.get(pc)
  if (letter !== undefined) return 20 + ((letter * 4) % 7) * 25
  return 195 + ((ACCIDENTAL_OF.get(pc) ?? 0) * 2 % 5) * 32
}

function hueFor(order: HueOrder, pc: number, offset: number): number {
  if (order === 'keys') return (keysHue(pc) + offset) % 360
  const index = order === 'fifths' ? fifthsIndex(pc) : pc
  return (index * 30 + 25 + offset) % 360
}

// ---------------------------------------------------------------------------
// Basis: what gets a colour of its own
// ---------------------------------------------------------------------------

/**
 * Whether a colour belongs to a semitone or to a letter name.
 *
 * 'letter' gives C and C♯ the same hue and leaves the accidental to shape or
 * fill. That is closer to how the note is actually thought about — a sharp is
 * a kind of its natural — and it drops the palette from twelve hues to seven,
 * which are far easier to tell apart. Written spelling decides the letter, so
 * C♯ takes C's hue while D♭ takes D's.
 */
export type ColorBasis = 'pitchClass' | 'letter'

export const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** Position of each letter on the circle of fifths: F C G D A E B. */
const LETTER_FIFTHS = [0, 2, 4, 6, 1, 3, 5]

function letterHue(order: HueOrder, letter: number, offset: number): number {
  const index = order === 'fifths' ? LETTER_FIFTHS[letter] : letter
  return ((index * 360) / 7 + 25 + offset) % 360
}

/** How many independent colours a basis has. */
export const slotCount = (basis: ColorBasis): number => (basis === 'letter' ? 7 : 12)

export const slotNames = (basis: ColorBasis): string[] =>
  basis === 'letter' ? LETTER_NAMES : NAMES_12

const NAMES_12 = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export type AccidentalShade = 'same' | 'lighter' | 'darker'

export const ACCIDENTAL_SHADES: { id: AccidentalShade; label: string }[] = [
  { id: 'same', label: 'Same' },
  { id: 'lighter', label: 'Lighter' },
  { id: 'darker', label: 'Darker' },
]

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

export type ToneId = 'bright' | 'neon' | 'pastel' | 'earth' | 'contrast' | 'deep'

interface Tone {
  id: ToneId
  name: string
  note: string
  /** A pair alternates note by note, adding a brightness channel. */
  lightness: number | [number, number]
  chroma: number
}

export const TONES: Tone[] = [
  { id: 'bright', name: 'Bright', note: 'Even and clear. The default.', lightness: 0.76, chroma: 0.15 },
  { id: 'neon', name: 'Neon', note: 'Full chroma. Loudest on a dark page.', lightness: 0.78, chroma: 0.21 },
  { id: 'pastel', name: 'Pastel', note: 'Soft and light. Quiet to read for a long stretch.', lightness: 0.87, chroma: 0.075 },
  { id: 'earth', name: 'Earth', note: 'Muted and low-chroma, for anyone who finds a rainbow tiring.', lightness: 0.66, chroma: 0.07 },
  {
    id: 'contrast',
    name: 'Contrast',
    note: 'Lightness alternates note by note, so neighbours differ in brightness as well as hue.',
    lightness: [0.89, 0.53],
    chroma: 0.12,
  },
  { id: 'deep', name: 'Deep', note: 'Darkened for a paper page, where bright colours wash out.', lightness: 0.56, chroma: 0.14 },
]

const toneById = (id: ToneId): Tone => TONES.find((t) => t.id === id) ?? TONES[0]

// ---------------------------------------------------------------------------
// Colour source
// ---------------------------------------------------------------------------

export type ColorSource = 'pitch' | 'classroom' | 'harmony' | 'hands' | 'register' | 'ink'

export const COLOR_SOURCES: {
  id: ColorSource
  name: string
  note: string
  cvdSafe: boolean
  /** Whether order/tone/rotation apply. */
  tunable: boolean
}[] = [
  { id: 'pitch', name: 'Pitch', note: 'A colour per note name.', cvdSafe: false, tunable: true },
  {
    id: 'harmony',
    name: 'Harmony',
    note: 'Colour follows scale degree — tonic blue, dominant orange, in every key. Non-scale notes stay grey.',
    cvdSafe: true,
    tunable: false,
  },
  {
    id: 'hands',
    name: 'Hands',
    note: 'Two colours, one per hand. The calmest option, and safe for every kind of colour vision.',
    cvdSafe: true,
    tunable: false,
  },
  {
    id: 'register',
    name: 'Register',
    note: 'One hue that lightens as pitch rises. Reads as height, not category.',
    cvdSafe: true,
    tunable: false,
  },
  {
    id: 'classroom',
    name: 'Classroom',
    note: 'The education colour set, familiar from coloured chime bars.',
    cvdSafe: false,
    tunable: false,
  },
  {
    id: 'ink',
    name: 'None',
    note: 'No colour at all — shape, length and label carry everything.',
    cvdSafe: true,
    tunable: false,
  },
]

export interface ColorConfig {
  source: ColorSource
  order: HueOrder
  tone: ToneId
  /** Degrees to rotate the whole wheel. Same structure, different mood. */
  rotate: number
  /**
   * Per-pitch-class nudges, in degrees, on top of the order and rotation.
   *
   * Offsets rather than absolute hues, so `order` stays meaningful: it is the
   * underlying arrangement and these are adjustments to it. Storing absolute
   * positions would quietly kill the order control the moment anything was
   * dragged.
   */
  hueShift?: number[]
  /** Whether a colour belongs to a semitone or to a letter name. */
  basis: ColorBasis
  /** Only meaningful on the letter basis, where a sharp shares its hue. */
  accidentalShade: AccidentalShade
  /**
   * What varies the brightness of a note, on top of its hue.
   *
   * Worth having as its own channel because hue and lightness are not read the
   * same way. Colours that differ in hue but not brightness are resolved slowly
   * — they are close to invisible to the fast, achromatic part of vision that
   * handles rapid glances, which is most of what sight-reading is. A palette
   * with even lightness across every hue looks immaculate and gives that fast
   * channel nothing to work with.
   */
  lightnessBy: LightnessBy
  /** How far the brightness spreads, in OKLab lightness. */
  lightnessSpread: number
  /**
   * A multiplier on the tone's chroma, for the whole palette. 1 is the tone as
   * designed, 0 is a set of greys separated only by brightness.
   *
   * Kept separate from `tone` because tone bundles lightness and chroma into
   * six named points, and wanting Bright-but-calmer should not mean hunting for
   * whichever preset happens to be near it.
   */
  saturation: number
  /**
   * What varies saturation from note to note.
   *
   * Weaker than brightness and much weaker than hue — chroma differences are
   * resolved slowly and vanish entirely under colour vision deficiency — so
   * this is a figure-and-ground control rather than a way to encode identity.
   * Greying the notes outside the key pushes them behind the ones that carry
   * the harmony without changing any note's colour identity.
   */
  chromaBy: ChromaBy
  /** How far saturation drops for the notes this pushes back, 0 to 1. */
  chromaSpread: number
  /**
   * Slots rendered without hue at all.
   *
   * Twelve hues is more than anyone reliably tells apart at a glance, and an
   * achromatic note is the one mark that survives every kind of colour vision
   * deficiency intact. Making one or two pitch classes black or white removes
   * them from the hue problem entirely and leaves unmistakable landmarks in the
   * middle of the colour.
   *
   * Which of black or white works depends on the page, so it is chosen rather
   * than derived: on a dark page white anchors read and black ones disappear.
   */
  achromatic?: Achromatic[]
}

export type Achromatic = 'none' | 'light' | 'dark'

/** The two achromatic anchors. Fixed, so they never drift toward a hue. */
export const ANCHOR_LIGHT = '#f2f4f8'
export const ANCHOR_DARK = '#15181f'

export type ChromaBy = 'none' | 'outsideKey' | 'accidentals' | 'hand' | 'register'

export const CHROMA_SOURCES: { id: ChromaBy; label: string; note: string }[] = [
  { id: 'none', label: 'Nothing', note: 'Every note equally saturated.' },
  {
    id: 'outsideKey',
    label: 'Outside the key',
    note: 'Notes outside the key go grey, so the ones carrying the harmony sit in front of them.',
  },
  { id: 'accidentals', label: 'Sharps & flats', note: 'Accidentals greyed, naturals full.' },
  { id: 'hand', label: 'Hands', note: 'One hand vivid, the other muted — useful when practising one at a time.' },
  { id: 'register', label: 'Register', note: 'Saturation falls away from middle C, so the extremes recede.' },
]

export type LightnessBy = 'none' | 'register' | 'hand' | 'alternate' | 'accidentals'

export const LIGHTNESS_SOURCES: { id: LightnessBy; label: string; note: string }[] = [
  { id: 'none', label: 'Nothing', note: 'Every note the same brightness — even, and slower to read at a glance.' },
  { id: 'register', label: 'Register', note: 'Brighter as pitch rises. Height becomes readable without reading position.' },
  { id: 'hand', label: 'Hands', note: 'One hand brighter than the other.' },
  { id: 'alternate', label: 'Neighbours', note: 'Alternates note to note, so adjacent pitches differ in brightness as well as hue.' },
  { id: 'accidentals', label: 'Sharps & flats', note: 'Accidentals darker than naturals.' },
]

export const DEFAULT_COLOR: ColorConfig = {
  source: 'pitch',
  order: 'fifths',
  tone: 'bright',
  rotate: 0,
  basis: 'pitchClass',
  accidentalShade: 'same',
  lightnessBy: 'none',
  lightnessSpread: 0.14,
  saturation: 1,
  chromaBy: 'none',
  chromaSpread: 0.7,
}

/**
 * How much of its saturation this note keeps, as a multiplier.
 *
 * Needs the key, unlike its brightness counterpart, because the one genuinely
 * useful saturation source is whether a note belongs to the key being played.
 */
export function chromaScale(config: ColorConfig, note: NoteEvent, key: KeyMark): number {
  if (config.chromaBy === 'none' || config.chromaSpread === 0) return 1
  const muted = 1 - Math.min(1, Math.max(0, config.chromaSpread))

  switch (config.chromaBy) {
    case 'outsideKey': {
      const scale = key.mode === 'minor' ? MINOR_DEGREES : MAJOR_DEGREES
      return scale.has(scaleDegree(note.midi, key)) ? 1 : muted
    }
    case 'accidentals':
      return isNatural(pitchClass(note.midi)) ? 1 : muted
    case 'hand':
      return note.hand === 'right' ? 1 : muted
    case 'register': {
      // Full at middle C, falling to `muted` two octaves out either way.
      const t = Math.min(1, Math.abs(note.midi - 60) / 24)
      return 1 - t * (1 - muted)
    }
    default:
      return 1
  }
}

const MAJOR_DEGREES = new Set([0, 2, 4, 5, 7, 9, 11])
const MINOR_DEGREES = new Set([0, 2, 3, 5, 7, 8, 10])

/**
 * How far this note's brightness moves from the palette's own lightness.
 * Returned in OKLab lightness, so it can be applied to any resolved colour.
 */
export function lightnessDelta(config: ColorConfig, note: NoteEvent): number {
  const spread = config.lightnessSpread
  if (config.lightnessBy === 'none' || spread === 0) return 0

  switch (config.lightnessBy) {
    case 'register': {
      // Two octaves either side of middle C covers most piano writing.
      const t = Math.max(-1, Math.min(1, (note.midi - 60) / 24))
      return t * spread
    }
    case 'hand':
      return note.hand === 'right' ? spread / 2 : -spread / 2
    case 'alternate':
      return pitchClass(note.midi) % 2 === 0 ? spread / 2 : -spread / 2
    case 'accidentals':
      return isNatural(pitchClass(note.midi)) ? spread / 2 : -spread / 2
    default:
      return 0
  }
}

export const normalizeHue = (deg: number): number => ((deg % 360) + 360) % 360

/** Where the scheme alone puts a slot, before any manual nudge. */
export function baseHue(config: ColorConfig, slot: number): number {
  return normalizeHue(
    config.basis === 'letter'
      ? letterHue(config.order, slot, config.rotate)
      : hueFor(config.order, slot, config.rotate),
  )
}

/** Where a slot actually sits, nudges included. */
export function noteHue(config: ColorConfig, slot: number): number {
  return normalizeHue(baseHue(config, slot) + (config.hueShift?.[slot] ?? 0))
}

/**
 * A slot's angle from the scheme and its nudge alone, with rotation left out.
 *
 * This is the note's *position on the wheel*, as distinct from its hue. The two
 * differ once the wheel is rotated: the notes hold still and the spectrum turns
 * beneath them, so a note keeps its place while its colour changes.
 */
export function schemeAngle(config: ColorConfig, slot: number): number {
  return normalizeHue(
    baseHue({ ...config, rotate: 0 }, slot) + (config.hueShift?.[slot] ?? 0),
  )
}

export function hasHueShift(config: ColorConfig): boolean {
  return (config.hueShift ?? []).some((d) => Math.round(d) !== 0)
}

/** Representative lightness and chroma, for drawing the wheel in this tone. */
export function toneSample(id: ToneId): { lightness: number; chroma: number } {
  const tone = toneById(id)
  const lightness = Array.isArray(tone.lightness)
    ? (tone.lightness[0] + tone.lightness[1]) / 2
    : tone.lightness
  return { lightness, chroma: tone.chroma }
}

// ---------------------------------------------------------------------------
// Fixed palettes
// ---------------------------------------------------------------------------

const FIXED: Record<Exclude<ColorSource, 'pitch'>, Palette> = {
  classroom: {
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
  harmony: {
    id: 'harmony',
    name: 'Harmony',
    note: 'Colour follows scale degree — tonic blue, dominant orange, in every key.',
    cvdSafe: true,
    domain: 'scaleDegree',
    // Okabe–Ito on the seven diatonic degrees; chromatic degrees deliberately grey.
    colors: [
      '#0072B2', '#7A8698', '#56B4E9', '#7A8698', '#009E73', '#F0E442',
      '#7A8698', '#E69F00', '#7A8698', '#CC79A7', '#7A8698', '#D55E00',
    ],
    onColor: [PAPER, PAPER, INK, PAPER, PAPER, INK, PAPER, INK, PAPER, INK, PAPER, PAPER],
  },
  hands: {
    id: 'hands',
    name: 'Hands',
    note: 'Two colours, one per hand.',
    cvdSafe: true,
    domain: 'hand',
    colors: ['#E69F00', '#0072B2'],
    onColor: [INK, PAPER],
  },
  register: {
    id: 'register',
    name: 'Register',
    note: 'One hue that lightens as pitch rises.',
    cvdSafe: true,
    domain: 'octave',
    colors: [
      '#1F3A6E', '#25508F', '#2C68AE', '#3E85C9', '#5EA0DC', '#86BCE9',
      '#AED4F2', '#CFE6F8', '#E6F2FC',
    ],
    onColor: [PAPER, PAPER, PAPER, PAPER, INK, INK, INK, INK, INK],
  },
  ink: {
    id: 'ink',
    name: 'None',
    note: 'No colour at all.',
    cvdSafe: true,
    domain: 'fixed',
    // Sentinel: resolved against the current surface so this works on paper and
    // on a dark stage without needing two copies.
    colors: ['@ink'],
    onColor: ['@paper'],
  },
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => Math.min(0.98, Math.max(0.08, n))

// resolveStyle runs per note, so twelve OKLCH conversions per note would be
// wasteful. The config is a small value, so keying a cache on it is enough.
const cache = new Map<string, Palette>()

export function buildPalette(config: ColorConfig): Palette {
  if (config.source !== 'pitch') return FIXED[config.source]

  const key = [
    config.basis,
    config.order,
    config.tone,
    config.rotate,
    config.accidentalShade,
    config.saturation ?? 1,
    (config.achromatic ?? []).join(''),
    (config.hueShift ?? []).map(Math.round).join(','),
  ].join('|')
  const hit = cache.get(key)
  if (hit) return hit

  const raw = toneById(config.tone)
  // Saturation scales the tone rather than replacing it, so a tone stays
  // recognisably itself at any level and 1 is always what it was designed as.
  const tone = { ...raw, chroma: raw.chroma * (config.saturation ?? 1) }
  const order = HUE_ORDERS.find((o) => o.id === config.order)!
  const anchor = (slot: number): string | null => {
    const kind = config.achromatic?.[slot] ?? 'none'
    return kind === 'light' ? ANCHOR_LIGHT : kind === 'dark' ? ANCHOR_DARK : null
  }

  if (config.basis === 'letter') {
    const L = Array.isArray(tone.lightness) ? tone.lightness[0] : tone.lightness
    const delta =
      config.accidentalShade === 'lighter' ? 0.1 : config.accidentalShade === 'darker' ? -0.13 : 0

    const colors: string[] = []
    const onColor: string[] = []
    const altColors: string[] = []
    const altOnColor: string[] = []

    for (let letter = 0; letter < 7; letter++) {
      const hue = noteHue(config, letter)
      const fixed = anchor(letter)
      const anchorL = fixed === ANCHOR_LIGHT ? 0.96 : 0.18
      colors.push(fixed ?? oklch(L, tone.chroma, hue))
      onColor.push(inkOn(fixed ? anchorL : L))
      // Same hue, optionally a shade off — so an accidental stays recognisably
      // a kind of its natural rather than becoming a separate colour. An
      // achromatic letter shades by lightness alone, having no hue to keep.
      const altL = clamp01(L + delta)
      altColors.push(fixed ? shiftLightness(fixed, delta) : oklch(altL, tone.chroma, hue))
      altOnColor.push(inkOn(fixed ? clamp01(anchorL + delta) : altL))
    }

    const palette: Palette = {
      id: `letter-${key}`,
      name: `${order.name} · ${tone.name}`,
      note: 'Sharps and flats share their letter’s colour. Tell them apart with shape or fill.',
      cvdSafe: false,
      domain: 'letter',
      colors,
      onColor,
      altColors,
      altOnColor,
    }
    cache.set(key, palette)
    return palette
  }

  let lightness = tone.lightness
  let byKeys = false

  if (config.order === 'keys') {
    // The instrument metaphor needs light naturals and dark accidentals, so a
    // single-lightness tone is split around its own value rather than ignored.
    byKeys = true
    if (!Array.isArray(lightness)) {
      lightness = [clamp01(lightness + 0.05), clamp01(lightness - 0.18)]
    }
  }

  const colors: string[] = []
  const onColor: string[] = []

  for (let pc = 0; pc < 12; pc++) {
    const L = Array.isArray(lightness)
      ? lightness[byKeys ? (isNatural(pc) ? 0 : 1) : pc % 2]
      : lightness
    const fixed = anchor(pc)
    colors.push(fixed ?? oklch(L, tone.chroma, noteHue(config, pc)))
    onColor.push(inkOn(fixed ? (fixed === ANCHOR_LIGHT ? 0.96 : 0.18) : L))
  }

  const palette: Palette = {
    id: `pitch-${key}`,
    name: `${order.name} · ${tone.name}`,
    note: order.note,
    cvdSafe: false,
    domain: 'pitchClass',
    colors,
    onColor,
  }

  cache.set(key, palette)
  return palette
}

export function isCvdSafe(config: ColorConfig): boolean {
  return COLOR_SOURCES.find((s) => s.id === config.source)?.cvdSafe ?? false
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

function paletteIndex(palette: Palette, note: NoteEvent, key: KeyMark): number {
  switch (palette.domain) {
    case 'pitchClass':
      return pitchClass(note.midi)
    case 'letter':
      return letterIndex(note.spelling.step)
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

/** On the letter basis a written accidental takes the shaded variant. */
const usesAlt = (palette: Palette, note: NoteEvent): boolean =>
  palette.domain === 'letter' && palette.altColors !== undefined && note.spelling.alter !== 0

export function colorFor(palette: Palette, note: NoteEvent, key: KeyMark): string {
  const index = paletteIndex(palette, note, key)
  if (usesAlt(palette, note)) return palette.altColors![index] ?? palette.colors[0]
  return palette.colors[index] ?? palette.colors[0]
}

/**
 * The colour a given pitch would be drawn in, without a note to ask about.
 *
 * Staff lines each sit at a fixed pitch — the bottom one is always G2 — so a
 * line can be told to wear that pitch's colour and then keep wearing it as the
 * palette is retuned. That is the point: matching by *rule* rather than by
 * copying a hex means the line still agrees with the notes after the hue wheel
 * has been spun.
 *
 * Spelling is assumed natural, which every staff line is.
 */
export function colorForPitch(palette: Palette, midi: number, key: KeyMark): string {
  switch (palette.domain) {
    case 'pitchClass':
      return palette.colors[pitchClass(midi)] ?? palette.colors[0]
    case 'letter': {
      const letter = LETTER_OF.get(pitchClass(midi))
      return palette.colors[letter ?? 0] ?? palette.colors[0]
    }
    case 'scaleDegree':
      return palette.colors[scaleDegree(midi, key)] ?? palette.colors[0]
    case 'octave':
      return (
        palette.colors[Math.max(0, Math.min(palette.colors.length - 1, octaveOf(midi)))] ??
        palette.colors[0]
      )
    // Hand and fixed carry nothing a line could match, so they fall back to the
    // first colour rather than pretending.
    default:
      return palette.colors[0]
  }
}

export function onColorFor(palette: Palette, note: NoteEvent, key: KeyMark): string {
  const index = paletteIndex(palette, note, key)
  if (usesAlt(palette, note)) return palette.altOnColor?.[index] ?? INK
  return palette.onColor?.[index] ?? INK
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
    note: 'Naturals round, sharps point up, flats point down.',
    domain: 'accidental',
    shapes: ['circle', 'triangleUp', 'triangleDown'],
  },
  {
    id: 'duration',
    name: 'Duration',
    note: 'Shape changes with note length — what stems and flags do, without them.',
    domain: 'duration',
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
    note: 'A distinct shape per degree, chromatic notes as diamonds. The strongest redundant channel.',
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

function durationBucket(beats: number): number {
  if (beats < 0.375) return 0
  if (beats < 0.75) return 1
  if (beats < 1.5) return 2
  if (beats < 3) return 3
  return 4
}

export function shapeFor(set: ShapeSet, note: NoteEvent, key: KeyMark): ShapeKind {
  switch (set.domain) {
    case 'fixed':
      return set.shapes[0]
    case 'accidental':
      if (note.spelling.alter > 0) return set.shapes[1]
      if (note.spelling.alter < 0) return set.shapes[2]
      // A black key with no written accidental (MIDI import) still reads sharp.
      return isBlackKey(note.midi) ? set.shapes[1] : set.shapes[0]
    case 'duration':
      return set.shapes[durationBucket(note.duration)]
    case 'hand':
      return set.shapes[note.hand === 'right' ? 0 : 1]
    case 'scaleDegree':
      return set.shapes[scaleDegree(note.midi, key)] ?? set.shapes[0]
  }
}
