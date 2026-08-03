/**
 * The note you played, shown where it would have been written.
 *
 * A wrong note means one of three things and they need different practice: you
 * misread the symbol, you read it right and your hand landed wrong, or you found
 * the right letter in the wrong octave. A flash cannot tell them apart. Putting
 * the played pitch on the staff beside the one that was asked for does it at a
 * glance — the gap between the two heads *is* the error, and an octave slip is
 * unmistakable.
 *
 * **Drawn as an overlay, not added to the score.** Adding a note would change the
 * spacing, and the prompt would jump the instant the hint appeared. Nothing on
 * this screen may move while it is being read, so the position is computed from
 * the layout already on screen and painted over the top.
 *
 * **In the reader's own notation, minus the colour.** It takes whatever head the
 * theme would give that pitch — an engraved oval, a capsule, a hexagon — because
 * a ghost drawn in some other notation would read as a different writing system
 * rather than as a note. Only the colour is dropped: everything else on this page
 * wears a hue from the reader's palette, so a coloured ghost would look like part
 * of the music instead of a report on it. The page's muted ink says "not a note —
 * a note you played".
 */

import type { KeyMark, NoteEvent } from '../core/types'
import type { Theme } from '../core/theme'
import { NO_TEXTURE, resolveStyle } from '../core/theme'
import { spellPitch } from '../core/pitch'
import { HEAD_GLYPHS } from '../render/glyphs'
import { headGlyphFor } from '../render/NotationLayer'
import { ledgerIndices } from '../render/ScoreView'
import { NoteGlyph } from '../render/NoteGlyph'
import type { Layout } from '../render/layout'

interface Props {
  /** The layout the prompt is already drawn with. Never re-laid out. */
  layout: Layout
  theme: Theme
  keyMark: KeyMark
  /** Where the step being answered sits, in the layout's own coordinates. */
  x: number
  /**
   * Top of the system that step is on.
   *
   * Zero for anything on one line, which is most prompts — but a long one is
   * laid out on two, and a hint drawn without this lands on the wrong staff.
   */
  top: number
  /** The played pitch. */
  midi: number
  /** The written length of the step, so the head matches the ones beside it. */
  beats: number
}

/**
 * How far right of the real note the ghost sits, in head widths.
 *
 * Close enough to belong to the note it is reporting on. Further out and it
 * drifts toward the *next* note of a phrase, where it reads as a comment on
 * that one instead.
 */
const OFFSET = 1.25

/** A trail would make the ghost look like a note being held. */
const NO_TRAIL = { thickness: 0, taper: 0, melt: 0, cap: 'round' as const, opacity: 0 }

export function GhostNote({ layout, theme, keyMark, x, top, midi, beats }: Props) {
  const space = layout.laneHeight * 2
  const width = layout.width
  const height = layout.height + 24
  const ink = theme.surface.muted

  /*
   * A note that exists only to be asked what it would look like.
   *
   * Going through resolveStyle rather than picking a shape here is what keeps
   * the ghost in the reader's language: whatever their theme does to a pitch —
   * shape by accidental, size by velocity, hollow for a long note — it does to
   * this one too, and the only thing overridden afterwards is the colour.
   */
  const note: NoteEvent = {
    id: 'ghost',
    onset: 0,
    duration: beats,
    midi,
    spelling: spellPitch(midi, keyMark),
    hand: 'right',
    voice: 1,
    measure: 0,
    velocity: 0.8,
    notated: {
      segments: [{ type: beats >= 4 ? 'whole' : 'quarter', dots: 0, beats }],
    },
  }
  const style = resolveStyle(note, theme, keyMark)
  const index = (() => {
    const spelling = note.spelling
    return spelling.octave * 7 + ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(spelling.step)
  })()

  // The same formula the renderer uses, so the ghost lands on the staff exactly
  // where a real note of that pitch would.
  const centreY = top + (layout.axisMax - index) * layout.laneHeight + layout.noteHeight / 2
  const glyph = theme.layout.notation?.heads ? headGlyphFor({ note } as never) : undefined
  const headWidth = (glyph?.width ?? HEAD_GLYPHS.black.width) * space
  const cx = layout.gutter + x + headWidth * OFFSET
  const size = layout.noteHeight * style.scale

  return (
    <svg
      className="ghost"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {/* Ledger lines first, and from the same rule the staff uses — a ghost
          three lines above is unreadable without them, and a second copy of the
          rule would be a second chance to disagree with the staff below it. */}
      {ledgerIndices(index).map((line) => (
        <line
          key={line}
          x1={cx - space * 0.55}
          x2={cx + headWidth + space * 0.55}
          y1={top + (layout.axisMax - line) * layout.laneHeight + layout.noteHeight / 2}
          y2={top + (layout.axisMax - line) * layout.laneHeight + layout.noteHeight / 2}
          stroke={ink}
          strokeWidth={1.1}
          shapeRendering="crispEdges"
        />
      ))}

      {glyph ? (
        <path
          className="ghost__head"
          d={glyph.path}
          transform={`translate(${cx}, ${centreY}) scale(${space})`}
          fill={ink}
        />
      ) : (
        <g className="ghost__head">
          <NoteGlyph
            x={cx}
            y={centreY - size / 2}
            width={size}
            height={size}
            shape={style.shape}
            fill={ink}
            stroke={ink}
            strokeWidth={style.filled ? 0 : 2}
            opacity={1}
            cornerRadius={theme.layout.cornerRadius}
            active={false}
            selected={false}
            accent={ink}
            filled={style.filled}
            hollowTint={0}
            trail={NO_TRAIL}
            texture={NO_TEXTURE}
            trailGrain={false}
          />
        </g>
      )}
    </svg>
  )
}
