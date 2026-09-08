/**
 * Per-note editing, anchored to the note itself.
 *
 * The old version put this in a sidebar, which meant looking away from the
 * thing you were editing. Here it opens beside the note, so the change and its
 * effect stay in the same glance.
 *
 * The scope row is the important part — it is the cascade made visible. The
 * count keeps it honest, so nobody recolours a third of the piece by accident.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { keyAt } from '../core/types'
import { noteName, octaveOf, pitchClass } from '../core/pitch'
import type { ShapeKind } from '../core/palettes'
import { matches, resolveStyle, type Selector } from '../core/theme'
import { player } from '../audio/player'
import { Field, ShapeMark } from './controls'

const SHAPES: ShapeKind[] = [
  'capsule', 'circle', 'rect', 'hexagon', 'diamond', 'triangleUp', 'triangleDown', 'chevron',
  'star', 'teardrop', 'pentagon',
]

/** A calm, wide-gamut set that still reads on a dark page. */
const SWATCHES = [
  '#F2655F', '#F2924A', '#F0BE4B', '#E4DE63', '#A9D26A', '#5FC48C', '#4FBFB8', '#59A6E0',
  '#7C8FE8', '#A87CE0', '#DE72C4', '#E8E4DA', '#B9C0CC', '#8A93A1', '#5C646F', '#2E343C',
]

type Scope = 'note' | 'pitchClassOctave' | 'pitchClass'

interface Props {
  /** Position in the score container's coordinate space. */
  x: number
  y: number
}

export function NotePopover({ x, y }: Props) {
  const score = useStore((s) => s.score)
  const theme = useStore((s) => s.theme)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const selectNote = useStore((s) => s.selectNote)
  const addRule = useStore((s) => s.addRule)
  const [scope, setScope] = useState<Scope>('pitchClass')

  const note = useMemo(
    () => score.notes.find((n) => n.id === selectedNoteId) ?? null,
    [score.notes, selectedNoteId],
  )

  const selector: Selector | null = useMemo(() => {
    if (!note) return null
    if (scope === 'note') return { kind: 'note', noteId: note.id }
    if (scope === 'pitchClass') return { kind: 'pitchClass', pitchClass: pitchClass(note.midi) }
    return {
      kind: 'pitchClassOctave',
      pitchClass: pitchClass(note.midi),
      octave: octaveOf(note.midi),
    }
  }, [note, scope])

  const affected = useMemo(() => {
    if (!selector || !note) return 0
    const key = keyAt(score, note.onset)
    return score.notes.filter((n) => matches(selector, n, key)).length
  }, [selector, score, note])

  if (!note || !selector) return null

  const key = keyAt(score, note.onset)
  const current = resolveStyle(note, theme, key)
  const short = noteName(note.spelling)
  const full = noteName(note.spelling, true)

  return (
    <div
      className="popover"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="popover__head">
        <ShapeMark shape={current.shape} color={current.fill} size={18} />
        <div className="popover__title">{full}</div>
        <button className="icon-btn" onClick={() => player.preview(note.midi)} title="Hear it">
          ♪
        </button>
        <button className="icon-btn" onClick={() => selectNote(null)} title="Close">
          ✕
        </button>
      </div>

      <div className="popover__meta">
        {note.hand === 'right' ? 'Right hand' : 'Left hand'} · bar {note.measure + 1}
        {note.finger ? ` · finger ${note.finger}` : ''}
      </div>

      <Field name="Apply to" value={`${affected} note${affected === 1 ? '' : 's'}`}>
        <div className="pills pills--fill">
          <button
            className="pill"
            aria-pressed={scope === 'note'}
            onClick={() => setScope('note')}
          >
            This one
          </button>
          <button
            className="pill"
            aria-pressed={scope === 'pitchClassOctave'}
            onClick={() => setScope('pitchClassOctave')}
          >
            {full}
          </button>
          <button
            className="pill"
            aria-pressed={scope === 'pitchClass'}
            onClick={() => setScope('pitchClass')}
          >
            Every {short}
          </button>
        </div>
      </Field>

      <Field name="Colour">
        <div className="color-grid">
          {SWATCHES.map((color) => (
            <button
              key={color}
              style={{ background: color }}
              aria-pressed={current.fill.toLowerCase() === color.toLowerCase()}
              aria-label={color}
              onClick={() => addRule(selector, { fill: color })}
            />
          ))}
        </div>
      </Field>

      <Field name="Shape">
        <div className="shape-grid">
          {SHAPES.map((shape) => (
            <button
              key={shape}
              aria-pressed={current.shape === shape}
              aria-label={shape}
              onClick={() => addRule(selector, { shape })}
            >
              <ShapeMark shape={shape} size={13} />
            </button>
          ))}
        </div>
      </Field>

      <Field name="Fill">
        <div className="pills pills--fill">
          <button
            className="pill"
            aria-pressed={current.filled}
            onClick={() => addRule(selector, { filled: true })}
          >
            Solid
          </button>
          <button
            className="pill"
            aria-pressed={!current.filled}
            onClick={() => addRule(selector, { filled: false })}
          >
            Hollow
          </button>
        </div>
      </Field>
    </div>
  )
}
