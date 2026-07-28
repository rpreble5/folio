/**
 * Direct manipulation of the staff.
 *
 * Ten lines and nine spaces, each independently styleable, is eighteen things —
 * far too many to lay out as rows of sliders. So the staff itself is the
 * control: click the line or the space you want, and edit that one. The
 * miniature also previews what you are building, which a list never could.
 */

import { useState } from 'react'
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
import { Field, Pills, Slider, Switch } from './controls'

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

type Selection = { kind: 'line' | 'space'; index: number }

/**
 * An unset space is off, not on. Defaulting to '@auto' made the toggle read as
 * enabled while nothing was actually drawn, because the renderer skips spaces
 * with no stored entry — a control that lied about its own state.
 */
const DEFAULT_SPACE: SpaceStyle = { fill: '@none', opacity: 0.14, texture: 'none' }

interface Props {
  staff: StaffStyle
  base: LineStyle
  surface: Surface
  onChange: (staff: StaffStyle) => void
}

export function StaffEditor({ staff, base, surface, onChange }: Props) {
  const [selected, setSelected] = useState<Selection>({ kind: 'line', index: 5 })

  const patchLine = (index: number, patch: Partial<LineStyle>) =>
    onChange({ ...staff, lines: { ...staff.lines, [index]: { ...staff.lines[index], ...patch } } })

  const patchSpace = (index: number, patch: Partial<SpaceStyle>) =>
    onChange({
      ...staff,
      spaces: { ...staff.spaces, [index]: { ...DEFAULT_SPACE, ...staff.spaces[index], ...patch } },
    })

  const current =
    selected.kind === 'line'
      ? staffLineStyle(staff, selected.index, base)
      : (staff.spaces[selected.index] ?? DEFAULT_SPACE)

  return (
    <>
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
              onClick={() => setSelected({ kind: 'space', index: i })}
            />
          )
        })}

        {Array.from({ length: 10 }, (_, i) => {
          const style = staffLineStyle(staff, i, base)
          const y = yOfLine(i)
          const active = selected.kind === 'line' && selected.index === i
          return (
            <g key={`l${i}`} onClick={() => setSelected({ kind: 'line', index: i })}>
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

      <div className="field__value">
        {selected.kind === 'line'
          ? `Line ${selected.index + 1} · ${STAFF_LINE_NAMES[selected.index]}`
          : selected.index === 4
            ? 'Space · middle C'
            : `Space ${selected.index + 1}`}
      </div>

      {selected.kind === 'line' ? (
        <>
          <Switch
            label="Show this line"
            checked={(current as LineStyle).show}
            onChange={(show) => patchLine(selected.index, { show })}
          />
          {(current as LineStyle).show && (
            <>
              <Pills
                options={DASH_KINDS.map((d) => ({ value: d.id, label: d.label }))}
                value={(current as LineStyle).dash}
                onChange={(dash: DashKind) => patchLine(selected.index, { dash })}
              />
              <div className="slider-pair">
                <Field name="Weight" value={(current as LineStyle).width.toFixed(1)}>
                  <Slider
                    label="Line weight"
                    min={0.5}
                    max={5}
                    step={0.25}
                    value={(current as LineStyle).width}
                    onChange={(width) => patchLine(selected.index, { width })}
                  />
                </Field>
                <Field
                  name="Strength"
                  value={`${Math.round((current as LineStyle).opacity * 100)}%`}
                >
                  <Slider
                    label="Line strength"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={(current as LineStyle).opacity}
                    onChange={(opacity) => patchLine(selected.index, { opacity })}
                  />
                </Field>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <Switch
            label="Shade this space"
            checked={(current as SpaceStyle).fill !== '@none'}
            onChange={(on) => patchSpace(selected.index, { fill: on ? '@auto' : '@none' })}
          />
          {(current as SpaceStyle).fill !== '@none' && (
            <>
              <Field
                name="Strength"
                value={`${Math.round((current as SpaceStyle).opacity * 100)}%`}
              >
                <Slider
                  label="Shading strength"
                  min={0.02}
                  max={0.6}
                  step={0.02}
                  value={(current as SpaceStyle).opacity}
                  onChange={(opacity) => patchSpace(selected.index, { opacity })}
                />
              </Field>
              <Field name="Texture">
                <Pills
                  options={TEXTURE_KINDS.map((t) => ({ value: t.id, label: t.label }))}
                  value={(current as SpaceStyle).texture}
                  onChange={(texture: TextureKind) => patchSpace(selected.index, { texture })}
                />
              </Field>
            </>
          )}
        </>
      )}

      <button
        className="pill pill--solid"
        onClick={() => onChange({ lines: {}, spaces: {} })}
      >
        Reset every line and space
      </button>
    </>
  )
}
