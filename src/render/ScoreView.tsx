import { useMemo } from 'react'
import type { Score } from '../core/types'
import { diatonicIndex, keyboardPosition, octaveOf, pitchClass } from '../core/pitch'
import type { LineRole, LineStyle, Surface, Theme } from '../core/theme'
import { dashArray, lineColor } from '../core/theme'
import type { Layout, System } from './layout'
import { NoteGlyph } from './NoteGlyph'
import { CvdFilters, cvdFilterUrl, type CvdMode } from './cvd'

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
}

const BASS_STAFF = [18, 20, 22, 24, 26]
const TREBLE_STAFF = [30, 32, 34, 36, 38]

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

  return (
    <svg
      className="score"
      width={layout.width}
      height={layout.height + 24}
      viewBox={`0 0 ${layout.width} ${layout.height + 24}`}
      role="img"
      aria-label={`${score.title} by ${score.composer}, rendered in the ${theme.name} style`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectNote(null)
      }}
    >
      <CvdFilters />

      <rect width="100%" height="100%" fill={surface.background} />

      <g filter={filter}>
        {layout.systems.map((system) => (
          <SystemGroup
            key={system.index}
            system={system}
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
        ))}
      </g>
    </svg>
  )
}

interface SystemProps {
  system: System
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
    <g transform={`translate(0, ${system.top})`}>
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

      {/* Staff lines */}
      {isStaff && cfg.lines.staff.show &&
        [...BASS_STAFF, ...TREBLE_STAFF].map((index) => (
          <line
            key={`staff-${index}`}
            x1={layout.gutter}
            x2={layout.gutter + systemWidth}
            y1={yFor(index) + layout.noteHeight / 2}
            y2={yFor(index) + layout.noteHeight / 2}
            {...strokeProps(cfg.lines.staff, 'staff', surface)}
          />
        ))}

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
              />
              {placed.style.labelText && layout.noteHeight >= 10 && (
                <text
                  x={placed.x + Math.min(placed.height, placed.width) / 2}
                  y={placed.y + placed.height / 2 + labelSize * 0.35}
                  fill={placed.style.labelColor}
                  fontSize={labelSize}
                  fontWeight={650}
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
