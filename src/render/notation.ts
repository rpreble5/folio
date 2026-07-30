/**
 * Notation furniture: stems, flags, beams, dots, accidentals, and what stands at
 * the head of a line.
 *
 * Everything here is *derived* — nothing is read from the file that the importer
 * did not already record, and nothing is invented that convention does not
 * dictate. That is the line worth holding, because the moment this module starts
 * guessing, the page stops being a faithful reading of the score.
 *
 * Kept separate from engrave.ts because the two answer different questions.
 * Engraving decides *where* things go horizontally; this decides *what* is drawn
 * once a note has a position. The split also means a theme can switch every one
 * of these off and get its position back unchanged.
 */

import type { ClefMark, KeyMark, NoteEvent, NoteType, Score, TimeSignature } from '../core/types'
import { clefAt, keyAt, timeSignatureAt } from '../core/types'
import { diatonicIndex } from '../core/pitch'
import type { PlacedNote, System } from './layout'

// ---------------------------------------------------------------------------
// Note type arithmetic
// ---------------------------------------------------------------------------

/** How many beams or flags a written value carries. Zero at a quarter or longer. */
const TAILS: Record<NoteType, number> = {
  breve: 0,
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  '16th': 2,
  '32nd': 3,
  '64th': 4,
  '128th': 5,
}

/** Written values drawn with a hollow head. */
const HOLLOW: ReadonlySet<NoteType> = new Set<NoteType>(['breve', 'whole', 'half'])

/** Written values with no stem at all. */
const STEMLESS: ReadonlySet<NoteType> = new Set<NoteType>(['breve', 'whole'])

/**
 * The written value of a note, falling back to its duration.
 *
 * MIDI and the built-in pieces carry no written types, and refusing to engrave
 * them would be worse than inferring — a piano roll import should still get
 * stems. The inference is the same one the importer uses for MusicXML files that
 * omit <type>, so the two paths agree.
 */
export function writtenTypeOf(note: NoteEvent): { type: NoteType; dots: number } {
  const segment = note.notated?.segments[0]
  if (segment) return { type: segment.type, dots: segment.dots }
  return inferType(note.duration)
}

/** The shortest written value that accounts for a sounding length. */
export function inferType(beats: number): { type: NoteType; dots: number } {
  const bases: [NoteType, number][] = [
    ['breve', 8],
    ['whole', 4],
    ['half', 2],
    ['quarter', 1],
    ['eighth', 0.5],
    ['16th', 0.25],
    ['32nd', 0.125],
    ['64th', 0.0625],
    ['128th', 0.03125],
  ]
  let best: { type: NoteType; dots: number } = { type: 'quarter', dots: 0 }
  let closest = Infinity
  for (const [type, base] of bases) {
    for (let dots = 0; dots <= 2; dots += 1) {
      const error = Math.abs(base * (2 - 2 ** -dots) - beats)
      if (error < closest - 1e-9) {
        closest = error
        best = { type, dots }
      }
    }
  }
  return best
}

export const tailsFor = (type: NoteType): number => TAILS[type]
export const isHollow = (type: NoteType): boolean => HOLLOW.has(type)
export const isStemless = (type: NoteType): boolean => STEMLESS.has(type)

/**
 * A notehead's width, in staff spaces.
 *
 * Bravura's black head measures 1.18 and its origin is the head's *left* edge at
 * the vertical centre — not its middle. Everything that positions a head or
 * attaches to one has to agree on both facts, so both live here.
 */
export const HEAD_WIDTH = 1.18

// ---------------------------------------------------------------------------
// Staff geometry
// ---------------------------------------------------------------------------

/** The diatonic index each clef sign names, at its own line. */
const CLEF_PITCH: Record<ClefMark['sign'], number> = {
  G: 4 * 7 + 4,
  F: 3 * 7 + 3,
  C: 4 * 7 + 0,
  percussion: 4 * 7 + 0,
  TAB: 4 * 7 + 0,
}

/**
 * Diatonic index of a clef's middle staff line.
 *
 * A clef names one pitch and pins it to one line, so the middle line is that
 * pitch stepped by the distance from the clef's line to line three. This is the
 * only place the grand staff's line positions come from, which is what lets a
 * score with two treble clefs draw correctly rather than as a piano part.
 */
export function middleIndexFor(clef: ClefMark): number {
  return CLEF_PITCH[clef.sign] + clef.octaveChange * 7 + (3 - clef.line) * 2
}

/** The five line positions of a staff, lowest first, as diatonic indices. */
export function staffLineIndices(clef: ClefMark): number[] {
  const middle = middleIndexFor(clef)
  return [middle - 4, middle - 2, middle, middle + 2, middle + 4]
}

// ---------------------------------------------------------------------------
// Stems
// ---------------------------------------------------------------------------

export interface Stem {
  x: number
  /** At the head. */
  y0: number
  /** At the free end, where a flag or beam attaches. */
  y1: number
  up: boolean
}

export interface PlacedFlag {
  x: number
  y: number
  /** Glyph key into FLAG_GLYPHS. */
  glyph: string
}

/** A run of notes under one beam, in playing order. */
export interface BeamGroup {
  notes: PlacedNote[]
  up: boolean
  /** Beam lines, outermost first, each as two endpoints. */
  lines: { x0: number; y0: number; x1: number; y1: number; level: number }[]
}

/**
 * Which way a stem points.
 *
 * The engraver's own direction wins when the file recorded one. Otherwise the
 * convention: a note below the middle line stems up, above it stems down, and
 * one *on* the middle line stems down, which is the tie-break Gould gives.
 */
export function stemUp(note: NoteEvent, middleIndex: number): boolean {
  const stated = note.notated?.stem
  if (stated === 'up') return true
  if (stated === 'down') return false
  return diatonicIndex(note.spelling) < middleIndex
}

/**
 * Stem length, in staff spaces.
 *
 * A stem is 3.5 spaces — an octave — from the head's centre, and that is the
 * answer for almost every note. The exception is a note far enough outside the
 * staff that a 3.5-space stem would not get back to the middle line: there the
 * stem is *lengthened to reach* the middle line, so it stays visually tied to
 * the staff instead of hanging in space.
 *
 * The distinction that matters is `max`, not `+`. Adding the distance to the
 * base makes every note below the middle line grow a longer stem, which lines
 * all the stem-tops up at one height and destroys the parallel diagonal that
 * makes a rising phrase read as rising. It has to be whichever of the two is
 * longer, and for anything inside the staff that is always the base.
 */
function stemSpaces(indexFromMiddle: number, up: boolean): number {
  const base = 3.5
  // Does the stem point toward the middle line, or away from it?
  const toward = up ? indexFromMiddle < 0 : indexFromMiddle > 0
  if (!toward) return base
  // indexFromMiddle is in diatonic steps; two steps make a space.
  return Math.max(base, Math.abs(indexFromMiddle) / 2)
}

/**
 * A chord: everything that starts at the same moment on the same staff in the
 * same voice, sorted low to high.
 *
 * This is the unit stems and beams work on, and getting it wrong is visible
 * immediately — a four-note chord given four stems draws four overlapping lines
 * whose union looks like one absurdly long stem.
 */
export interface Cluster {
  notes: PlacedNote[]
  staff: number
  voice: number
  onset: number
}

export function clustersOf(
  system: System,
  staffOf: (placed: PlacedNote) => number,
): Cluster[] {
  const byKey = new Map<string, Cluster>()

  for (const placed of system.notes) {
    const staff = staffOf(placed)
    const voice = placed.note.voice
    const key = `${Math.round(placed.note.onset * 1000)}:${staff}:${voice}`
    const existing = byKey.get(key)
    if (existing) existing.notes.push(placed)
    else byKey.set(key, { notes: [placed], staff, voice, onset: placed.note.onset })
  }

  const clusters = Array.from(byKey.values())
  for (const cluster of clusters) {
    cluster.notes.sort(
      (a, b) => diatonicIndex(a.note.spelling) - diatonicIndex(b.note.spelling),
    )
  }
  return clusters.sort((a, b) => a.onset - b.onset)
}

/**
 * Which way a chord's stem points.
 *
 * The note furthest from the middle line decides for the whole chord, which is
 * the convention and also the only choice that keeps the stem from crossing the
 * middle of the notes. A stated direction on any note still wins — if the
 * engraver said, the engraver said.
 */
export function clusterUp(cluster: Cluster, middleIndex: number): boolean {
  for (const placed of cluster.notes) {
    const stated = placed.note.notated?.stem
    if (stated === 'up') return true
    if (stated === 'down') return false
  }

  const indices = cluster.notes.map((p) => diatonicIndex(p.note.spelling))
  const lowest = indices[0] - middleIndex
  const highest = indices[indices.length - 1] - middleIndex
  // Ties go down, which is what convention gives for a note on the middle line.
  return Math.abs(lowest) > Math.abs(highest) ? lowest < 0 : highest < 0
}

/**
 * The stem for a chord, or null when its written value has none.
 *
 * It runs from the *near* head — the one at the stem's root — past the *far*
 * head by the stem length, so a wide chord gets a long stem and a single note
 * gets the standard 3.5 spaces. Attaches at the side of the head rather than its
 * centre: up-stems right, down-stems left. On a tilted oval that is the only
 * attachment with no visible gap between stem and head.
 */
export function stemForCluster(
  cluster: Cluster,
  middleIndex: number,
  space: number,
  headWidth: number,
): Stem | null {
  const drawable = cluster.notes.filter((p) => {
    const { type } = writtenTypeOf(p.note)
    return !isStemless(type) && p.note.notated?.stem !== 'none'
  })
  if (drawable.length === 0) return null

  const up = clusterUp(cluster, middleIndex)
  const centres = drawable.map((p) => ({
    cy: p.y + p.height / 2,
    index: diatonicIndex(p.note.spelling),
    x: p.x + p.width / 2,
  }))

  // Root at the near end, tip beyond the far end.
  const root = up
    ? centres.reduce((a, b) => (b.cy > a.cy ? b : a))
    : centres.reduce((a, b) => (b.cy < a.cy ? b : a))
  const far = up
    ? centres.reduce((a, b) => (b.cy < a.cy ? b : a))
    : centres.reduce((a, b) => (b.cy > a.cy ? b : a))

  const length = stemSpaces(far.index - middleIndex, up) * space
  const edge = headWidth / 2 - space * 0.06

  return {
    x: root.x + (up ? edge : -edge),
    y0: root.cy,
    y1: up ? far.cy - length : far.cy + length,
    up,
  }
}

/**
 * Flags for an unbeamed chord, or null.
 *
 * A chord in a beam group never gets one — the beam is the flag.
 */
export function flagFor(cluster: Cluster, stem: Stem): PlacedFlag | null {
  const tails = Math.max(
    0,
    ...cluster.notes.map((p) => tailsFor(writtenTypeOf(p.note).type)),
  )
  if (tails === 0) return null

  // Bravura draws one flag per value up to the 32nd; beyond that we reuse the
  // 32nd, which is visibly wrong for a 64th and vanishingly rare in the piano
  // repertoire this is for. Naming it rather than pretending.
  const name = tails === 1 ? 'eighth' : tails === 2 ? '16th' : '32nd'
  return { x: stem.x, y: stem.y1, glyph: `${name}${stem.up ? 'Up' : 'Down'}` }
}

// ---------------------------------------------------------------------------
// Beams
// ---------------------------------------------------------------------------

/**
 * Group clusters into beams, from the beam states the importer read.
 *
 * A group opens on `begin` and closes on `end`, per beam level. Only level one
 * decides grouping — the outer beam spans the whole group, and inner beams are
 * drawn as segments inside it.
 *
 * Clusters with no beam data are left out and get flags instead. That is
 * deliberate: MIDI imports have no beams, and deriving beam groups from metrical
 * position is a genuine engraving *decision* rather than a reading of the file.
 * Honest flags beat invented beams.
 */
export function beamGroups(
  clusters: Cluster[],
  middleFor: (staff: number) => number,
  space: number,
  headWidth: number,
  beamWeight: number,
): { groups: BeamGroup[]; beamed: Set<string> } {
  const groups: BeamGroup[] = []
  const beamed = new Set<string>()

  // Beaming is per voice and per staff: two voices sharing a staff have
  // independent beams, and merging them would join notes that are not a run.
  const byLane = new Map<string, Cluster[]>()
  for (const cluster of clusters) {
    const beams = cluster.notes[0]?.note.notated?.segments[0]?.beams
    if (!beams || beams.length === 0) continue
    const lane = `${cluster.staff}:${cluster.voice}`
    const list = byLane.get(lane)
    if (list) list.push(cluster)
    else byLane.set(lane, [cluster])
  }

  for (const [lane, laneClusters] of byLane) {
    const staff = Number(lane.split(':')[0])
    const middle = middleFor(staff)
    laneClusters.sort((a, b) => a.onset - b.onset)

    let run: Cluster[] = []
    for (const cluster of laneClusters) {
      const outer = cluster.notes[0]?.note.notated?.segments[0]?.beams?.[0]
      if (outer === 'begin') run = [cluster]
      else if (run.length) run.push(cluster)

      if (outer === 'end') {
        if (run.length >= 2) {
          groups.push(buildGroup(run, middle, space, headWidth, beamWeight))
          for (const c of run) for (const n of c.notes) beamed.add(n.note.id)
        }
        run = []
      }
    }
  }

  return { groups, beamed }
}

/**
 * One beam group's geometry.
 *
 * Direction is decided for the group as a whole, by majority — a run that
 * straddles the middle line has to pick one, and letting each cluster choose
 * would put the beam through the middle of the notes. The beam takes the slope
 * of the line between the first and last stem ends, clamped: engraving limits
 * beam slope so a wide leap does not produce a beam reading as a glissando.
 */
function buildGroup(
  run: Cluster[],
  middleIndex: number,
  space: number,
  headWidth: number,
  beamWeight: number,
): BeamGroup {
  const ups = run.filter((c) => clusterUp(c, middleIndex)).length
  const up = ups * 2 >= run.length

  const stems = run.map((cluster) => {
    const centres = cluster.notes.map((p) => ({
      cy: p.y + p.height / 2,
      index: diatonicIndex(p.note.spelling),
      x: p.x + p.width / 2,
    }))
    const root = up
      ? centres.reduce((a, b) => (b.cy > a.cy ? b : a))
      : centres.reduce((a, b) => (b.cy < a.cy ? b : a))
    const far = up
      ? centres.reduce((a, b) => (b.cy < a.cy ? b : a))
      : centres.reduce((a, b) => (b.cy > a.cy ? b : a))
    const length = stemSpaces(far.index - middleIndex, up) * space
    const edge = headWidth / 2 - space * 0.06
    return {
      x: root.x + (up ? edge : -edge),
      free: up ? far.cy - length : far.cy + length,
    }
  })

  const first = stems[0]
  const last = stems[stems.length - 1]
  const span = last.x - first.x

  // Clamp the slope to a quarter — one space of rise per four across, which is
  // near the limit published tables allow.
  const raw = span > 0 ? (last.free - first.free) / span : 0
  const slope = Math.max(-0.25, Math.min(0.25, raw))

  // Anchor the beam beyond the furthest stem end, so no stem falls short of it.
  const at = (x: number, intercept: number) => intercept + slope * (x - first.x)
  let intercept = first.free
  for (const stem of stems) {
    const have = at(stem.x, intercept)
    if (up ? stem.free < have : stem.free > have) intercept += stem.free - have
  }

  const levels = Math.max(
    1,
    ...run.flatMap((c) => c.notes.map((p) => tailsFor(writtenTypeOf(p.note).type))),
  )
  const lines: BeamGroup['lines'] = []
  const step = (beamWeight + space * 0.25) * (up ? 1 : -1)
  const tailsOf = (cluster: Cluster) =>
    Math.max(0, ...cluster.notes.map((p) => tailsFor(writtenTypeOf(p.note).type)))

  for (let level = 0; level < levels; level += 1) {
    const y = (x: number) => at(x, intercept) + step * level
    if (level === 0) {
      lines.push({ x0: first.x, y0: y(first.x), x1: last.x, y1: y(last.x), level })
      continue
    }
    // Inner beams only span the clusters short enough to carry them, as runs.
    let start = -1
    for (let i = 0; i < run.length; i += 1) {
      const carries = tailsOf(run[i]) > level
      if (carries && start < 0) start = i
      const closes = !carries || i === run.length - 1
      if (start >= 0 && closes) {
        const a = stems[start]
        const b = stems[carries ? i : i - 1]
        if (a !== b) {
          lines.push({ x0: a.x, y0: y(a.x), x1: b.x, y1: y(b.x), level })
        } else {
          // A lone short note gets a hook, pointed back toward its group.
          const hook = space * 0.9 * (start === 0 ? 1 : -1)
          lines.push({ x0: a.x, y0: y(a.x), x1: a.x + hook, y1: y(a.x + hook), level })
        }
        start = -1
      }
    }
  }

  return { notes: run.flatMap((c) => c.notes), up, lines }
}

/** Where a beamed note's stem should end: on the group's beam, not its own length. */
export function beamedStemEnd(group: BeamGroup, x: number): number {
  const line = group.lines[0]
  const span = line.x1 - line.x0
  if (span === 0) return line.y0
  return line.y0 + ((x - line.x0) / span) * (line.y1 - line.y0)
}

// ---------------------------------------------------------------------------
// The head of a line: clef, key, time
// ---------------------------------------------------------------------------

/** Order sharps and flats appear in a key signature, as diatonic step offsets. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]

export interface SignatureMark {
  /** Diatonic index to place it at. */
  index: number
  glyph: 'sharp' | 'flat'
}

/**
 * Where each accidental of a key signature sits.
 *
 * Sharps and flats have fixed orders and fixed octaves that differ per clef, and
 * the rule that produces them is: place each in the octave that keeps the whole
 * signature inside the staff, preferring the upper one for sharps.
 */
export function keySignatureMarks(key: KeyMark, clef: ClefMark): SignatureMark[] {
  const count = Math.min(7, Math.abs(key.fifths))
  if (count === 0) return []

  const sharps = key.fifths > 0
  const order = sharps ? SHARP_ORDER : FLAT_ORDER
  const middle = middleIndexFor(clef)
  // Top line of the staff, as a diatonic index.
  const top = middle + 4
  const bottom = middle - 4

  return Array.from({ length: count }, (_, i) => {
    const step = order[i]
    // Pick the octave whose placement lands inside the staff, one below the top
    // line for sharps and one above the bottom for flats — the usual look.
    const ceiling = sharps ? top : top - 1
    let index = step + Math.floor((ceiling - step) / 7) * 7
    while (index > ceiling) index -= 7
    while (index < bottom) index += 7
    return { index, glyph: sharps ? ('sharp' as const) : ('flat' as const) }
  })
}

export interface LineOpening {
  clef: ClefMark
  clefIndex: number
  signature: SignatureMark[]
  time: TimeSignature | null
}

/**
 * What stands at the head of a system, per staff.
 *
 * Clef and key are redrawn on every line as they are on paper. The time
 * signature appears only where it actually changes, which includes the first
 * line — matching the room engrave.ts reserved for it.
 */
export function lineOpening(score: Score, system: System, staff: number): LineOpening {
  const clef = clefAt(score, system.startBeat, staff)
  const key = keyAt(score, system.startBeat)
  const changesTime =
    system.index === 0 ||
    score.timeSignatures.some((t) => Math.abs(t.beat - system.startBeat) < 1e-3)

  return {
    clef,
    // A clef's origin sits on the line it names.
    clefIndex: CLEF_PITCH[clef.sign] + clef.octaveChange * 7,
    signature: keySignatureMarks(key, clef),
    time: changesTime ? timeSignatureAt(score, system.startBeat) : null,
  }
}
