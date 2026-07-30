/**
 * Traditional notation, drawn over a system that engrave.ts has already placed.
 *
 * A separate layer rather than part of the note glyph, for one reason: a stem
 * belongs to a *column*, not to a note. Two notes a third apart share one stem;
 * six notes share one beam; a chord's accidentals have to be stacked against each
 * other. None of that can be decided while looking at a single note, which is
 * where NoteGlyph works.
 *
 * Everything here reads from the theme's NotationConfig, so every piece can be
 * turned off independently and the page degrades toward the redesigned view one
 * step at a time rather than in one jump.
 */

import type { Score } from '../core/types'
import type { NotationConfig, Surface } from '../core/theme'
import { diatonicIndex } from '../core/pitch'
import type { PlacedNote, System } from './layout'
import {
  beamGroups,
  beamedStemEnd,
  clustersOf,
  clusterUp,
  flagFor,
  HEAD_WIDTH,
  layoutHeads,
  leftEdgeOf,
  snapStroke,
  stackAccidentals,
  isHollow,
  lineOpening,
  middleIndexFor,
  stemForCluster,
  writtenTypeOf,
} from './notation'
import {
  ACCIDENTAL_GLYPHS,
  CLEF_GLYPHS,
  DIGIT_GLYPHS,
  FLAG_GLYPHS,
  HEAD_GLYPHS,
  MARK_GLYPHS,
  REST_GLYPHS,
  type Glyph,
} from './glyphs'
import type { ReactNode } from 'react'

interface Props {
  score: Score
  system: System
  notation: NotationConfig
  /** Pixels per staff space. Two diatonic steps make one space. */
  space: number
  gutter: number
  /** Diatonic index → y within the system. */
  yFor: (index: number) => number
  noteHeight: number
  surface: Surface
  /** Which staves the score actually uses, so a line opening is drawn per staff. */
  staves: number[]
}

/**
 * One glyph, scaled from staff spaces to pixels and moved to where it attaches.
 *
 * The glyph's own origin is its attachment point, so this is a translate and a
 * uniform scale and nothing else — no bounding-box arithmetic, which is what
 * keeps the alignment exact rather than approximately right.
 */
function GlyphMark({
  glyph,
  x,
  y,
  space,
  fill,
  opacity,
}: {
  glyph: Glyph
  x: number
  y: number
  space: number
  fill: string
  opacity?: number
}) {
  return (
    <path
      d={glyph.path}
      transform={`translate(${x}, ${y}) scale(${space})`}
      fill={fill}
      fillOpacity={opacity}
      pointerEvents="none"
    />
  )
}

/** Air between the accidental stack and the chord's leftmost head, in spaces. */
const ACCIDENTAL_GAP = 0.28

/** Accidental names the file may print, mapped to the glyphs we carry. */
const ACCIDENTAL_KEYS: Record<string, string> = {
  sharp: 'sharp',
  flat: 'flat',
  natural: 'natural',
  'double-sharp': 'double-sharp',
  'sharp-sharp': 'sharp-sharp',
  'flat-flat': 'flat-flat',
}

export function NotationLayer({
  score,
  system,
  notation,
  space,
  gutter,
  yFor,
  noteHeight,
  surface,
  staves,
}: Props) {
  const headWidth = space * HEAD_WIDTH
  const weight = notation.weight * space
  const beamWeight = notation.beamWeight * space
  const ink = surface.text

  // A middle line per staff, since stem direction and rest placement are both
  // relative to the staff a note sits on, not to the whole grand staff.
  const middleFor = (staff: number) =>
    middleIndexFor(
      score.clefs?.find((c) => c.staff === staff) ??
        (staff >= 2
          ? { beat: 0, staff, sign: 'F' as const, line: 4, octaveChange: 0 }
          : { beat: 0, staff, sign: 'G' as const, line: 2, octaveChange: 0 }),
    )

  const staffOf = (placed: PlacedNote) => (placed.note.hand === 'left' ? 2 : 1)

  const clusters = clustersOf(system, staffOf)
  const { groups, beamed } = notation.beams
    ? beamGroups(clusters, middleFor, space, headWidth, beamWeight)
    : { groups: [], beamed: new Set<string>() }

  const colorOf = (placed: PlacedNote) =>
    notation.inkFollowsNote ? placed.style.fill : ink

  return (
    <g className="notation" transform={`translate(${gutter}, 0)`} opacity={notation.opacity}>
      {/* --- The head of the line: clef, key, time ------------------------- */}
      {staves.map((staff) => {
        const opening = lineOpening(score, system, staff)
        const clefGlyph = CLEF_GLYPHS[opening.clef.sign]
        let cursor = space * 0.6

        const marks: ReactNode[] = []

        if (notation.clef && clefGlyph) {
          marks.push(
            <GlyphMark
              key={`clef-${staff}`}
              glyph={clefGlyph}
              x={cursor}
              y={yFor(opening.clefIndex) + noteHeight / 2}
              space={space}
              fill={ink}
            />,
          )
          cursor += (clefGlyph.width + 0.9) * space
        }

        if (notation.keySignature) {
          for (const [i, mark] of opening.signature.entries()) {
            const glyph = ACCIDENTAL_GLYPHS[mark.glyph]
            if (!glyph) continue
            marks.push(
              <GlyphMark
                key={`sig-${staff}-${i}`}
                glyph={glyph}
                x={cursor}
                y={yFor(mark.index) + noteHeight / 2}
                space={space}
                fill={ink}
              />,
            )
            cursor += glyph.width * space * 1.06
          }
          if (opening.signature.length) cursor += space * 0.5
        }

        if (notation.timeSignature && opening.time) {
          // Numerator and denominator sit on the second and fourth staff spaces,
          // and are centred on a *shared* axis — a 12 over a 8 has to line up on
          // its middle, not on its left edge.
          const middle = middleFor(staff)
          const rows = [
            { index: middle + 2, digits: String(opening.time.numerator).split('') },
            { index: middle - 2, digits: String(opening.time.denominator).split('') },
          ]
          const widthOf = (digits: string[]) =>
            digits.reduce((w, d) => w + (DIGIT_GLYPHS[d]?.width ?? 0), 0)
          const column = Math.max(...rows.map((r) => widthOf(r.digits)))

          for (const row of rows) {
            let dx = cursor + ((column - widthOf(row.digits)) / 2) * space
            for (const [i, d] of row.digits.entries()) {
              const glyph = DIGIT_GLYPHS[d]
              if (!glyph) continue
              marks.push(
                <GlyphMark
                  key={`time-${staff}-${row.index}-${i}`}
                  glyph={glyph}
                  x={dx}
                  y={yFor(row.index) + noteHeight / 2}
                  space={space}
                  fill={ink}
                />,
              )
              dx += glyph.width * space
            }
          }
          cursor += (column + 0.6) * space
        }

        return <g key={`opening-${staff}`}>{marks}</g>
      })}

      {/* --- Rests -------------------------------------------------------- */}
      {notation.rests &&
        (system.rests ?? []).map((placed) => {
          const type = placed.rest.wholeBar
            ? 'whole'
            : (placed.rest.notated?.segments[0]?.type ?? 'quarter')
          const glyph = REST_GLYPHS[type]
          if (!glyph) return null
          return (
            <g key={placed.rest.id}>
              <GlyphMark glyph={glyph} x={placed.x} y={placed.y} space={space} fill={ink} />
              {notation.dots &&
                Array.from({ length: placed.rest.notated?.segments[0]?.dots ?? 0 }, (_, i) => (
                  <GlyphMark
                    key={`rd-${i}`}
                    glyph={MARK_GLYPHS.dot}
                    x={placed.x + (glyph.width + 0.4 + i * 0.45) * space}
                    y={placed.y - space * 0.5}
                    space={space}
                    fill={ink}
                  />
                ))}
            </g>
          )
        })}

      {/* --- Beams -------------------------------------------------------- */}
      {notation.beams &&
        groups.map((group, gi) => (
          <g key={`beam-${gi}`}>
            {group.lines.map((line, li) => (
              <path
                key={li}
                d={
                  `M ${line.x0} ${line.y0}` +
                  ` L ${line.x1} ${line.y1}` +
                  ` L ${line.x1} ${line.y1 + (group.up ? beamWeight : -beamWeight)}` +
                  ` L ${line.x0} ${line.y0 + (group.up ? beamWeight : -beamWeight)} Z`
                }
                fill={notation.inkFollowsNote ? group.notes[0].style.fill : ink}
              />
            ))}
          </g>
        ))}

      {/* --- Stems and flags, one per chord ------------------------------- */}
      {clusters.map((cluster) => {
        const middle = middleFor(cluster.staff)
        const stem = notation.stems ? stemForCluster(cluster, middle, space, headWidth) : null
        if (!stem) return null

        const group = groups.find((g) =>
          g.notes.some((n) => n.note.id === cluster.notes[0].note.id),
        )
        // A beamed chord's stem ends on its beam, not at its own length. If the
        // group overruled this chord's direction, the stem also has to move to
        // the other side of the head to stay attached.
        const up = group ? group.up : stem.up
        const flipped = group !== undefined && group.up !== stem.up
        const edge = headWidth / 2 - space * 0.06
        const root = flipped
          ? cluster.notes.reduce(
              (a, p) => (up ? (p.y > a.y ? p : a) : p.y < a.y ? p : a),
              cluster.notes[0],
            )
          : null
        const x = snapStroke(root ? root.x + root.width / 2 + (up ? edge : -edge) : stem.x)
        const y0 = root ? root.y + root.height / 2 : stem.y0
        const y1 = group ? beamedStemEnd(group, x) : stem.y1

        const colour = colorOf(cluster.notes[0])
        const flag =
          notation.flags && !beamed.has(cluster.notes[0].note.id)
            ? flagFor(cluster, { x, y0, y1, up })
            : null

        return (
          <g key={`stem-${cluster.staff}-${cluster.voice}-${cluster.onset}`} pointerEvents="none">
            <line x1={x} x2={x} y1={y0} y2={y1} stroke={colour} strokeWidth={weight} />
            {flag && FLAG_GLYPHS[flag.glyph] && (
              <GlyphMark
                glyph={FLAG_GLYPHS[flag.glyph]}
                // Flags attach to the stem's outer edge, so the stem's own width
                // comes off or the flag floats a hairline clear of it.
                x={flag.x - (up ? weight / 2 : -weight / 2)}
                y={flag.y}
                space={space}
                fill={colour}
              />
            )}
          </g>
        )
      })}

      {/* --- Accidentals, stacked per chord ------------------------------- */}
      {notation.accidentals &&
        clusters.map((cluster) => {
          const up = clusterUp(cluster, middleFor(cluster.staff))
          const heads = layoutHeads(cluster, up, headWidth, weight)

          const entries = cluster.notes.flatMap((placed) => {
            const name = placed.note.notated?.accidental
            const glyph = name ? ACCIDENTAL_GLYPHS[ACCIDENTAL_KEYS[name] ?? ''] : undefined
            if (!glyph || !name) return []
            return [{
              noteId: placed.note.id,
              y: placed.y + placed.height / 2,
              box: {
                glyph: ACCIDENTAL_KEYS[name],
                width: glyph.width,
                top: glyph.top,
                bottom: glyph.bottom,
              },
            }]
          })
          if (entries.length === 0) return null

          // The stack starts left of the chord's leftmost ink, which a displaced
          // head can push further left than the chord's own x.
          const start = leftEdgeOf(heads) - ACCIDENTAL_GAP * space
          const { marks } = stackAccidentals(entries, space, start)
          const x0 = cluster.notes[0].x

          return (
            <g key={`acc-${cluster.staff}-${cluster.voice}-${cluster.onset}`} pointerEvents="none">
              {marks.map((mark) => {
                const glyph = ACCIDENTAL_GLYPHS[mark.glyph]
                const owner = cluster.notes.find((p) => p.note.id === mark.noteId)
                if (!glyph || !owner) return null
                return (
                  <GlyphMark
                    key={mark.noteId}
                    glyph={glyph}
                    x={x0 + mark.dx}
                    y={mark.y}
                    space={space}
                    fill={colorOf(owner)}
                  />
                )
              })}
            </g>
          )
        })}

      {/* --- Dots, one per note ------------------------------------------- */}
      {notation.dots &&
        system.notes.map((placed) => {
          const middle = middleFor(staffOf(placed))
          const { dots } = writtenTypeOf(placed.note)
          if (dots === 0) return null
          const cy = placed.y + placed.height / 2
          return (
            <g key={`dot-${placed.note.id}`} pointerEvents="none">
              {Array.from({ length: dots }, (_, i) => (
                <GlyphMark
                  key={i}
                  glyph={MARK_GLYPHS.dot}
                  x={placed.x + (placed.dx ?? 0) + placed.width + (0.3 + i * 0.45) * space}
                  // A dot never sits on a line: on one, it moves up a half space.
                  y={onLine(placed, middle) ? cy - space * 0.5 : cy}
                  space={space}
                  fill={colorOf(placed)}
                />
              ))}
            </g>
          )
        })}
    </g>
  )
}

/** True when a note's head is centred on a staff line rather than in a space. */
function onLine(placed: PlacedNote, middleIndex: number): boolean {
  return (diatonicIndex(placed.note.spelling) - middleIndex) % 2 === 0
}

/** Which authentic notehead a written value takes. */
export function headGlyphFor(placed: PlacedNote): Glyph | undefined {
  const { type } = writtenTypeOf(placed.note)
  if (type === 'breve') return HEAD_GLYPHS.breve
  if (type === 'whole') return HEAD_GLYPHS.whole
  if (isHollow(type)) return HEAD_GLYPHS.half
  return HEAD_GLYPHS.black
}
