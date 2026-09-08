/**
 * The geometry of a notehead, in one place.
 *
 * Every shape the app can draw is a path built here, so the score, the tiles
 * in the Studio and the swatches in the popover all agree about what a star
 * is. A shape that existed in two copies was a shape that could drift.
 *
 * Paths are built at a given box rather than scaled from a unit path, so the
 * stroke of a hollow head is the same weight on every shape. The exception is
 * the reader's own path, which is drawn in a 100-unit box and scaled — the
 * only way to take arbitrary geometry — with a non-scaling stroke to keep the
 * outline honest.
 */

import type { ShapeKind } from '../core/palettes'

/** Heads drawn at a fixed size, with the duration carried by the trail. */
export const HEAD_SHAPES = new Set<ShapeKind>([
  'circle',
  'oval',
  'hexagon',
  'diamond',
  'triangleUp',
  'triangleDown',
  'chevron',
  'star',
  'teardrop',
  'pentagon',
  'custom',
])

/** Degrees. Engraved noteheads sit around twenty; more reads as a slash. */
const OVAL_TILT = -21

/** How much shorter a black-key head and trail are than a white key's. */
export const BLACK_KEY_SQUEEZE = 0.66

/** The reader's shape until they paste one: a rounded diamond. */
export const DEFAULT_CUSTOM_SHAPE =
  'M 50 4 C 62 22 78 38 96 50 C 78 62 62 78 50 96 C 38 78 22 62 4 50 C 22 38 38 22 50 4 Z'

export function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return (
    `M ${x + rr} ${y} H ${x + w - rr} A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}` +
    ` V ${y + h - rr} A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}` +
    ` H ${x + rr} A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}` +
    ` V ${y + rr} A ${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`
  )
}

/** A regular polygon or star, point-up, inside the box. */
function radial(cx: number, cy: number, r: number, points: number, inner?: number): string {
  const out: string[] = []
  const steps = inner === undefined ? points : points * 2
  for (let i = 0; i < steps; i += 1) {
    const radius = inner !== undefined && i % 2 === 1 ? inner : r
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps
    out.push(`${i === 0 ? 'M' : 'L'} ${cx + radius * Math.cos(a)} ${cy + radius * Math.sin(a)}`)
  }
  return out.join(' ') + ' Z'
}

/**
 * The head's path inside the box (x, y, size, size).
 *
 * `custom` is the reader's own path; it is returned as given, and the caller
 * scales it from its 100-unit box — see `customTransform`.
 */
export function headPath(
  shape: ShapeKind,
  x: number,
  y: number,
  size: number,
  radius: number,
  custom?: string,
): string {
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
    case 'pentagon':
      return radial(cx, cy, r, 5)
    case 'star':
      return radial(cx, cy, r, 5, r * 0.46)
    case 'teardrop':
      // Round at the back, pointed toward the trail: a head that says which
      // way the music is going.
      return (
        `M ${cx - r * 0.15} ${cy - r} A ${r * 0.85} ${r} 0 1 0 ${cx - r * 0.15} ${cy + r}` +
        ` L ${cx + r} ${cy} Z`
      )
    case 'circle':
      return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
    case 'oval': {
      /*
       * A traditional notehead: an ellipse about 1.4 times wider than tall,
       * tilted so its long axis rises to the right. The tilt is not decoration
       * — it is what stops two heads a second apart from overlapping, and it is
       * the thing that makes the shape read as a notehead rather than a dot.
       *
       * Drawn as two arcs using the arc command's own x-axis-rotation, so the
       * rotation lives in the path data and no wrapping transform is needed.
       */
      const rx = r * 1.24
      const ry = r * 0.86
      const rad = (OVAL_TILT * Math.PI) / 180
      const dx = rx * Math.cos(rad)
      const dy = rx * Math.sin(rad)
      return (
        `M ${cx - dx} ${cy - dy}` +
        ` A ${rx} ${ry} ${OVAL_TILT} 1 1 ${cx + dx} ${cy + dy}` +
        ` A ${rx} ${ry} ${OVAL_TILT} 1 1 ${cx - dx} ${cy - dy} Z`
      )
    }
    case 'keyWhite':
      return roundedRect(x, y, size, size, Math.min(2.5, r))
    case 'keyBlack': {
      // A black key: shorter, and squared off — the shape a keyboard gives it.
      const inset = (size * (1 - BLACK_KEY_SQUEEZE)) / 2
      return roundedRect(x, y + inset, size, size - inset * 2, Math.min(1.5, r))
    }
    case 'custom':
      return custom ?? DEFAULT_CUSTOM_SHAPE
    case 'capsule':
    case 'rect': {
      const rad = shape === 'capsule' ? r : Math.min(radius, r)
      return roundedRect(x, y, size, size, rad)
    }
  }
}

/** The transform that puts a 100-unit custom path into the head's box. */
export const customTransform = (x: number, y: number, size: number): string =>
  `translate(${x} ${y}) scale(${size / 100})`
