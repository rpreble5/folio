/**
 * The hue wheel: where each note sits in colour space, and a way to move it.
 *
 * A circle rather than a strip because hue is cyclic — a linear spectrum lies
 * at its ends, showing red twice and implying that C and B are far apart when
 * they are neighbours on the wheel. The circle of fifths is also literally a
 * circle, so the musical structure and the colour space share a geometry, and
 * rotating the scheme is a real rotation rather than a metaphor.
 *
 * The ring is drawn at the current tone's own lightness and chroma, so it
 * previews the palette you are actually building rather than a generic rainbow.
 */

import { useRef, useState } from 'react'
import {
  type ColorConfig,
  baseHue,
  noteHue,
  normalizeHue,
  toneSample,
} from '../core/palettes'
import { oklch } from '../core/oklch'

const SIZE = 248
const C = SIZE / 2
const R_OUTER = 76
const R_INNER = 54
/**
 * Handles ride outside the ring, not on it.
 *
 * A handle sits at its own hue, so on the ring it is the same colour as the
 * band directly beneath and vanishes into it. Out here each one reads as a
 * distinct object against the panel, and the ring stays a clean reference.
 */
const R_HANDLE = 97
const R_LABEL = 118
const HANDLE_R = 9.5
/** Degrees per wedge. Small enough to read as continuous. */
const STEP = 4

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

/** Hue 0 at twelve o'clock, increasing clockwise. */
const toScreen = (hue: number): number => hue - 90

function polar(radius: number, hue: number): [number, number] {
  const a = (toScreen(hue) * Math.PI) / 180
  return [C + radius * Math.cos(a), C + radius * Math.sin(a)]
}

function wedgePath(hue: number, span: number): string {
  // A hair of overlap, or antialiasing leaves seams between the wedges.
  const a0 = toScreen(hue)
  const a1 = toScreen(hue + span + 0.7)
  const rad = (d: number) => (d * Math.PI) / 180
  const pt = (r: number, d: number): [number, number] => [
    C + r * Math.cos(rad(d)),
    C + r * Math.sin(rad(d)),
  ]
  const [x0, y0] = pt(R_OUTER, a0)
  const [x1, y1] = pt(R_OUTER, a1)
  const [x2, y2] = pt(R_INNER, a1)
  const [x3, y3] = pt(R_INNER, a0)
  return `M ${x0} ${y0} A ${R_OUTER} ${R_OUTER} 0 0 1 ${x1} ${y1} L ${x2} ${y2} A ${R_INNER} ${R_INNER} 0 0 0 ${x3} ${y3} Z`
}

/** Shortest signed distance from a to b, in (-180, 180]. */
function shortestDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

interface Props {
  config: ColorConfig
  colors: string[]
  surface: { background: string; text: string; muted: string }
  onShift: (pitchClass: number, degrees: number) => void
}

export function HueWheel({ config, colors, surface, onShift }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)

  const tone = toneSample(config.tone)
  const wedges: { hue: number; fill: string }[] = []
  for (let hue = 0; hue < 360; hue += STEP) {
    wedges.push({ hue, fill: oklch(tone.lightness, tone.chroma, hue) })
  }

  /** Convert a pointer position into the hue it points at. */
  const hueAt = (clientX: number, clientY: number): number | null => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * SIZE - C
    const y = ((clientY - rect.top) / rect.height) * SIZE - C
    if (Math.hypot(x, y) < 12) return null // dead zone at the centre
    return normalizeHue((Math.atan2(y, x) * 180) / Math.PI + 90)
  }

  const setFromPointer = (pc: number, clientX: number, clientY: number) => {
    const hue = hueAt(clientX, clientY)
    if (hue === null) return
    // Snap to whole degrees in fives; free-dragging to 0.3° precision is a
    // false affordance nobody can hit twice.
    const snapped = Math.round(hue / 5) * 5
    onShift(pc, shortestDelta(baseHue(config, pc), snapped))
  }

  return (
    <svg
      ref={svgRef}
      className="wheel"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="group"
      aria-label="Hue wheel — where each note sits in colour"
      onPointerMove={(e) => {
        if (dragging !== null) setFromPointer(dragging, e.clientX, e.clientY)
      }}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
    >
      <g className="wheel__ring">
        {wedges.map((w) => (
          <path key={w.hue} d={wedgePath(w.hue, STEP)} fill={w.fill} />
        ))}
      </g>

      {/* Spokes from the ring to each note, so a nudged note reads as moved
          rather than merely as sitting somewhere. */}
      {NAMES.map((_, pc) => {
        const hue = noteHue(config, pc)
        const [ix, iy] = polar(R_INNER + 2, hue)
        const [ox, oy] = polar(R_HANDLE - HANDLE_R - 1, hue)
        return (
          <line
            key={`spoke-${pc}`}
            x1={ix}
            y1={iy}
            x2={ox}
            y2={oy}
            stroke={surface.muted}
            strokeWidth={1}
            opacity={0.35}
          />
        )
      })}

      {NAMES.map((name, pc) => {
        const hue = noteHue(config, pc)
        const [hx, hy] = polar(R_HANDLE, hue)
        const [lx, ly] = polar(R_LABEL, hue)
        const active = dragging === pc || focused === pc
        const shifted = Math.round(config.hueShift?.[pc] ?? 0) !== 0

        return (
          <g key={pc}>
            <text
              x={lx}
              y={ly + 3.5}
              textAnchor="middle"
              fontSize={10}
              fontWeight={shifted ? 700 : 500}
              fill={shifted ? surface.text : surface.muted}
            >
              {name}
            </text>

            {focused === pc && (
              <circle
                cx={hx}
                cy={hy}
                r={HANDLE_R + 4.5}
                fill="none"
                stroke={surface.text}
                strokeWidth={1.5}
                pointerEvents="none"
              />
            )}

            <circle
              className="wheel__handle"
              cx={hx}
              cy={hy}
              r={active ? HANDLE_R + 2.5 : HANDLE_R}
              fill={colors[pc]}
              stroke={surface.background}
              strokeWidth={2.5}
              tabIndex={0}
              role="slider"
              aria-label={`${name} hue`}
              aria-valuemin={0}
              aria-valuemax={359}
              aria-valuenow={Math.round(hue)}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                e.preventDefault()
                setDragging(pc)
                svgRef.current?.setPointerCapture(e.pointerId)
              }}
              onFocus={() => setFocused(pc)}
              onBlur={() => setFocused(null)}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 15 : 5
                const current = config.hueShift?.[pc] ?? 0
                if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  onShift(pc, current - step)
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  onShift(pc, current + step)
                } else if (e.key === 'Backspace' || e.key === 'Delete') {
                  e.preventDefault()
                  onShift(pc, 0)
                }
              }}
            />
          </g>
        )
      })}
    </svg>
  )
}
