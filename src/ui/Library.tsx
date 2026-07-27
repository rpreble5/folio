import { useRef, useState } from 'react'
import { LIBRARY } from '../core/library'
import { ACCEPTED_TYPES, importFile } from '../io/import'
import { DEFAULT_COLOR, buildPalette } from '../core/palettes'
import { pitchClass } from '../core/pitch'
import { useStore } from '../state/store'
import type { Score } from '../core/types'

/** A few bars of the real piece, coloured — a hint at what opens. */
function Thumb({ score }: { score: Score }) {
  const palette = buildPalette(DEFAULT_COLOR)
  const sample = score.notes.slice(0, 24)
  const low = Math.min(...sample.map((n) => n.midi))
  const high = Math.max(...sample.map((n) => n.midi))
  const span = Math.max(1, high - low)

  return (
    <div className="piece__thumb" aria-hidden="true">
      {sample.map((note) => (
        <i
          key={note.id}
          style={{
            height: `${20 + ((note.midi - low) / span) * 74}%`,
            background: palette.colors[pitchClass(note.midi)],
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  )
}

export function Library() {
  const loadScore = useStore((s) => s.loadScore)
  const importError = useStore((s) => s.importError)
  const setImportError = useStore((s) => s.setImportError)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setImportError(null)
    try {
      const score = await importFile(file)
      if (score.notes.length === 0) {
        throw new Error('That file parsed, but holds no notes Folio can place.')
      }
      loadScore(score)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="library">
      <div className="library__inner">
        <h1 className="library__lede">Sheet music, in a language that suits you.</h1>
        <p className="library__sub">
          Bring in a score and redesign how it reads — colour, shape, labels, spacing, right
          down to a single note. Start with one of these.
        </p>

        <div className="library__grid">
          {LIBRARY.map(({ score, blurb }) => (
            <button key={score.id} className="piece" onClick={() => loadScore(score)}>
              <Thumb score={score} />
              <div className="piece__title">{score.title}</div>
              <div className="piece__composer">{score.composer}</div>
              <div className="piece__blurb">{blurb}</div>
            </button>
          ))}
        </div>

        <div
          className={dragging ? 'dropzone dropzone--over' : 'dropzone'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void handleFile(e.dataTransfer.files[0])
          }}
        >
          <strong>{busy ? 'Reading…' : 'Or bring your own'}</strong>
          Drop a MusicXML or MIDI file here, or{' '}
          <button className="link" onClick={() => fileInput.current?.click()}>
            choose one
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_TYPES}
            hidden
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </div>

        {importError && <div className="error">{importError}</div>}
      </div>
    </div>
  )
}
