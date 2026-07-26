/**
 * Interface primitives.
 *
 * Nothing here wraps a native form control. A `<select>`, a range input, or an
 * OS colour dialog is drawn by the operating system, not by us — which means it
 * carries someone else's design language into the middle of ours. These are all
 * built from scratch so the whole surface belongs to the app.
 *
 * Built from scratch also means keyboard support is our job, so every control
 * takes focus and responds to arrow keys.
 */

import { useCallback, useRef, type ReactNode } from 'react'
import type { ShapeKind } from '../core/palettes'

export function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="group">
      {label && <div className="group__label">{label}</div>}
      {children}
    </div>
  )
}

export function Field({
  name,
  value,
  children,
}: {
  name?: string
  value?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      {(name || value) && (
        <div className="field__head">
          {name && <span className="field__name">{name}</span>}
          {value && <span className="field__value">{value}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Pills<T extends string>({
  options,
  value,
  onChange,
  fill = false,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  fill?: boolean
}) {
  return (
    <div className={fill ? 'pills pills--fill' : 'pills'} role="group">
      {options.map((option) => (
        <button
          key={option.value}
          className="pill"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Slider built from divs and pointer events.
 *
 * Pointer capture means a drag keeps tracking after the cursor leaves the
 * element, which is what makes a custom slider feel as solid as a native one —
 * without it, dragging fast and slipping off drops the interaction.
 */
export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  label,
}: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (next: number) => void
  label: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const quantise = (n: number) => Math.round(n / step) * step
  const fraction = (clamp(value) - min) / (max - min || 1)

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const t = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width
      onChange(clamp(quantise(min + Math.min(1, Math.max(0, t)) * (max - min))))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step, onChange],
  )

  return (
    <div
      ref={trackRef}
      className="slider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        setFromClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (dragging.current) setFromClientX(e.clientX)
      }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onKeyDown={(e) => {
        const big = (max - min) / 10
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(clamp(quantise(value - step)))
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          onChange(clamp(quantise(value + step)))
        } else if (e.key === 'PageDown') {
          e.preventDefault()
          onChange(clamp(quantise(value - big)))
        } else if (e.key === 'PageUp') {
          e.preventDefault()
          onChange(clamp(quantise(value + big)))
        } else if (e.key === 'Home') {
          e.preventDefault()
          onChange(min)
        } else if (e.key === 'End') {
          e.preventDefault()
          onChange(max)
        }
      }}
    >
      <div className="slider__track" />
      <div className="slider__fill" style={{ width: `${fraction * 100}%` }} />
      <div className="slider__thumb" style={{ left: `${fraction * 100}%` }} />
    </div>
  )
}

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button className="switch-row" aria-pressed={checked} onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className="switch" />
    </button>
  )
}

export function Tile({
  selected,
  onClick,
  className = '',
  title,
  children,
}: {
  selected: boolean
  onClick: () => void
  className?: string
  title?: string
  children: ReactNode
}) {
  return (
    <button
      className={`tile ${className}`.trim()}
      aria-pressed={selected}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

/** Miniature note glyph, used inside tiles and the note popover. */
export function ShapeMark({
  shape,
  color = 'currentColor',
  size = 15,
}: {
  shape: ShapeKind
  color?: string
  size?: number
}) {
  const r = size / 2
  const c = size / 2

  const paths: Partial<Record<ShapeKind, string>> = {
    diamond: `M ${c} 0 L ${size} ${c} L ${c} ${size} L 0 ${c} Z`,
    triangleUp: `M ${c} 0 L ${size} ${size * 0.88} L 0 ${size * 0.88} Z`,
    triangleDown: `M ${c} ${size} L ${size} ${size * 0.12} L 0 ${size * 0.12} Z`,
    hexagon: `M ${c - r * 0.55} 0 L ${c + r * 0.55} 0 L ${size} ${c} L ${c + r * 0.55} ${size} L ${c - r * 0.55} ${size} L 0 ${c} Z`,
    chevron: `M 0 0 L ${c + r * 0.35} 0 L ${size} ${c} L ${c + r * 0.35} ${size} L 0 ${size} L ${r * 0.7} ${c} Z`,
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {shape === 'circle' && <circle cx={c} cy={c} r={r} fill={color} />}
      {shape === 'capsule' && <rect width={size} height={size} rx={r} fill={color} />}
      {shape === 'rect' && <rect width={size} height={size} rx={2} fill={color} />}
      {paths[shape] && <path d={paths[shape]} fill={color} />}
    </svg>
  )
}
