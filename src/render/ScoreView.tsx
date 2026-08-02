import { useMemo } from 'react'
import type { Score } from '../core/types'
import { diatonicIndex, keyboardPosition, octaveOf, pitchClass } from '../core/pitch'
import type { LineRole, LineStyle, Surface, Theme } from '../core/theme'
import type { LabelPlace } from '../core/theme'
import { NO_TEXTURE, dashArray, fontStack, lineColor, staffLineStyle } from '../core/theme'
import { buildPalette, colorForPitch } from '../core/palettes'
import { keyAt } from '../core/types'
import type { Layout, System } from './layout'
import { beatToX } from './layout'
import { NoteGlyph } from './NoteGlyph'
import { NotationLayer, headGlyphFor } from './NotationLayer'
import { CvdFilters, cvdFilterUrl, type CvdMode } from './cvd'
import { TextureDefs, textureFill } from './textures'

interface Props {
  score: Score
  theme: Theme
  layout: Layout
  playheadBeat: number
  playing: boolean
  activeIds: Set<string>
  selectedId: string | null
  cvd: CvdMode
  /** Coordinates come from the click so the editor can open beside the note. */
  onSelectNote: (id: string | null, at?: { x: number; y: number }) => void
  /**
   * Render only these systems, at these positions, instead of the whole score
   * down the page.
   *
   * The Studio wants the score as a document — every system stacked, scrolled
   * through. The Read view wants a fixed frame with systems swapped into it, so
   * that the music does not move while it is being read. Both are the same
   * drawing code; only which system lands where differs, so that is the only
   * thing this changes.
   */
  slots?: { system: number; y: number }[]
  /** Total drawing height, when the slots do not fill the whole score. */
  height?: number
}

const BASS_STAFF = [18, 20, 22, 24, 26]
const TREBLE_STAFF = [30, 32, 34, 36, 38]

/** All ten staff lines, bottom to top, as diatonic indices. */
export const STAFF_LINES = [...BASS_STAFF, ...TREBLE_STAFF]

/** The same ten lines as MIDI: G2 B2 D3 F3 A3, then E4 G4 B4 D5 F5. */
const STAFF_LINE_MIDI = [43, 47, 50, 53, 57, 64, 67, 71, 74, 77]

/** Where a label sits vertically, given its placement. */
function labelY(
  placed: { y: number; height: number },
  place: LabelPlace,
  size: number,
): number {
  if (place === 'above') return placed.y - size * 0.4
  if (place === 'below') return placed.y + placed.height + size
  return placed.y + placed.height / 2 + size * 0.35
}

const KEY_WHITE = '#eef1f7'
const KEY_BLACK = '#171b24'

/** Turn a LineStyle into the SVG stroke attributes for one line. */
function strokeProps(
  line: LineStyle,
  role: LineRole,
  surface: Surface,
  noteColor?: string,
) {
  return {
    stroke: lineColor(line, role, surface, noteColor),
    strokeWidth: line.width,
    strokeDasharray: dashArray(line.dash, line.width),
    opacity: line.opacity,
    /*
     * Every line this styles is axis-aligned — staff, ledger, barline, beat,
     * anchor — so snapping it to the pixel grid costs nothing and buys a hard
     * edge. Without it a 1.1px staff line centred at y=143.55 covers 143.0 to
     * 144.1: one solid row plus a ten-percent ghost row under it, repeated down
     * the whole page, which reads as a faint doubling rather than as a hairline.
     *
     * Safe only because these are all horizontal or vertical. crispEdges turns
     * antialiasing off outright, so a sloped line under it would come out
     * jagged — which is why beams and glyphs are not styled here.
     */
    shapeRendering: 'crispEdges' as const,
  }
}

export function ScoreView({
  score,
  theme,
  layout,
  playheadBeat,
  playing,
  activeIds,
  selectedId,
  cvd,
  onSelectNote,
  slots,
  height,
}: Props) {
  const { surface, layout: cfg } = theme
  const isStaff = cfg.mode === 'staff'
  const yFor = (pos: number) => (layout.axisMax - pos) * layout.laneHeight

  // Keyboard gutter geometry is identical for every system, so build it once.
  const keyboard = useMemo(() => {
    if (isStaff || !cfg.showKeyboard) return []
    const keys: { midi: number; y: number; height: number; black: boolean; label?: string }[] = []
    for (const row of layout.keyRows) {
      const pos =
        cfg.pitchAxis === 'keyboard' ? keyboardPosition(row.midi) : row.midi
      const centre = yFor(pos) + layout.noteHeight / 2
      const height = cfg.pitchAxis === 'keyboard' && !row.black
        ? layout.laneHeight
        : layout.laneHeight * 0.62
      keys.push({
        midi: row.midi,
        y: centre - height / 2,
        height,
        black: row.black,
        label: pitchClass(row.midi) === 0 ? `C${octaveOf(row.midi)}` : undefined,
      })
    }
    // Black keys last so they sit above their neighbours, as on a real keyboard.
    return keys.sort((a, b) => Number(a.black) - Number(b.black))
  }, [layout, cfg.showKeyboard, cfg.pitchAxis, isStaff])

  /**
   * Which staves this score uses.
   *
   * Clefs say so when the file had them. Otherwise fall back to the hands: a
   * piece with anything in the left hand is a grand staff, one without is a
   * single staff, and drawing a bass clef under a treble-only piece would be
   * inventing a staff the music does not use.
   */
  const staves = useMemo(() => {
    const fromClefs = new Set((score.clefs ?? []).map((c) => c.staff))
    if (fromClefs.size) return Array.from(fromClefs).sort((a, b) => a - b)
    return score.notes.some((n) => n.hand === 'left') ? [1, 2] : [1]
  }, [score])

  const filter = cvdFilterUrl(cvd)
  const pageFill = textureFill(cfg.pageTexture)

  // Resolved once for the page: which colour each staff line would wear if it
  // is set to match its note. Keyed off the score's opening key, since a line
  // is a fixed pitch and cannot follow a modulation the way a note does.
  const staffLineColors = useMemo(() => {
    if (!isStaff) return []
    const palette = buildPalette(theme.encodings.color)
    const key = keyAt(score, 0)
    return STAFF_LINE_MIDI.map((midi) => colorForPitch(palette, midi, key))
  }, [isStaff, theme.encodings.color, score])

  return (
    <svg
      className="score"
      width={layout.width}
      height={height ?? layout.height + 24}
      viewBox={`0 0 ${layout.width} ${height ?? layout.height + 24}`}
      role="img"
      aria-label={`${score.title} by ${score.composer}, rendered in the ${theme.name} style`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectNote(null)
      }}
    >
      <CvdFilters />
      <TextureDefs
        textures={[
          theme.encodings.texture,
          cfg.pageTexture,
          // Space shading can carry its own texture, and a pattern that is not
          // defined here simply renders as nothing.
          ...Object.values(cfg.staff.spaces).map((sp) => ({
            ...NO_TEXTURE,
            kind: sp.texture,
          })),
        ]}
      />

      <rect width="100%" height="100%" fill={surface.background} />
      {/* Page grain sits under everything, and wants a much coarser scale than
          the notes so it does not compete with them for the same channel. */}
      {pageFill && (
        <rect width="100%" height="100%" fill={pageFill} opacity={cfg.pageTexture.strength} />
      )}

      <g filter={filter}>
        {(slots ?? layout.systems.map((s) => ({ system: s.index, y: s.top })))
          .map(({ system: index, y }) => {
            const system = layout.systems[index]
            if (!system) return null
            return (
              <SystemGroup
                // Keyed by slot *and* system, so a slot whose content changes
                // re-mounts — which is what lets it fade in — while every other
                // slot is left alone. Keying by slot alone would update in place
                // and the swap would be a hard cut.
                key={slots ? `slot-${y}-${system.index}` : system.index}
                score={score}
                system={system}
                top={y}
                theme={theme}
                layout={layout}
                keyboard={keyboard}
                playheadBeat={playheadBeat}
                playing={playing}
                activeIds={activeIds}
                selectedId={selectedId}
                onSelectNote={onSelectNote}
                yFor={yFor}
                isStaff={isStaff}
                staffLineColors={staffLineColors}
                staves={staves}
              />
            )
          })}
      </g>
    </svg>
  )
}

interface SystemProps {
  score: Score
  system: System
  /** Where to draw it, which is the system's own top everywhere but Read. */
  top: number
  theme: Theme
  layout: Layout
  keyboard: { midi: number; y: number; height: number; black: boolean; label?: string }[]
  playheadBeat: number
  playing: boolean
  activeIds: Set<string>
  selectedId: string | null
  onSelectNote: (id: string | null, at?: { x: number; y: number }) => void
  yFor: (pos: number) => number
  isStaff: boolean
  staffLineColors: string[]
  /** Staff numbers the score actually uses, so each gets its own line opening. */
  staves: number[]
}

function SystemGroup({
  score,
  system,
  top,
  theme,
  layout,
  keyboard,
  playheadBeat,
  playing,
  activeIds,
  selectedId,
  onSelectNote,
  yFor,
  isStaff,
  staffLineColors,
  staves,
}: SystemProps) {
  const { surface, layout: cfg, encodings } = theme
  // An engraved system spans the page rather than a beat count: its last column
  // sits at the right edge by construction, so that is the width.
  const systemWidth = system.columns
    ? (system.columns.at(-1)?.x ?? 0)
    : (system.endBeat - system.startBeat) * layout.beatWidth
  const inSystem =
    playheadBeat >= system.startBeat - 1e-6 && playheadBeat < system.endBeat - 1e-6
  const playheadX = beatToX(system, playheadBeat, layout.beatWidth)

  const labelSize = Math.max(7, Math.min(layout.noteHeight * 0.62, 13)) * encodings.labelScale

  // One staff space is two diatonic steps, which is what every glyph is drawn
  // against. Everything notation-side scales off this single number.
  const space = layout.laneHeight * 2
  const notation = cfg.notation
  const headGlyph = notation?.heads ? headGlyphFor : null

  return (
    <g transform={`translate(0, ${top})`} data-slot={system.index}>
      {/* Black-key bands: the strongest orientation cue on a chromatic axis. */}
      {!isStaff && cfg.showBlackKeyRows &&
        layout.keyRows
          .filter((row) => row.black)
          .map((row) => (
            <rect
              key={`band-${row.midi}`}
              x={layout.gutter}
              y={row.y}
              width={systemWidth}
              height={row.height}
              fill={surface.grid}
              opacity={0.75}
            />
          ))}

      {/* Anchor lines: a horizontal reference to judge pitch against. */}
      {!isStaff && cfg.lines.anchor.show &&
        layout.anchors.map((anchor) => (
          <line
            key={`anchor-${anchor.midi}`}
            x1={layout.gutter}
            x2={layout.gutter + systemWidth}
            y1={anchor.y}
            y2={anchor.y}
            {...strokeProps(cfg.lines.anchor, 'anchor', surface)}
          />
        ))}

      {/* Shaded spaces, under the lines that bound them. */}
      {isStaff &&
        STAFF_LINES.map((di, i) => {
          if (i === STAFF_LINES.length - 1) return null
          const space = cfg.staff.spaces[i]
          if (!space || space.fill === '@none') return null
          const yTop = yFor(STAFF_LINES[i + 1]) + layout.noteHeight / 2
          const yBottom = yFor(di) + layout.noteHeight / 2
          const fill = space.fill === '@auto' ? surface.gridStrong : space.fill
          const pattern = textureFill({ ...NO_TEXTURE, kind: space.texture })
          return (
            <g key={`space-${i}`}>
              <rect
                x={layout.gutter}
                y={yTop}
                width={systemWidth}
                height={Math.max(0, yBottom - yTop)}
                fill={fill}
                opacity={space.opacity}
              />
              {pattern && (
                <rect
                  x={layout.gutter}
                  y={yTop}
                  width={systemWidth}
                  height={Math.max(0, yBottom - yTop)}
                  fill={pattern}
                  opacity={space.opacity}
                />
              )}
            </g>
          )
        })}

      {/* Staff lines, each able to override the shared style — and each able to
          wear the colour of the pitch it sits on, which is what keeps a matched
          line matched after the palette is retuned. */}
      {isStaff &&
        STAFF_LINES.map((di, i) => {
          const style = staffLineStyle(cfg.staff, i, cfg.lines.staff)
          if (!style.show) return null
          return (
            <line
              key={`staff-${i}`}
              x1={layout.gutter}
              x2={layout.gutter + systemWidth}
              y1={yFor(di) + layout.noteHeight / 2}
              y2={yFor(di) + layout.noteHeight / 2}
              {...strokeProps(style, 'staff', surface, staffLineColors[i])}
            />
          )
        })}

      {/* Beat grid */}
      {cfg.lines.beat.show &&
        beatTicks(system.startBeat, system.endBeat).map((beat) => (
          <line
            key={`grid-${beat}`}
            x1={layout.gutter + beatToX(system, beat, layout.beatWidth)}
            x2={layout.gutter + beatToX(system, beat, layout.beatWidth)}
            y1={0}
            y2={layout.systemInnerHeight}
            {...strokeProps(cfg.lines.beat, 'beat', surface)}
          />
        ))}

      {/* Barlines and measure numbers */}
      {cfg.lines.bar.show &&
        system.measures.map((measure, i) => (
          <g key={`bar-${measure.index}`}>
            {/* No barline at the start of a system: a staff simply begins, and a
                line there reads as a repeat sign or a double bar. The line at the
                system's right edge closes it instead. */}
            {!(i === 0 && system.columns) && <line
              x1={layout.gutter + measure.x}
              x2={layout.gutter + measure.x}
              y1={-4}
              y2={layout.systemInnerHeight + 4}
              {...strokeProps(cfg.lines.bar, 'bar', surface)}
            />}
            {cfg.showMeasureNumbers && (
              <text
                x={layout.gutter + measure.x + 5}
                y={-8}
                fill={surface.muted}
                fontSize={10}
                fontWeight={600}
                className="score__measure-number"
              >
                {measure.index + 1}
              </text>
            )}
          </g>
        ))}
      {cfg.lines.bar.show && (
        <line
          x1={layout.gutter + systemWidth}
          x2={layout.gutter + systemWidth}
          y1={-4}
          y2={layout.systemInnerHeight + 4}
          {...strokeProps(cfg.lines.bar, 'bar', surface)}
        />
      )}

      {/* Ledger lines */}
      {isStaff && cfg.lines.ledger.show &&
        system.notes.flatMap((placed) =>
          ledgerIndices(diatonicIndex(placed.note.spelling)).map((index) => (
            <line
              key={`ledger-${placed.note.id}-${index}`}
              x1={layout.gutter + placed.x + Math.min(0, placed.dx ?? 0) - 4}
              x2={
                layout.gutter +
                placed.x +
                Math.max(0, placed.dx ?? 0) +
                Math.max(placed.width, layout.noteHeight) +
                4
              }
              y1={yFor(index) + layout.noteHeight / 2}
              y2={yFor(index) + layout.noteHeight / 2}
              {...strokeProps(cfg.lines.ledger, 'ledger', surface)}
            />
          )),
        )}

      {/* Keyboard gutter */}
      {keyboard.map((key) => (
        <g key={`key-${key.midi}`}>
          <rect
            x={key.black ? 4 : 2}
            y={key.y}
            width={key.black ? layout.gutter * 0.58 : layout.gutter - 8}
            height={key.height}
            rx={2}
            // Fixed key colours rather than surface.text/background: those two
            // swap places between the dark and paper pages, which rendered the
            // keyboard as a photographic negative on paper.
            fill={key.black ? KEY_BLACK : KEY_WHITE}
            stroke={surface.gridStrong}
            strokeWidth={0.75}
            opacity={0.92}
          />
          {key.label && (
            <text
              x={layout.gutter - 11}
              y={key.y + key.height / 2 + 3}
              fill={KEY_BLACK}
              fontSize={8}
              fontWeight={700}
              textAnchor="end"
            >
              {key.label}
            </text>
          )}
        </g>
      ))}

      {/* Notes */}
      <g transform={`translate(${layout.gutter}, 0)`}>
        {system.notes.map((placed) => {
          const active = activeIds.has(placed.note.id)
          return (
            <g
              key={placed.note.id}
              onClick={(e) => {
                e.stopPropagation()
                onSelectNote(placed.note.id, { x: e.clientX, y: e.clientY })
              }}
              style={{ cursor: 'pointer' }}
            >
              {headGlyph?.(placed) ? (
                <path
                  className="score__head"
                  d={headGlyph(placed)!.path}
                  transform={`translate(${placed.x + (placed.dx ?? 0)}, ${placed.y + placed.height / 2}) scale(${space})`}
                  fill={placed.style.filled ? placed.style.fill : 'none'}
                  stroke={placed.style.filled ? 'none' : placed.style.fill}
                  strokeWidth={placed.style.filled ? 0 : 0.09}
                  opacity={placed.style.opacity}
                />
              ) : (
              <NoteGlyph
                x={placed.x}
                y={placed.y}
                width={placed.width}
                height={placed.height}
                shape={placed.style.shape}
                fill={placed.style.fill}
                stroke={placed.style.stroke}
                strokeWidth={placed.style.strokeWidth}
                opacity={placed.style.opacity}
                cornerRadius={cfg.cornerRadius}
                active={active}
                selected={selectedId === placed.note.id}
                accent={surface.accent}
                filled={placed.style.filled}
                hollowTint={encodings.outlineStyle === 'tinted' ? 0.22 : 0}
                trail={encodings.trail}
                texture={encodings.texture}
                trailGrain={encodings.trailGrain}
              />
              )}
              {placed.style.labelText && (
                <text
                  x={placed.x + Math.min(placed.height, placed.width) / 2}
                  y={labelY(placed, encodings.labelPlace, labelSize)}
                  // Placement no longer changes the colour here: resolveStyle
                  // already knows whether the page or the note is behind the
                  // text, so a tinted label survives being moved outside.
                  fill={placed.style.labelColor}
                  fillOpacity={encodings.labelOpacity}
                  fontSize={labelSize}
                  fontWeight={encodings.labelWeight}
                  style={{ fontFamily: fontStack(encodings.labelFont) }}
                  letterSpacing={encodings.labelTracking}
                  textAnchor="middle"
                  pointerEvents="none"
                  className="score__note-label"
                >
                  {placed.style.labelText}
                </text>
              )}
            </g>
          )
        })}
      </g>

      {/* Traditional notation: stems, beams, flags, rests, clef, key, time. */}
      {notation && system.columns && (
        <NotationLayer
          score={score}
          system={system}
          notation={notation}
          space={space}
          gutter={layout.gutter}
          yFor={yFor}
          noteHeight={layout.noteHeight}
          surface={surface}
          staves={staves}
        />
      )}

      {/* Playhead */}
      {inSystem && (
        <g className={playing ? 'playhead playhead--live' : 'playhead'}>
          <line
            x1={layout.gutter + playheadX}
            x2={layout.gutter + playheadX}
            y1={-6}
            y2={layout.systemInnerHeight + 6}
            stroke={surface.accent}
            strokeWidth={2}
          />
          <circle cx={layout.gutter + playheadX} cy={-6} r={3.5} fill={surface.accent} />
        </g>
      )}
    </g>
  )
}

/** Whole-beat gridlines, skipping the downbeat since a barline already covers it. */
function beatTicks(start: number, end: number): number[] {
  const ticks: number[] = []
  for (let beat = Math.ceil(start); beat < end - 1e-6; beat += 1) {
    ticks.push(beat)
  }
  return ticks
}

/**
 * Which ledger lines a note needs. Lines live on even diatonic indices; middle
 * C is the lone line in the gap between the staves.
 *
 * Exported because anything drawn *over* a staff needs the same answer — a note
 * five ledger lines up is unreadable without them, and a second copy of this
 * rule would be a second chance to disagree with the staff underneath it.
 */
export function ledgerIndices(index: number): number[] {
  const out: number[] = []
  if (index === 28) return [28]
  if (index >= 40) {
    for (let i = 40; i <= index; i += 2) out.push(i)
  } else if (index <= 16) {
    for (let i = 16; i >= index; i -= 2) out.push(i)
  }
  return out
}
