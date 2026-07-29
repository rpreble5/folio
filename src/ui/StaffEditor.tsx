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

import { useState, type ReactNode } from 'react'
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

/*
 * Geometry.
 *
 * The gaps are wider than a real staff's because both the lines and the spaces
 * between them have to be clickable. At the previous 13px spacing a ±5px line
 * band left three pixels of space between two of them, which is not a target —
 * so a space could only be reached by luck. At 18 a line band gets eight pixels
 * and the space between gets ten, and both are comfortable.
 */
const W = 210
const GUTTER = 27 // where the line names sit
const PAD_X = 9
const PAD_Y = 13
const GAP = 18 // between adjacent lines within a staff
const MID = 34 // the wider gap that holds middle C
const LINE_BAND = 8
const NAME_SIZE = 8.5

/**
 * Line y positions, top (F5) down to bottom (G2).
 *
 * The half pixel matters: a one-pixel line centred on a whole coordinate covers
 * half of each neighbouring device pixel and renders as two grey rows instead of
 * one crisp one. Most of the jankiness of the old miniature was this.
 */
function lineYs(): number[] {
  const ys: number[] = []
  let y = PAD_Y + 0.5
  for (let i = 0; i < 10; i++) {
    ys.push(y)
    y += i === 4 ? MID : GAP
  }
  return ys
}

const YS = lineYs()
const HEIGHT = YS[9] + PAD_Y
const X0 = GUTTER
const X1 = W - PAD_X

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
  /** Staff lines sit at a pitch, so they can also match that pitch's colour. */
  matchable = false,
): { value: string; color: string; label: string }[] {
  return [
    { value: '@auto', color: surface.staffLine, label: 'Follow the page' },
    ...(matchable
      ? [{ value: '@note', color: surface.staffLine, label: 'Match this line’s note' }]
      : []),
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

/**
 * The staff, at a size you can point at.
 *
 * Three things make this a preview rather than a diagram, and all three were
 * missing before.
 *
 * It sits on the *page* colour, not the panel's. A pale line on the dark panel
 * looked fine and then vanished on paper, so the one thing the preview existed
 * to tell you was the thing it got wrong.
 *
 * Every line is named, in a gutter that is part of its own hit target. "Line 3"
 * means nothing; D3 means something, and having to click a line to find out
 * which one it was is the reason this felt like guesswork.
 *
 * Selection and hover share one idiom — a band across the row and a rail in the
 * gutter — instead of the old dot-for-lines and dashed-outline-for-spaces. Two
 * marks for one meaning is most of what reads as unfinished.
 */
export function StaffPicker({
  staff,
  base,
  surface,
  noteColors,
  selected,
  onSelect,
}: {
  staff: StaffStyle
  base: LineStyle
  surface: Surface
  /** What each line resolves to when set to match its own note. */
  noteColors: string[]
  selected: Selection
  onSelect: (sel: Selection) => void
}) {
  const [hover, setHover] = useState<Selection | null>(null)
  const same = (a: Selection | null, b: Selection) =>
    a !== null && a.kind === b.kind && a.index === b.index

  /** One row: the band behind it, the gutter rail, and the pointer handling. */
  const Row = ({
    sel,
    top,
    height,
    children,
  }: {
    sel: Selection
    top: number
    height: number
    children?: ReactNode
  }) => {
    const on = same(selected, sel)
    const over = same(hover, sel)
    return (
      <g
        onClick={() => onSelect(sel)}
        onPointerEnter={() => setHover(sel)}
        onPointerLeave={() => setHover(null)}
        style={{ cursor: 'pointer' }}
      >
        <rect
          x={0}
          y={top}
          width={W}
          height={height}
          rx={3}
          fill={surface.text}
          opacity={on ? 0.1 : over ? 0.05 : 0}
        />
        {/* Inset, or the rounded frame clips it into a nub. Drawn in the page's
            own ink so it reads on a dark page and a light one alike — the accent
            is a fixed colour and vanished on one of them. */}
        {on && (
          <rect
            x={4}
            y={top + 1.5}
            width={2.5}
            height={Math.max(3, height - 3)}
            rx={1.25}
            fill={surface.text}
            opacity={0.8}
          />
        )}
        {children}
      </g>
    )
  }

  return (
    <svg
      className="staff-mini"
      width={W}
      height={HEIGHT}
      viewBox={`0 0 ${W} ${HEIGHT}`}
      role="group"
      aria-label="Staff lines and spaces"
      style={{ background: surface.background }}
    >
      {/* Shaded spaces, drawn first so the lines that bound them sit on top. */}
      {Array.from({ length: 9 }, (_, i) => {
        const space = staff.spaces[i]
        if (!space || space.fill === '@none') return null
        const top = yOfLine(i + 1)
        return (
          <rect
            key={`fill${i}`}
            x={X0}
            y={top}
            width={X1 - X0}
            height={yOfLine(i) - top}
            fill={space.fill === '@auto' ? surface.gridStrong : space.fill}
            opacity={space.opacity}
            pointerEvents="none"
          />
        )
      })}

      {/* The ledger stroke middle C would sit on. The wide gap is only
          meaningful once you can see what it is a gap for. */}
      <line
        x1={(X0 + X1) / 2 - 11}
        x2={(X0 + X1) / 2 + 11}
        y1={(yOfLine(4) + yOfLine(5)) / 2}
        y2={(yOfLine(4) + yOfLine(5)) / 2}
        stroke={surface.staffLine}
        strokeWidth={1}
        opacity={0.28}
        pointerEvents="none"
      />

      {/* Space rows: everything between two lines that a line band does not claim. */}
      {Array.from({ length: 9 }, (_, i) => {
        const upper = yOfLine(i + 1)
        const lower = yOfLine(i)
        const top = upper + LINE_BAND / 2
        return (
          <Row
            key={`s${i}`}
            sel={{ kind: 'space', index: i }}
            top={top}
            height={Math.max(4, lower - LINE_BAND / 2 - top)}
          />
        )
      })}

      {/* Lines last, so a line always wins the click over the space beside it. */}
      {Array.from({ length: 10 }, (_, i) => {
        const style = staffLineStyle(staff, i, base)
        const y = yOfLine(i)
        const on = same(selected, { kind: 'line', index: i })
        const over = same(hover, { kind: 'line', index: i })
        return (
          <Row
            key={`l${i}`}
            sel={{ kind: 'line', index: i }}
            top={y - LINE_BAND / 2}
            height={LINE_BAND}
          >
            <text
              x={GUTTER - 8}
              y={y + NAME_SIZE * 0.37}
              textAnchor="end"
              fontSize={NAME_SIZE}
              fill={surface.text}
              opacity={on ? 0.95 : over ? 0.7 : 0.4}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              pointerEvents="none"
            >
              {STAFF_LINE_NAMES[i]}
            </text>
            {style.show ? (
              <line
                x1={X0}
                x2={X1}
                y1={y}
                y2={y}
                stroke={lineColor(style, 'staff', surface, noteColors[i])}
                strokeWidth={Math.max(0.9, style.width)}
                strokeDasharray={dashArray(style.dash, style.width)}
                opacity={style.opacity}
                pointerEvents="none"
              />
            ) : (
              /* A hidden line still needs a place to be clicked back on, so it
                 leaves a ghost rather than nothing at all. */
              <line
                x1={X0}
                x2={X1}
                y1={y}
                y2={y}
                stroke={surface.staffLine}
                strokeWidth={1}
                strokeDasharray="1.5 3.5"
                opacity={0.22}
                pointerEvents="none"
              />
            )}
          </Row>
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
