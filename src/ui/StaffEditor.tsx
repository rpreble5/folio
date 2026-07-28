/**
 * Direct manipulation of the staff.
 *
 * Ten lines and nine spaces, each independently styleable, is eighteen things —
 * far too many to lay out as rows of sliders. So the staff itself is the
 * control: click the line or the space you want, and edit that one. The
 * miniature also previews what you are building, which a list never could.
 *
 * The picker and the editor are separate exports, and selection is owned by
 * whoever renders them. Stacking the two in one column is what made Staff the
 * last tab that scrolled — four hundred pixels beside neighbours at a hundred
 * and sixty. Side by side they both fit, and there is room for colour too.
 */

import {
  DASH_KINDS,
  STAFF_LINE_NAMES,
  TEXTURE_KINDS,
  dashArray,
  lineColor,
  staffLineStyle,
  type DashKind,
  type LineStyle,
  type SpaceStyle,
  type StaffStyle,
  type Surface,
  type TextureKind,
} from '../core/theme'
import { Field, Pills, Range, Swatches, Switch } from './controls'

const W = 188
const PAD = 10
const GAP = 13 // between adjacent lines within a staff
const MID = 26 // the gap that holds middle C

/** Line y positions, top (F5) down to bottom (G2). */
function lineYs(): number[] {
  const ys: number[] = []
  let y = PAD
  for (let i = 0; i < 10; i++) {
    ys.push(y)
    y += i === 4 ? MID : GAP
  }
  return ys
}

const YS = lineYs()
const HEIGHT = YS[9] + PAD

/** Index 0 is the bottom line, so the drawing order is reversed. */
const yOfLine = (index: number): number => YS[9 - index]

export type Selection = { kind: 'line' | 'space'; index: number }

export const selectionName = (sel: Selection): string =>
  sel.kind === 'line'
    ? `Line ${sel.index + 1} · ${STAFF_LINE_NAMES[sel.index]}`
    : sel.index === 4
      ? 'Space · middle C'
      : `Space ${sel.index + 1}`

/**
 * An unset space is off, not on. Defaulting to '@auto' made the toggle read as
 * enabled while nothing was actually drawn, because the renderer skips spaces
 * with no stored entry — a control that lied about its own state.
 */
const DEFAULT_SPACE: SpaceStyle = { fill: '@none', opacity: 0.14, texture: 'none' }

/**
 * The colours offered for a line or a shaded space.
 *
 * Four neutrals the page derives, then the palette's own hues — which are
 * already on this page, and so the ones that will agree with it. A line in a
 * colour borrowed from nowhere is the fastest way to make a considered palette
 * look accidental.
 */
export function lineSwatches(
  surface: Surface,
  palette: string[],
): { value: string; color: string; label: string }[] {
  return [
    { value: '@auto', color: surface.staffLine, label: 'Follow the page' },
    { value: surface.grid, color: surface.grid, label: 'Faint' },
    { value: surface.gridStrong, color: surface.gridStrong, label: 'Medium' },
    { value: surface.muted, color: surface.muted, label: 'Strong' },
    { value: surface.text, color: surface.text, label: 'Ink' },
    ...palette
      .filter((c) => c.startsWith('#'))
      .filter((_, i) => i % 2 === 0)
      .slice(0, 6)
      .map((c) => ({ value: c, color: c, label: 'Palette colour' })),
  ]
}

// ---------------------------------------------------------------------------

export function StaffPicker({
  staff,
  base,
  surface,
  selected,
  onSelect,
}: {
  staff: StaffStyle
  base: LineStyle
  surface: Surface
  selected: Selection
  onSelect: (sel: Selection) => void
}) {
  return (
    <svg
      className="staff-mini"
      width={W}
      height={HEIGHT}
      viewBox={`0 0 ${W} ${HEIGHT}`}
      role="group"
      aria-label="Staff lines and spaces"
    >
      {/* Spaces first — they sit behind the lines that bound them. */}
      {Array.from({ length: 9 }, (_, i) => {
        const top = yOfLine(i + 1)
        const bottom = yOfLine(i)
        const space = staff.spaces[i]
        const on = space && space.fill !== '@none'
        const active = selected.kind === 'space' && selected.index === i
        return (
          <rect
            key={`s${i}`}
            x={0}
            y={top}
            width={W}
            height={bottom - top}
            fill={on ? (space.fill === '@auto' ? surface.gridStrong : space.fill) : 'transparent'}
            fillOpacity={on ? space.opacity : 0}
            stroke={active ? surface.text : 'transparent'}
            strokeWidth={active ? 1 : 0}
            strokeDasharray="2 2"
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect({ kind: 'space', index: i })}
          />
        )
      })}

      {Array.from({ length: 10 }, (_, i) => {
        const style = staffLineStyle(staff, i, base)
        const y = yOfLine(i)
        const active = selected.kind === 'line' && selected.index === i
        return (
          <g key={`l${i}`} onClick={() => onSelect({ kind: 'line', index: i })}>
            {/* A generous invisible hit area — a 1px line is unclickable. */}
            <rect
              x={0}
              y={y - 5}
              width={W}
              height={10}
              fill="transparent"
              style={{ cursor: 'pointer' }}
            />
            <line
              x1={4}
              x2={W - 4}
              y1={y}
              y2={y}
              stroke={style.show ? lineColor(style, 'staff', surface) : surface.grid}
              strokeWidth={style.show ? Math.max(0.8, style.width) : 1}
              strokeDasharray={style.show ? dashArray(style.dash, style.width) : '1 3'}
              opacity={style.show ? style.opacity : 0.4}
              pointerEvents="none"
            />
            {active && (
              <circle cx={W - 1} cy={y} r={2.5} fill={surface.text} pointerEvents="none" />
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------

/** The controls for whichever line or space is picked. */
export function StaffItemEditor({
  staff,
  base,
  swatches,
  selected,
  onChange,
}: {
  staff: StaffStyle
  base: LineStyle
  swatches: { value: string; color: string; label: string }[]
  selected: Selection
  onChange: (staff: StaffStyle) => void
}) {
  const patchLine = (index: number, patch: Partial<LineStyle>) =>
    onChange({ ...staff, lines: { ...staff.lines, [index]: { ...staff.lines[index], ...patch } } })

  const patchSpace = (index: number, patch: Partial<SpaceStyle>) =>
    onChange({
      ...staff,
      spaces: { ...staff.spaces, [index]: { ...DEFAULT_SPACE, ...staff.spaces[index], ...patch } },
    })

  if (selected.kind === 'space') {
    const space = staff.spaces[selected.index] ?? DEFAULT_SPACE
    return (
      <>
        <Switch
          label="Shade this space"
          checked={space.fill !== '@none'}
          onChange={(on) => patchSpace(selected.index, { fill: on ? '@auto' : '@none' })}
        />
        {space.fill !== '@none' && (
          <>
            <Swatches
              value={space.fill}
              options={swatches}
              onChange={(fill) => patchSpace(selected.index, { fill })}
            />
            <Range
              name="Strength"
              display={`${Math.round(space.opacity * 100)}%`}
              min={0.02}
              max={0.6}
              step={0.02}
              value={space.opacity}
              onChange={(opacity) => patchSpace(selected.index, { opacity })}
            />
            <Field name="Texture">
              <Pills
                options={TEXTURE_KINDS.map((t) => ({ value: t.id, label: t.label }))}
                value={space.texture}
                onChange={(texture: TextureKind) => patchSpace(selected.index, { texture })}
              />
            </Field>
          </>
        )}
      </>
    )
  }

  const line = staffLineStyle(staff, selected.index, base)
  const overridden = staff.lines[selected.index] ?? {}
  const hasOverride = Object.keys(overridden).length > 0

  return (
    <>
      <Switch
        label="Show this line"
        checked={line.show}
        onChange={(show) => patchLine(selected.index, { show })}
      />
      {line.show && (
        <>
          <Swatches
            value={line.color}
            options={swatches}
            onChange={(color) => patchLine(selected.index, { color })}
          />
          <Pills
            options={DASH_KINDS.map((d) => ({ value: d.id, label: d.label }))}
            value={line.dash}
            onChange={(dash: DashKind) => patchLine(selected.index, { dash })}
          />
          <Range
            name="Weight"
            display={line.width.toFixed(1)}
            min={0.5}
            max={5}
            step={0.25}
            value={line.width}
            onChange={(width) => patchLine(selected.index, { width })}
          />
          <Range
            name="Strength"
            display={`${Math.round(line.opacity * 100)}%`}
            min={0.1}
            max={1}
            step={0.05}
            value={line.opacity}
            onChange={(opacity) => patchLine(selected.index, { opacity })}
          />
        </>
      )}
      {/* Only offered once there is something to give back — a line with no
          override of its own is already following the whole staff. */}
      {hasOverride && (
        <button
          className="pill pill--solid"
          onClick={() => {
            const next = { ...staff.lines }
            delete next[selected.index]
            onChange({ ...staff, lines: next })
          }}
        >
          Match the rest
        </button>
      )}
    </>
  )
}
