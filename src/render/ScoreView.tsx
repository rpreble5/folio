import { useMemo } from 'react'
import type { Score } from '../core/types'
import { diatonicIndex, keyboardPosition, octaveOf, pitchClass } from '../core/pitch'
import type { LineRole, LineStyle, Surface, Theme } from '../core/theme'
import type { LabelPlace } from '../core/theme'
import { NO_TEXTURE, dashArray, fontStack, lineColor, staffLineStyle } from '../core/theme'
import type { Layout, System } from './layout'
import { NoteGlyph } from './NoteGlyph'
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
function strokeProps(line: LineStyle, role: LineRole, surface: Surface) {
  return {
    stroke: lineColor(line, role, surface),
    strokeWidth: line.width,
    strokeDasharray: dashArray(line.dash, line.width),
    opacity: line.opacity,
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

  const filter = cvdFilterUrl(cvd)
  const pageFill = textureFill(cfg.pageTexture)

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
              />
            )
          })}
      </g>
    </svg>
  )
}

interface SystemProps {
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
}

function SystemGroup({
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
}: SystemProps) {
  const { surface, layout: cfg, encodings } = theme
  const systemWidth = (system.endBeat - system.startBeat) * layout.beatWidth
  const inSystem =
    playheadBeat >= system.startBeat - 1e-6 && playheadBeat < system.endBeat - 1e-6
  const playheadX = (playheadBeat - system.startBeat) * layout.beatWidth

  const labelSize = Math.max(7, Math.min(layout.noteHeight * 0.62, 13)) * encodings.labelScale

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

      {/* Staff lines, each able to override the shared style. */}
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
              {...strokeProps(style, 'staff', surface)}
            />
          )
        })}

      {/* Beat grid */}
      {cfg.lines.beat.show &&
        beatTicks(system.startBeat, system.endBeat).map((beat) => (
          <line
            key={`grid-${beat}`}
            x1={layout.gutter + (beat - system.startBeat) * layout.beatWidth}
            x2={layout.gutter + (beat - system.startBeat) * layout.beatWidth}
            y1={0}
            y2={layout.systemInnerHeight}
            {...strokeProps(cfg.lines.beat, 'beat', surface)}
          />
        ))}

      {/* Barlines and measure numbers */}
      {cfg.lines.bar.show &&
        system.measures.map((measure) => (
          <g key={`bar-${measure.index}`}>
            <line
              x1={layout.gutter + measure.x}
              x2={layout.gutter + measure.x}
              y1={-4}
              y2={layout.systemInnerHeight + 4}
              {...strokeProps(cfg.lines.bar, 'bar', surface)}
            />
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
              x1={layout.gutter + placed.x - 4}
              x2={layout.gutter + placed.x + Math.max(placed.width, layout.noteHeight) + 4}
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
                  fontFamily={fontStack(encodings.labelFont)}
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
 */
function ledgerIndices(index: number): number[] {
  const out: number[] = []
  if (index === 28) return [28]
  if (index >= 40) {
    for (let i = 40; i <= index; i += 2) out.push(i)
  } else if (index <= 16) {
    for (let i = 16; i >= index; i -= 2) out.push(i)
  }
  return out
}
