/**
 * Drawing a single note.
 *
 * Shapes that carry meaning (a triangle for a sharp, a hexagon for the tonic)
 * are drawn as a fixed-size *head* plus a *tail* that runs the note's duration,
 * rather than stretching the shape itself. A stretched triangle stops reading
 * as a triangle, which would quietly destroy the very channel the shape was
 * chosen to provide. Capsules and rectangles have no such problem, so they fill
 * the whole span.
 */

import type { ShapeKind } from '../core/palettes'

interface Props {
  x: number
  y: number
  width: number
  height: number
  shape: ShapeKind
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
  cornerRadius: number
  active: boolean
  selected: boolean
  accent: string
  /** False draws the note hollow, its colour moved into the outline. */
  filled: boolean
  /** Fill tint kept behind a hollow note, 0 for a true outline. */
  hollowTint: number
}

const HEAD_SHAPES = new Set<ShapeKind>([
  'circle',
  'hexagon',
  'diamond',
  'triangleUp',
  'triangleDown',
  'chevron',
])

function headPath(shape: ShapeKind, x: number, y: number, size: number): string {
  const cx = x + size / 2
  const cy = y + size / 2
  const r = size / 2

  switch (shape) {
    case 'diamond':
      return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`
    case 'triangleUp':
      return `M ${cx} ${cy - r} L ${cx + r} ${cy + r * 0.8} L ${cx - r} ${cy + r * 0.8} Z`
    case 'triangleDown':
      return `M ${cx} ${cy + r} L ${cx + r} ${cy - r * 0.8} L ${cx - r} ${cy - r * 0.8} Z`
    case 'chevron':
      return `M ${cx - r} ${cy - r} L ${cx + r * 0.35} ${cy - r} L ${cx + r} ${cy} L ${cx + r * 0.35} ${cy + r} L ${cx - r} ${cy + r} L ${cx - r * 0.3} ${cy} Z`
    case 'hexagon': {
      const w = r * 0.55
      return `M ${cx - w} ${cy - r} L ${cx + w} ${cy - r} L ${cx + r} ${cy} L ${cx + w} ${cy + r} L ${cx - w} ${cy + r} L ${cx - r} ${cy} Z`
    }
    default:
      return ''
  }
}

export function NoteGlyph({
  x,
  y,
  width,
  height,
  shape,
  fill,
  stroke,
  strokeWidth,
  opacity,
  cornerRadius,
  active,
  selected,
  accent,
  filled,
  hollowTint,
}: Props) {
  const usesHead = HEAD_SHAPES.has(shape)
  const headSize = height
  const tailHeight = Math.max(3, height * 0.34)
  const tailStart = x + headSize * 0.72
  const tailWidth = Math.max(0, width - headSize * 0.72)

  const common = {
    fill: filled ? fill : 'none',
    // A hollow note keeps a faint wash of its own colour when tinted, which
    // stops thin outlines from disappearing against a busy page.
    fillOpacity: filled ? 1 : hollowTint,
    stroke: strokeWidth > 0 ? stroke : 'none',
    strokeWidth,
    opacity,
  }

  // fill:'none' cannot be tinted, so a tinted hollow note keeps its colour and
  // leans on fillOpacity instead.
  if (!filled && hollowTint > 0) common.fill = fill

  return (
    <g
      className={active ? 'note note--active' : 'note'}
      style={selected ? { filter: `drop-shadow(0 0 0 2px ${accent})` } : undefined}
    >
      {usesHead && tailWidth > 2 && (
        <rect
          x={tailStart}
          y={y + height / 2 - tailHeight / 2}
          width={tailWidth}
          height={tailHeight}
          rx={tailHeight / 2}
          fill={fill}
          // The tail is already a faint version of the note, so a hollow note
          // fades it further rather than outlining it — an outlined hairline
          // would read as noise.
          opacity={opacity * (filled ? 0.45 : 0.24)}
        />
      )}

      {shape === 'circle' && (
        <ellipse
          cx={x + headSize / 2}
          cy={y + height / 2}
          rx={headSize / 2}
          ry={height / 2}
          {...common}
        />
      )}

      {usesHead && shape !== 'circle' && (
        <path d={headPath(shape, x, y, headSize)} {...common} />
      )}

      {!usesHead && (
        <rect
          x={x}
          y={y}
          width={Math.max(width, 4)}
          height={height}
          rx={shape === 'capsule' ? height / 2 : cornerRadius}
          {...common}
        />
      )}

      {selected && (
        <rect
          x={x - 3}
          y={y - 3}
          width={Math.max(width, headSize) + 6}
          height={height + 6}
          rx={(height + 6) / 2}
          fill="none"
          stroke={accent}
          strokeWidth={2}
          className="note__selection"
        />
      )}
    </g>
  )
}
