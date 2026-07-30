/**
 * Engraved horizontal placement: springs and rods.
 *
 * The roll places a note at `onset × beatWidth`, which makes length mean
 * duration and is the whole point of it. Engraved notation cannot work that way,
 * because duration is carried by the head, stem and flags instead, and space is
 * allotted by a rule that grows far more slowly than time does. A bar of
 * sixteenths and a bar of one whole note take comparable room on the page.
 *
 * The model, which is the one engravers describe:
 *
 *   - A **column** is everything that starts at the same moment, across every
 *     staff and voice. Columns are what get spaced; individual notes do not.
 *   - Between two columns sits a **spring**, whose natural length comes from the
 *     gap between them: `unit × gap ^ power`. That exponent is the only thing
 *     separating this from the roll — see SpacingConfig.
 *   - Around each column sit **rods**: fixed widths that a glyph needs whatever
 *     the tempo. An accidental needs room before the head, a dot after it, and
 *     two heads always need clearance from each other.
 *
 * Solving is then: lay the rods, stretch the springs to fill what is left. Rods
 * never stretch, which is what stops a crowded bar from becoming illegible when
 * its line is justified, and what stops a sparse one from having its accidentals
 * drift away from their heads.
 *
 * Pure and DOM-free, like layout.ts, and it deliberately produces the same
 * PlacedNote shape — so the renderer does not know or care which engine placed
 * a note, and every visual channel keeps working untouched.
 */

import type { ClefMark, NoteEvent, RestEvent, Score } from '../core/types'
import { clefAt, keyAt } from '../core/types'
import type { SpacingConfig, Theme } from '../core/theme'
import { resolveStyle } from '../core/theme'
import { isBlackKey } from '../core/pitch'
import type { Measure, PlacedNote, System } from './layout'

/** One moment in time, and everything that begins at it. */
export interface Column {
  beat: number
  /** Head origin within the system, once solved. */
  x: number
  /** Fixed room reserved before the heads — accidentals. */
  lead: number
  /** Fixed room reserved after the heads — the heads themselves, and dots. */
  rod: number
  /** Stretchable room, from the gap to the next column. */
  spring: number
}

/** A rest, placed. Drawn by the glyph layer; here only to occupy a column. */
export interface PlacedRest {
  rest: RestEvent
  x: number
  y: number
  /** Staff this rest belongs to, so the glyph layer knows which one to sit on. */
  staff: number
}

export interface EngraveInput {
  score: Score
  theme: Theme
  spacing: SpacingConfig
  systems: System[]
  measuresBySystem: Map<number, Measure[]>
  /** Width available for music, gutter and right pad already removed. */
  contentWidth: number
  noteHeight: number
  /** Vertical placement, shared with the proportional engine. */
  yFor: (axisPosition: number) => number
  axisPosition: (note: NoteEvent) => number
}

/** Rounding floor for grouping onsets into columns. A thousandth of a beat. */
const EPSILON = 1e-3

const quantize = (beat: number): number => Math.round(beat / EPSILON) * EPSILON

/**
 * Natural spring length for a gap, in pixels.
 *
 * A zero or negative gap gets no spring at all rather than a NaN from raising
 * it to a fractional power — that happens at the last column of a system whose
 * final note runs exactly to the barline.
 */
function springFor(gap: number, spacing: SpacingConfig): number {
  if (gap <= 0) return 0
  return spacing.unit * Math.pow(gap, spacing.power)
}

/**
 * Room for what stands at the head of a system.
 *
 * Clef and key signature are redrawn on every line, as they are on paper; the
 * time signature only where it actually changes, which includes the first line.
 * Widths are in head widths so the whole prefix scales with the staff.
 */
function prefixWidth(
  score: Score,
  system: System,
  spacing: SpacingConfig,
  headWidth: number,
): number {
  const key = keyAt(score, system.startBeat)
  const accidentals = Math.min(7, Math.abs(key.fifths))
  const changesTime =
    system.index === 0 ||
    score.timeSignatures.some((t) => Math.abs(t.beat - system.startBeat) < EPSILON)

  const units =
    spacing.prefix + accidentals * 0.62 + (changesTime ? 1.7 : 0)
  return units * headWidth
}

/**
 * Place every note and rest in every system, and set the barline positions.
 *
 * Mutates the systems in place, matching how the proportional engine fills
 * them, so the two are interchangeable from the caller's side.
 */
export function engraveSystems(input: EngraveInput): void {
  const { score, spacing, systems, measuresBySystem, contentWidth, noteHeight } = input

  const headWidth = noteHeight * 1.24
  const notesByBeat = groupByBeat(score.notes, (n) => n.onset)
  const restsByBeat = groupByBeat(score.rests ?? [], (r) => r.onset)

  for (const system of systems) {
    const measures = measuresBySystem.get(system.index) ?? []
    const columns = buildColumns(system, notesByBeat, restsByBeat, spacing, headWidth)
    const prefix = prefixWidth(score, system, spacing, headWidth)

    solve(columns, prefix, contentWidth, spacing)

    system.columns = columns
    system.contentStart = prefix

    placeNotes(system, columns, notesByBeat, input, headWidth)
    // Measures before rests: a whole-bar rest is centred in its bar, so it needs
    // the bar's edges to already be known.
    placeMeasures(system, columns, measures, contentWidth)
    placeRests(system, columns, restsByBeat, score, input)
  }
}

function groupByBeat<T>(items: T[], onsetOf: (item: T) => number): Map<number, T[]> {
  const byBeat = new Map<number, T[]>()
  for (const item of items) {
    const beat = quantize(onsetOf(item))
    const bucket = byBeat.get(beat)
    if (bucket) bucket.push(item)
    else byBeat.set(beat, [item])
  }
  return byBeat
}

/**
 * Every column in a system, with its natural spring and its rods.
 *
 * A terminal column is appended at the system's end beat carrying no content.
 * It exists so the last real column has something to be spaced against, and so
 * beat-to-x interpolation is total rather than needing a special case past the
 * final note.
 */
function buildColumns(
  system: System,
  notesByBeat: Map<number, NoteEvent[]>,
  restsByBeat: Map<number, RestEvent[]>,
  spacing: SpacingConfig,
  headWidth: number,
): Column[] {
  const beats = new Set<number>()
  const inSystem = (beat: number) =>
    beat >= system.startBeat - EPSILON && beat < system.endBeat - EPSILON

  for (const beat of notesByBeat.keys()) if (inSystem(beat)) beats.add(beat)
  for (const beat of restsByBeat.keys()) if (inSystem(beat)) beats.add(beat)

  const ordered = Array.from(beats).sort((a, b) => a - b)
  const columns: Column[] = ordered.map((beat) => {
    const notes = notesByBeat.get(beat) ?? []
    const rests = restsByBeat.get(beat) ?? []

    // An accidental anywhere in the column pushes the whole column right: the
    // heads stay aligned, and the symbols stack into the room made for them.
    const hasAccidental = notes.some((n) => n.notated?.accidental)
    const dots = Math.max(
      0,
      ...notes.map((n) => n.notated?.segments[0]?.dots ?? 0),
      ...rests.map((r) => r.notated?.segments[0]?.dots ?? 0),
    )

    return {
      beat,
      x: 0,
      lead: hasAccidental ? spacing.accidental * headWidth : 0,
      rod: (spacing.crowd + (dots > 0 ? spacing.dot * dots : 0)) * headWidth,
      spring: 0,
    }
  })

  columns.push({
    beat: system.endBeat,
    x: 0,
    lead: 0,
    rod: 0,
    spring: 0,
  })

  for (let i = 0; i < columns.length - 1; i += 1) {
    columns[i].spring = springFor(columns[i + 1].beat - columns[i].beat, spacing)
  }

  return columns
}

/**
 * Lay the rods, then stretch the springs into whatever is left.
 *
 * The advance from one column to the next is `max(rod, spring)`: the rod is a
 * floor the spring cannot be squeezed below, so a bar of thirty-seconds packs to
 * its rods and stops, rather than overlapping. Because of that floor, scaling
 * the springs by one factor does not land exactly on the target width, so the
 * factor is solved by bisection — a dozen iterations, no algebra, and it copes
 * with any mix of clamped and unclamped springs.
 */
function solve(
  columns: Column[],
  prefix: number,
  contentWidth: number,
  spacing: SpacingConfig,
): void {
  const fixed = prefix + columns.reduce((sum, c) => sum + c.lead, 0)
  const target = contentWidth - fixed

  const spanAt = (factor: number): number =>
    columns
      .slice(0, -1)
      .reduce((sum, c) => sum + Math.max(c.rod, c.spring * factor), 0)

  let factor = 1
  if (spacing.justify > 0 && target > 0 && spanAt(1) > 0) {
    let low = 0
    let high = 1
    // Grow the bracket until it contains the answer. A line of one whole note
    // can need a very large factor, so this is not a fixed range.
    while (spanAt(high) < target && high < 4096) high *= 2
    for (let i = 0; i < 40; i += 1) {
      const mid = (low + high) / 2
      if (spanAt(mid) < target) low = mid
      else high = mid
    }
    // Partial justification interpolates the factor, not the positions, so the
    // rods keep their floor the whole way across the slider.
    factor = 1 + (high - 1) * spacing.justify
  }

  let cursor = prefix
  for (let i = 0; i < columns.length; i += 1) {
    const column = columns[i]
    cursor += column.lead
    column.x = cursor
    cursor += Math.max(column.rod, column.spring * factor)
  }
}

function placeNotes(
  system: System,
  columns: Column[],
  notesByBeat: Map<number, NoteEvent[]>,
  input: EngraveInput,
  headWidth: number,
): void {
  const { score, theme, yFor, axisPosition, noteHeight } = input

  for (const column of columns) {
    for (const note of notesByBeat.get(quantize(column.beat)) ?? []) {
      const key = keyAt(score, note.onset)
      const style = resolveStyle(note, theme, key)
      const height = noteHeight * style.scale

      const placed: PlacedNote = {
        note,
        x: column.x,
        // Fixed, not duration-derived: this is the whole difference. Duration is
        // the head's business now, and the head is one size.
        width: headWidth,
        y: yFor(axisPosition(note)) - height / 2 + noteHeight / 2,
        height,
        style,
        black: isBlackKey(note.midi),
      }
      system.notes.push(placed)
    }
  }
}

/**
 * Where a rest sits when the file did not say.
 *
 * The convention is the middle line of its staff, which for a single voice is
 * right and for several voices is the starting point that gets nudged apart.
 * Multi-voice offsetting is deliberately not attempted here.
 */
function restIndex(rest: RestEvent, clef: ClefMark): number {
  if (rest.displayIndex !== undefined) return rest.displayIndex
  // Middle line of a staff: two lines above its lowest, in diatonic steps.
  return middleIndexFor(clef)
}

/**
 * Diatonic index of a clef's middle staff line.
 *
 * A clef names one pitch and pins it to one line, so the middle line is that
 * pitch stepped by the distance from the clef's line to line three.
 */
export function middleIndexFor(clef: ClefMark): number {
  const pinned = CLEF_PITCH[clef.sign] + clef.octaveChange * 7
  return pinned + (3 - clef.line) * 2
}

/** The diatonic index each clef sign names, at its own line. */
const CLEF_PITCH: Record<ClefMark['sign'], number> = {
  // G4 = octave 4 × 7 + step index of G (4).
  G: 4 * 7 + 4,
  // F3 = octave 3 × 7 + step index of F (3).
  F: 3 * 7 + 3,
  // C4.
  C: 4 * 7 + 0,
  percussion: 4 * 7 + 0,
  TAB: 4 * 7 + 0,
}

function placeRests(
  system: System,
  columns: Column[],
  restsByBeat: Map<number, RestEvent[]>,
  score: Score,
  input: EngraveInput,
): void {
  const { yFor, noteHeight } = input
  const placed: PlacedRest[] = []

  for (const column of columns) {
    for (const rest of restsByBeat.get(quantize(column.beat)) ?? []) {
      const clef = clefAt(score, rest.onset, rest.staff)
      placed.push({
        rest,
        // A whole-bar rest is centred in its bar, not left-aligned at its onset.
        x: rest.wholeBar ? wholeBarCentre(system, column, columns) : column.x,
        y: yFor(restIndex(rest, clef)) + noteHeight / 2,
        staff: rest.staff,
      })
    }
  }

  if (placed.length) system.rests = placed
}

/** Midpoint of the bar a whole-bar rest stands for. */
function wholeBarCentre(system: System, column: Column, columns: Column[]): number {
  const bar = system.measures.find(
    (m) => column.beat >= m.startBeat - EPSILON && column.beat < m.endBeat - EPSILON,
  )
  if (bar) return bar.x + bar.width / 2
  const last = columns[columns.length - 1]
  return (column.x + last.x) / 2
}

/**
 * Barlines sit where the music actually reaches, not at a beat multiple.
 *
 * A bar's left edge is the column that opens it, less half the gap back to the
 * previous column — a barline drawn hard against the following head reads as
 * crowded, and engravers centre it in the space.
 */
function placeMeasures(
  system: System,
  columns: Column[],
  measures: Measure[],
  contentWidth: number,
): void {
  const edgeFor = (beat: number): number => {
    const index = columns.findIndex((c) => c.beat >= beat - EPSILON)
    if (index < 0) return contentWidth
    const column = columns[index]
    const previous = columns[index - 1]
    if (!previous) return Math.max(0, column.x - column.lead)
    const gapStart = previous.x
    return (gapStart + column.x - column.lead) / 2
  }

  for (const measure of measures) {
    const x = edgeFor(measure.startBeat)
    const end = edgeFor(measure.endBeat)
    system.measures.push({ ...measure, x, width: Math.max(0, end - x) })
  }
}

/**
 * Beat → x within an engraved system, by interpolating between columns.
 *
 * Linear within a column's span, which is not how the note inside it is drawn —
 * but a playhead crossing a held note should move evenly, and there is nothing
 * else in the geometry to interpolate against.
 */
export function interpolateBeat(columns: Column[], beat: number): number {
  if (columns.length === 0) return 0
  if (beat <= columns[0].beat) return columns[0].x

  for (let i = 0; i < columns.length - 1; i += 1) {
    const a = columns[i]
    const b = columns[i + 1]
    if (beat >= b.beat) continue
    const span = b.beat - a.beat
    if (span <= 0) return a.x
    return a.x + ((beat - a.beat) / span) * (b.x - a.x)
  }

  return columns[columns.length - 1].x
}
