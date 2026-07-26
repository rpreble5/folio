import type { ReactNode } from 'react'
import type { ShapeKind } from '../core/palettes'

export function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string
  value?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {value && <span className="field__value">{value}</span>}
      </div>
      {children}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <h3 className="section__title">{title}</h3>
      {children}
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button className="toggle" aria-pressed={checked} onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className="toggle__switch" />
    </button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (next: number) => void
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

/** Miniature version of a note glyph, for use inside pickers. */
export function ShapePreview({ shape, color, size = 16 }: { shape: ShapeKind; color: string; size?: number }) {
  const r = size / 2
  const c = size / 2

  const paths: Partial<Record<ShapeKind, string>> = {
    diamond: `M ${c} 0 L ${size} ${c} L ${c} ${size} L 0 ${c} Z`,
    triangleUp: `M ${c} 0 L ${size} ${size * 0.9} L 0 ${size * 0.9} Z`,
    triangleDown: `M ${c} ${size} L ${size} ${size * 0.1} L 0 ${size * 0.1} Z`,
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
