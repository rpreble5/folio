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
import { diatonicIndex, isBlackKey } from '../core/pitch'
import type { Measure, PlacedNote, System } from './layout'
import { ACCIDENTAL_GLYPHS } from './glyphs'
import {
  HEAD_WIDTH,
  clusterUp,
  clustersOf,
  isHollow,
  layoutHeads,
  middleIndexFor,
  stackAccidentals,
} from './notation'

/** One moment in time, and everything that begins at it. */
export interface Column {
  beat: number
  /** Head origin within the system, once solved. */
  x: number
  /** Fixed room reserved before the heads — accidentals. */
  lead: number
  /** Fixed room reserved after the heads — the heads themselves, and dots. */
  rod: number
  /**
   * How far the column's own ink actually reaches past `x`.
   *
   * Less than the rod, which carries the air a following column is owed as well
   * as the glyph. Anything positioned *in* the gap between two columns — a
   * barline — needs the ink, or it measures from a head's left edge and lands
   * on top of that head's stem.
   */
  ink: number
  /** Stretchable room, from the gap to the next column. */
  spring: number
  /**
   * Whether anything is actually written here.
   *
   * False for the terminal column, which exists only so the last real column has
   * something to be spaced against. It sits at the system's end beat — which is
   * also the *next* system's first beat — so anything that looks up notes by
   * column beat finds the next system's first chord and draws it again at the
   * right-hand edge of this one.
   */
  content: boolean
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
  /** Pixels per staff space. Two diatonic steps make one. */
  space: number
  /** Vertical placement, shared with the proportional engine. */
  yFor: (axisPosition: number) => number
  axisPosition: (note: NoteEvent) => number
}

/**
 * The beats at which a note's later written heads stand.
 *
 * Empty for almost every note. A tied note carries one segment per written
 * head; the first stands at the onset and each of the rest at the running sum
 * of the beats before it. This is the one place that arithmetic lives.
 */
export function segmentStarts(note: NoteEvent): { beat: number; segment: number }[] {
  const segments = note.notated?.segments
  if (!segments || segments.length < 2) return []
  const out: { beat: number; segment: number }[] = []
  let beat = note.onset
  for (let k = 0; k < segments.length - 1; k += 1) {
    beat += segments[k].beats
    out.push({ beat, segment: k + 1 })
  }
  return out
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
export function engraveSystems(input: EngraveInput): number {
  const { score, spacing, systems, measuresBySystem, contentWidth, space } = input
  let reached = contentWidth

  // From the glyph, not from the lane height: the rods that keep two heads clear
  // of each other have to be the width of an actual head.
  const headWidth = space * HEAD_WIDTH
  const notesByBeat = groupByBeat(score.notes, (n) => n.onset)
  const restsByBeat = groupByBeat(score.rests ?? [], (r) => r.onset)

  for (const system of systems) {
    const measures = measuresBySystem.get(system.index) ?? []
    const columns = buildColumns(system, notesByBeat, restsByBeat, spacing, headWidth, input)
    const prefix = prefixWidth(score, system, spacing, headWidth)

    solve(columns, prefix, contentWidth, spacing)

    system.columns = columns
    system.contentStart = prefix
    // Unjustified, the rods decide the width and the music can end past the
    // width it was offered. Reporting how far it actually reached is what lets
    // the caller size the page to the music instead of cropping the music to
    // the page.
    reached = Math.max(reached, columns[columns.length - 1]?.x ?? 0)

    placeNotes(system, columns, notesByBeat, input, headWidth)
    displaceSeconds(system, input, headWidth)
    // Measures before rests: a whole-bar rest is centred in its bar, so it needs
    // the bar's edges to already be known.
    placeMeasures(system, columns, measures, contentWidth)
    placeRests(system, columns, restsByBeat, score, input)
  }

  return reached
}

/**
 * How much room a column's accidentals need.
 *
 * Runs the same packer the renderer uses, so the space reserved and the space
 * used are the same number by construction rather than by a matching pair of
 * guesses. `spacing.accidental` scales the result, so the control still works —
 * it just now scales something true.
 *
 * A displaced head also pushes the stack further left, so a column containing a
 * second gets one head width more.
 */
function accidentalLead(
  notes: NoteEvent[],
  spacing: SpacingConfig,
  headWidth: number,
  input: EngraveInput,
): number {
  const entries = notes.flatMap((note) => {
    const name = note.notated?.accidental
    const glyph = name ? ACCIDENTAL_GLYPHS[name] : undefined
    if (!glyph || !name) return []
    return [{
      noteId: note.id,
      y: input.yFor(input.axisPosition(note)),
      box: { glyph: name, width: glyph.width, top: glyph.top, bottom: glyph.bottom },
    }]
  })
  if (entries.length === 0) return 0

  const { width } = stackAccidentals(entries, input.space, 0)
  const indices = notes.map((n) => diatonicIndex(n.spelling)).sort((a, b) => a - b)
  const hasSecond = indices.some((v, i) => i > 0 && v - indices[i - 1] === 1)

  return (width + (hasSecond ? headWidth : 0)) * spacing.accidental
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
  input: EngraveInput,
): Column[] {
  const beats = new Set<number>()
  const inSystem = (beat: number) =>
    beat >= system.startBeat - EPSILON && beat < system.endBeat - EPSILON

  for (const beat of notesByBeat.keys()) if (inSystem(beat)) beats.add(beat)
  for (const beat of restsByBeat.keys()) if (inSystem(beat)) beats.add(beat)
  // The later heads of tied notes stand at their own beats and need their own
  // room — scanned from the whole score, because a tie can cross a system
  // boundary and its continuation belongs to a system its onset is not in.
  for (const note of input.score.notes) {
    for (const start of segmentStarts(note)) {
      if (inSystem(start.beat)) beats.add(quantize(start.beat))
    }
  }

  const ordered = Array.from(beats).sort((a, b) => a - b)
  const columns: Column[] = ordered.map((beat) => {
    const notes = notesByBeat.get(beat) ?? []
    const rests = restsByBeat.get(beat) ?? []

    // Room for the accidentals is the width of the *stack*, packed the same way
    // the renderer will pack it. A flat allowance reserved one accidental's worth
    // however many there were, so a chord with three stacked sharps drew them
    // into the previous column's space.
    const lead = accidentalLead(notes, spacing, headWidth, input)
    const dots = Math.max(
      0,
      ...notes.map((n) => n.notated?.segments[0]?.dots ?? 0),
      ...rests.map((r) => r.notated?.segments[0]?.dots ?? 0),
    )

    return {
      beat,
      x: 0,
      lead,
      rod: (spacing.crowd + (dots > 0 ? spacing.dot * dots : 0)) * headWidth,
      ink: (1 + (dots > 0 ? spacing.dot * dots : 0)) * headWidth,
      spring: 0,
      content: true,
    }
  })

  columns.push({
    beat: system.endBeat,
    x: 0,
    lead: 0,
    rod: 0,
    ink: 0,
    spring: 0,
    content: false,
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
    if (!column.content) continue
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

  /*
   * The later heads of tied notes.
   *
   * A tie is one sound written as several heads, and until now only the first
   * of them was drawn — a half tied over the barline into a quarter appeared as
   * a bare half, and the bar it tied into was short of its ink. Each later
   * segment stands at its own column, wears its own written value, and belongs
   * to whichever system its beat falls in, which is how a tie crosses a line
   * break without either half going missing.
   *
   * Scanned from the whole score rather than from this system's notes for
   * exactly that reason: the onset may be lines away.
   */
  for (const note of score.notes) {
    const starts = segmentStarts(note)
    if (starts.length === 0) continue
    const key = keyAt(score, note.onset)
    const base = resolveStyle(note, theme, key)
    for (const start of starts) {
      if (start.beat < system.startBeat - EPSILON || start.beat >= system.endBeat - EPSILON) {
        continue
      }
      const column = columns.find((c) => Math.abs(c.beat - start.beat) < EPSILON)
      if (!column) continue
      const segment = note.notated!.segments[start.segment]
      const height = noteHeight * base.scale
      system.notes.push({
        note,
        segment: start.segment,
        beat: start.beat,
        x: column.x,
        width: headWidth,
        y: yFor(axisPosition(note)) - height / 2 + noteHeight / 2,
        height,
        /*
         * Hollowness is per written head, not per note: a half tied into a
         * quarter is hollow then solid. Only when hollowness is *encoding* the
         * written value, though — a theme outlining, say, the accidentals has
         * said hollow means something else, and each head keeps that meaning.
         */
        style:
          theme.encodings.outlineWhat === 'writtenLong'
            ? { ...base, filled: !isHollow(segment.type) }
            : base,
        black: isBlackKey(note.midi),
      })
    }
  }
}


/**
 * Resolve seconds within every chord, writing the offset onto each placed note.
 *
 * Done here rather than in the renderer because *both* halves need it and they
 * must agree exactly: ScoreView draws the heads, NotationLayer draws the stems
 * and accidentals against them. Deriving it twice would be two chances to differ.
 */
function displaceSeconds(system: System, input: EngraveInput, headWidth: number): void {
  const { score } = input
  const stemWidth = (input.theme.layout.notation?.weight ?? 0.12) * input.space
  const staffOf = (placed: PlacedNote) => (placed.note.hand === 'left' ? 2 : 1)

  const middleFor = (staff: number) =>
    middleIndexFor(
      score.clefs?.find((c) => c.staff === staff) ??
        (staff >= 2
          ? { beat: 0, staff, sign: 'F', line: 4, octaveChange: 0 }
          : { beat: 0, staff, sign: 'G', line: 2, octaveChange: 0 }),
    )

  for (const cluster of clustersOf(system, staffOf)) {
    const up = clusterUp(cluster, middleFor(cluster.staff))
    for (const head of layoutHeads(cluster, up, headWidth, stemWidth)) {
      head.placed.dx = head.dx
    }
  }
}

/**
 * Where a rest sits when the file did not say.
 *
 * Not all on the same line, which is the mistake that is easy to make and easy
 * to see once made. Every rest glyph is drawn to attach to a staff *line*, and
 * they attach to different ones:
 *
 *   - A whole rest **hangs below the fourth line**, one above the middle. Its
 *     ink runs downward from its origin (-0.04 to +0.54 spaces), which is what
 *     makes it read as hanging.
 *   - A half rest **sits on the middle line**. Its ink runs upward (-0.57 to
 *     +0.01), so it appears to rest on top of it.
 *   - Everything shorter is centred on the middle line.
 *
 * Put the whole rest on the middle line with the rest of them and it hangs a
 * whole line too low, which reads as a half rest that has come loose.
 */
function restIndex(rest: RestEvent, clef: ClefMark): number {
  if (rest.displayIndex !== undefined) return rest.displayIndex

  const middle = middleIndexFor(clef)
  const type = rest.wholeBar ? 'whole' : rest.notated?.segments[0]?.type
  // Two diatonic steps is one staff space, so this is the line above the middle.
  return type === 'whole' ? middle + 2 : middle
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
    if (!column.content) continue
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
 *
 * The gap is measured between *ink*, not between origins. Centring on the
 * previous column's origin spends half the measurement on that column's own
 * notehead, so the line comes out a head-width too far left and sits against the
 * stem of the bar's last note, reading as a thin double bar.
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
    const gapStart = previous.x + previous.ink
    const gapEnd = column.x - column.lead
    // Packed to the rods there is no gap left to centre in, and the only place
    // that is not on top of a glyph is hard against the following one.
    return gapStart >= gapEnd ? gapEnd : (gapStart + gapEnd) / 2
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
