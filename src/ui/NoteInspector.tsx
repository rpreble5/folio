/**
 * Per-note editing.
 *
 * The scope buttons are the important part. Clicking a note and changing its
 * colour is only interesting if you can then say "no — every G", and that
 * choice is exactly the cascade made visible. Showing how many notes a scope
 * touches keeps it honest, so nobody recolours half the piece by accident.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { keyAt } from '../core/types'
import { noteName, octaveOf, pitchClass } from '../core/pitch'
import { SHAPE_SETS, type ShapeKind } from '../core/palettes'
import { matches, resolveStyle, type Selector } from '../core/theme'
import { player } from '../audio/player'
import { Field, Section, ShapePreview } from './controls'

const SHAPE_CHOICES: ShapeKind[] = [
  'capsule',
  'circle',
  'rect',
  'hexagon',
  'diamond',
  'triangleUp',
  'triangleDown',
  'chevron',
]

type Scope = 'note' | 'pitchClass' | 'pitchClassOctave'

export function NoteInspector() {
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
    switch (scope) {
      case 'note':
        return { kind: 'note', noteId: note.id }
      case 'pitchClass':
        return { kind: 'pitchClass', pitchClass: pitchClass(note.midi) }
      case 'pitchClassOctave':
        return {
          kind: 'pitchClassOctave',
          pitchClass: pitchClass(note.midi),
          octave: octaveOf(note.midi),
        }
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
  const name = noteName(note.spelling, true)

  return (
    <Section title={`Editing ${name}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <ShapePreview shape={current.shape} color={current.fill} size={22} />
        <div style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>
          {note.hand === 'right' ? 'Right hand' : 'Left hand'} · bar {note.measure + 1}
          {note.finger ? ` · finger ${note.finger}` : ''}
        </div>
        <button
          className="btn btn--ghost btn--icon"
          title="Hear this note"
          onClick={() => player.preview(note.midi)}
        >
          ♪
        </button>
        <button className="btn btn--ghost btn--icon" onClick={() => selectNote(null)} title="Close">
          ✕
        </button>
      </div>

      <Field label="Apply to" value={`${affected} note${affected === 1 ? '' : 's'}`}>
        <div className="seg" style={{ width: '100%' }}>
          <button
            style={{ flex: 1 }}
            aria-pressed={scope === 'note'}
            onClick={() => setScope('note')}
          >
            This one
          </button>
          <button
            style={{ flex: 1 }}
            aria-pressed={scope === 'pitchClassOctave'}
            onClick={() => setScope('pitchClassOctave')}
          >
            {name}
          </button>
          <button
            style={{ flex: 1 }}
            aria-pressed={scope === 'pitchClass'}
            onClick={() => setScope('pitchClass')}
          >
            Every {noteName(note.spelling)}
          </button>
        </div>
      </Field>

      <Field label="Colour">
        <input
          type="color"
          value={toHex(current.fill)}
          onChange={(e) => addRule(selector, { fill: e.target.value })}
        />
      </Field>

      <Field label="Shape">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {SHAPE_CHOICES.map((shape) => (
            <button
              key={shape}
              className="btn btn--icon"
              aria-pressed={current.shape === shape}
              title={shape}
              onClick={() => addRule(selector, { shape })}
            >
              <ShapePreview shape={shape} color="currentColor" size={15} />
            </button>
          ))}
        </div>
      </Field>

      <div className="field__hint">
        Overrides sit on top of the preset, so switching palettes keeps them. Find them under
        “Your overrides” below.
      </div>
    </Section>
  )
}

/** <input type="color"> only accepts #rrggbb, so normalise anything else. */
function toHex(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#7c9cff'
}

export { SHAPE_SETS }
