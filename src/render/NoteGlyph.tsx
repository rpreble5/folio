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
import { BLACK_KEY_SQUEEZE, HEAD_SHAPES, customTransform, headPath } from './shapes'

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
  /** The trail's own colour, when it encodes something the head does not. */
  trailFill?: string
  /** 0 to 1: how far the trail fades toward the page by its end. */
  trailFade?: number
  /** The reader's own head, for the 'custom' shape. */
  customShape?: string
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
  trailFill,
  trailFade = 0,
  customShape,
}: Props) {
  const headSize = height
  const half = height / 2
  const cy = y + half
  const head = headPath(shape, x, y, headSize, cornerRadius, customShape)
  // A custom path lives in a 100-unit box and is scaled into place; every
  // other head is built at its real size.
  const headTransform = shape === 'custom' ? customTransform(x, y, headSize) : undefined

  // A black key on the Keys shapes is shorter than its neighbours, trail and
  // all — that is what makes it read as the narrow key it is.
  const squeeze = shape === 'keyBlack' ? BLACK_KEY_SQUEEZE : 1
  const thickness = Math.max(0, Math.min(1, trail.thickness))
  const h0 = half * (thickness + (1 - thickness) * trail.melt) * squeeze
  const h1 = half * thickness * (1 - trail.taper) * squeeze
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
  // The trail may wear its own colour; a hollow note's trail stays hollow in
  // that colour, and its outline follows suit so the two halves agree.
  const trailInk = trailFill ?? fill
  const trailCommon = {
    ...common,
    fill: !filled && hollowTint > 0 ? trailInk : filled ? trailInk : 'none',
    stroke: strokeWidth > 0 ? (trailFill ? trailInk : stroke) : 'none',
  }

  return (
    <g
      className={active ? 'note note--active' : 'note'}
      opacity={opacity}
      style={selected ? { filter: `drop-shadow(0 0 0 2px ${accent})` } : undefined}
    >
      {/* Trail first, so the head sits over the shoulder of the swell. The
          fade is a shared mask in the trail's own box, so one definition
          serves every note and the head — drawn after — stays solid. */}
      {hasTrail && (
        <>
          <path
            d={path}
            {...trailCommon}
            opacity={trail.opacity}
            mask={trailFade > 0 ? 'url(#trail-fade)' : undefined}
          />
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

      <path
        d={head}
        {...common}
        transform={headTransform}
        vectorEffect={headTransform ? 'non-scaling-stroke' : undefined}
      />
      {pattern && (
        <path d={head} fill={pattern} opacity={texture.strength} transform={headTransform} />
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

export { HEAD_SHAPES }
export type { ShapeKind }
