/**
 * Drawing a single note: a head, and a trail for its duration.
 *
 * Head and trail are two overlapping shapes in the same colour, so what you see
 * is their union. That is what lets the trail melt into any head — there is no
 * joint to compute between a triangle and a bar, only a silhouette where the
 * trail emerges from inside the head.
 *
 * It also removes a fork. A capsule used to fill its whole duration while a
 * notehead got a separate tail; those were two renderers. Now a capsule is a
 * head with a trail at full thickness and no taper, and the old look falls out
 * as a default.
 *
 * Shapes that carry meaning — a triangle for a sharp, a hexagon for the tonic —
 * are never stretched to fill a duration, because a stretched triangle stops
 * reading as a triangle and takes the channel with it.
 */

import type { ShapeKind } from '../core/palettes'
import type { TextureConfig, TrailConfig } from '../core/theme'
import { textureFill } from './textures'

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
  filled: boolean
  hollowTint: number
  trail: TrailConfig
  texture: TextureConfig
  trailGrain: boolean
}

/** Heads drawn at a fixed size, with the duration carried by the trail. */
const HEAD_SHAPES = new Set<ShapeKind>([
  'circle',
  'hexagon',
  'diamond',
  'triangleUp',
  'triangleDown',
  'chevron',
])

function headPath(shape: ShapeKind, x: number, y: number, size: number, radius: number): string {
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
    case 'circle':
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
    case 'capsule':
    case 'rect': {
      const rad = shape === 'capsule' ? r : Math.min(radius, r)
      return roundedRect(x, y, size, size, rad)
    }
  }
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return (
    `M ${x + rr} ${y} H ${x + w - rr} A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}` +
    ` V ${y + h - rr} A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}` +
    ` H ${x + rr} A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}` +
    ` V ${y + rr} A ${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`
  )
}

/**
 * The trail, as a single filled path.
 *
 * It starts at the head's centre rather than its edge, so its leading end is
 * hidden inside the head and the union has no seam whatever the head's outline.
 * The cubic control points sit far enough in to give the swell a soft shoulder
 * instead of a corner.
 */
function trailPath(
  x0: number,
  x1: number,
  cy: number,
  h0: number,
  h1: number,
  cap: 'round' | 'flat',
): string {
  const bend = Math.max(4, (x1 - x0) * 0.42)
  const top = `M ${x0} ${cy - h0} C ${x0 + bend} ${cy - h0} ${x1 - bend} ${cy - h1} ${x1} ${cy - h1}`
  const end =
    cap === 'round' && h1 > 0.4
      ? ` A ${h1} ${h1} 0 0 1 ${x1} ${cy + h1}`
      : ` L ${x1} ${cy + h1}`
  const bottom = ` C ${x1 - bend} ${cy + h1} ${x0 + bend} ${cy + h0} ${x0} ${cy + h0} Z`
  return top + end + bottom
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
  trail,
  texture,
  trailGrain,
}: Props) {
  const headSize = height
  const half = height / 2
  const cy = y + half
  const head = headPath(shape, x, y, headSize, cornerRadius)

  const thickness = Math.max(0, Math.min(1, trail.thickness))
  const h0 = half * (thickness + (1 - thickness) * trail.melt)
  const h1 = half * thickness * (1 - trail.taper)
  const trailEnd = x + Math.max(width, headSize)
  const trailStart = x + headSize / 2
  const hasTrail = trail.opacity > 0 && thickness > 0 && trailEnd - trailStart > 2

  const path = hasTrail ? trailPath(trailStart, trailEnd, cy, h0, h1, trail.cap) : ''
  const pattern = textureFill(texture)

  const shapeFill = filled ? fill : 'none'
  const shapeFillOpacity = filled ? 1 : hollowTint
  const common = {
    fill: !filled && hollowTint > 0 ? fill : shapeFill,
    fillOpacity: shapeFillOpacity,
    stroke: strokeWidth > 0 ? stroke : 'none',
    strokeWidth,
  }

  return (
    <g
      className={active ? 'note note--active' : 'note'}
      opacity={opacity}
      style={selected ? { filter: `drop-shadow(0 0 0 2px ${accent})` } : undefined}
    >
      {/* Trail first, so the head sits over the shoulder of the swell. */}
      {hasTrail && (
        <>
          <path d={path} {...common} opacity={trail.opacity} />
          {pattern && (
            <path
              d={path}
              fill={pattern}
              opacity={trail.opacity * texture.strength}
              mask={trailGrain ? 'url(#trail-ramp)' : undefined}
            />
          )}
        </>
      )}

      <path d={head} {...common} />
      {pattern && <path d={head} fill={pattern} opacity={texture.strength} />}

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

export { HEAD_SHAPES }
