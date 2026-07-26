/**
 * Layout: Score + Theme + available width → positioned systems.
 *
 * Music wraps into rows the way text wraps into lines, and building that in
 * from the start is what makes the eventual live mode tractable: when a
 * Bluetooth keyboard is driving the display, "advance the page" becomes
 * "reveal the next system", which is a continuous move rather than a discrete
 * flip that has to be timed correctly.
 *
 * Pure function of its inputs, with no React or DOM dependency, so it can be
 * unit-tested and later moved to a worker if scores get long.
 */

import type { KeyMark, NoteEvent, Score } from '../core/types'
import { beatsPerMeasure, keyAt, timeSignatureAt } from '../core/types'
import { diatonicIndex, isBlackKey, keyboardPosition } from '../core/pitch'
import type { ResolvedStyle, Theme } from '../core/theme'
import { resolveStyle } from '../core/theme'

export interface PlacedNote {
  note: NoteEvent
  x: number
  y: number
  width: number
  height: number
  style: ResolvedStyle
  /** True when the note is a black key — used for subtle depth cues. */
  black: boolean
}

export interface Measure {
  index: number
  startBeat: number
  endBeat: number
}

export interface PlacedMeasure extends Measure {
  x: number
  width: number
}

export interface System {
  index: number
  startBeat: number
  endBeat: number
  /** Top edge within the full scroll canvas. */
  top: number
  height: number
  notes: PlacedNote[]
  measures: PlacedMeasure[]
}

export interface StaffLine {
  /** Vertical offset within a system. */
  y: number
  strong: boolean
}

export interface KeyRow {
  y: number
  height: number
  black: boolean
  midi: number
}

export interface Layout {
  systems: System[]
  width: number
  height: number
  gutter: number
  laneHeight: number
  noteHeight: number
  /** Vertical offset within a system for the given axis position. */
  axisMin: number
  axisMax: number
  staffLines: StaffLine[]
  keyRows: KeyRow[]
  beatWidth: number
  systemInnerHeight: number
}

/** Where a pitch sits on the vertical axis, in axis units (higher = higher pitch). */
function axisPosition(note: NoteEvent, theme: Theme): number {
  switch (theme.layout.pitchAxis) {
    case 'keyboard':
      return keyboardPosition(note.midi)
    case 'chromatic':
      return note.midi
    case 'diatonic':
      return diatonicIndex(note.spelling)
  }
}

function axisPositionForMidi(midi: number, theme: Theme): number {
  switch (theme.layout.pitchAxis) {
    case 'keyboard':
      return keyboardPosition(midi)
    case 'chromatic':
      return midi
    case 'diatonic':
      // Approximate — only used for backdrop rows, never for note placement.
      return Math.round(((midi - 12) * 7) / 12)
  }
}

/** Grand staff, as diatonic indices. Bass G2–A3, treble E4–F5. */
const BASS_STAFF = [18, 20, 22, 24, 26]
const TREBLE_STAFF = [30, 32, 34, 36, 38]

function buildMeasures(score: Score): Measure[] {
  const measures: Measure[] = []
  let beat = 0
  let index = 0
  const total = Math.max(score.length, 1)

  while (beat < total - 1e-6 && index < 2000) {
    const length = beatsPerMeasure(timeSignatureAt(score, beat))
    measures.push({ index, startBeat: beat, endBeat: beat + length })
    beat += length
    index += 1
  }
  if (measures.length === 0) measures.push({ index: 0, startBeat: 0, endBeat: 4 })
  return measures
}

export function layoutScore(score: Score, theme: Theme, availableWidth: number): Layout {
  const { layout: cfg } = theme
  const isStaff = cfg.mode === 'staff'

  const gutter = cfg.showKeyboard && !isStaff ? 52 : 20
  const rightPad = 16
  const contentWidth = Math.max(220, availableWidth - gutter - rightPad)

  // --- Vertical axis -------------------------------------------------------
  let axisMin = Infinity
  let axisMax = -Infinity
  for (const note of score.notes) {
    const pos = axisPosition(note, theme)
    if (pos < axisMin) axisMin = pos
    if (pos > axisMax) axisMax = pos
  }
  if (!Number.isFinite(axisMin)) {
    axisMin = isStaff ? 18 : 0
    axisMax = isStaff ? 38 : 12
  }

  if (isStaff) {
    // Always show the full grand staff, even for a piece that never leaves the
    // treble — a staff with a missing half reads as broken, not as economical.
    axisMin = Math.min(axisMin, BASS_STAFF[0])
    axisMax = Math.max(axisMax, TREBLE_STAFF[4])
  }

  const pad = isStaff ? 3 : 1.5
  axisMin -= pad
  axisMax += pad

  const laneHeight = cfg.laneHeight
  const noteHeight = laneHeight * (isStaff ? 1.85 : 0.86)
  const systemInnerHeight = (axisMax - axisMin) * laneHeight + noteHeight
  const yFor = (pos: number) => (axisMax - pos) * laneHeight

  // --- Horizontal wrapping -------------------------------------------------
  const measures = buildMeasures(score)
  const beatWidth = cfg.beatWidth

  const systems: System[] = []
  let current: Measure[] = []
  let currentWidth = 0

  const flush = () => {
    if (current.length === 0) return
    systems.push({
      index: systems.length,
      startBeat: current[0].startBeat,
      endBeat: current[current.length - 1].endBeat,
      top: 0,
      height: 0,
      notes: [],
      measures: [],
    })
    current = []
    currentWidth = 0
  }

  for (const measure of measures) {
    const width = (measure.endBeat - measure.startBeat) * beatWidth
    // Always take at least one measure, however narrow the viewport gets.
    if (current.length > 0 && currentWidth + width > contentWidth) flush()
    current.push(measure)
    currentWidth += width
  }
  flush()

  // --- Place measures and notes -------------------------------------------
  const measureBySystem = new Map<number, Measure[]>()
  {
    let cursor = 0
    for (const system of systems) {
      const owned: Measure[] = []
      while (cursor < measures.length && measures[cursor].startBeat < system.endBeat - 1e-6) {
        owned.push(measures[cursor])
        cursor += 1
      }
      measureBySystem.set(system.index, owned)
    }
  }

  // Bar numbers are drawn above each system, so the first one needs headroom or
  // it renders outside the SVG and silently disappears.
  let top = 20
  for (const system of systems) {
    system.top = top
    system.height = systemInnerHeight
    let x = 0
    for (const measure of measureBySystem.get(system.index) ?? []) {
      const width = (measure.endBeat - measure.startBeat) * beatWidth
      system.measures.push({ ...measure, x, width })
      x += width
    }
    top += systemInnerHeight + cfg.systemGap
  }

  const systemFor = (beat: number): System | undefined =>
    systems.find((s) => beat >= s.startBeat - 1e-6 && beat < s.endBeat - 1e-6) ??
    (beat >= (systems.at(-1)?.endBeat ?? 0) ? systems.at(-1) : systems[0])

  for (const note of score.notes) {
    const system = systemFor(note.onset)
    if (!system) continue

    const key = keyAt(score, note.onset)
    const style = resolveStyle(note, theme, key)
    const x = (note.onset - system.startBeat) * beatWidth
    // Clip a note that runs past the end of its system rather than letting it
    // bleed into the gutter. Ties across systems are a later refinement.
    const rawWidth = note.duration * beatWidth - cfg.noteGap
    const maxWidth = (system.endBeat - note.onset) * beatWidth - cfg.noteGap
    const width = Math.max(isStaff ? noteHeight : 6, Math.min(rawWidth, maxWidth))
    const height = noteHeight * style.scale

    system.notes.push({
      note,
      x,
      y: yFor(axisPosition(note, theme)) - height / 2 + noteHeight / 2,
      width: isStaff ? Math.max(width, noteHeight * 1.1) : width,
      height,
      style,
      black: isBlackKey(note.midi),
    })
  }

  // --- Backdrop ------------------------------------------------------------
  const staffLines: StaffLine[] = []
  if (isStaff && cfg.showStaffLines) {
    for (const index of [...BASS_STAFF, ...TREBLE_STAFF]) {
      staffLines.push({ y: yFor(index) + noteHeight / 2, strong: false })
    }
  }

  // Populated for every roll layout, not just shaded ones — the side keyboard
  // reads from the same rows, and gating both on one flag made the keyboard
  // vanish whenever the shading was turned off.
  const keyRows: KeyRow[] = []
  if (!isStaff) {
    const lowMidi = Math.floor(midiForAxis(axisMin, theme))
    const highMidi = Math.ceil(midiForAxis(axisMax, theme))
    for (let midi = lowMidi; midi <= highMidi; midi++) {
      const pos = axisPositionForMidi(midi, theme)
      if (pos < axisMin || pos > axisMax) continue
      keyRows.push({
        y: yFor(pos),
        height: noteHeight,
        black: isBlackKey(midi),
        midi,
      })
    }
  }

  const height = systems.length
    ? systems[systems.length - 1].top + systemInnerHeight + 20
    : systemInnerHeight + 40

  return {
    systems,
    width: gutter + contentWidth + rightPad,
    height,
    gutter,
    laneHeight,
    noteHeight,
    axisMin,
    axisMax,
    staffLines,
    keyRows,
    beatWidth,
    systemInnerHeight,
  }
}

/** Inverse of the axis mapping, approximate — only used to bound backdrop rows. */
function midiForAxis(pos: number, theme: Theme): number {
  switch (theme.layout.pitchAxis) {
    case 'keyboard':
      return (pos * 12) / 7 + 12
    case 'chromatic':
      return pos
    case 'diatonic':
      return (pos * 12) / 7 + 12
  }
}

/** Locate the playhead: which system, and how far across it. */
export function playheadAt(
  layout: Layout,
  beat: number,
): { system: System; x: number } | null {
  for (const system of layout.systems) {
    if (beat >= system.startBeat - 1e-6 && beat < system.endBeat - 1e-6) {
      return { system, x: (beat - system.startBeat) * layout.beatWidth }
    }
  }
  const last = layout.systems.at(-1)
  if (last && beat >= last.endBeat) {
    return { system: last, x: (last.endBeat - last.startBeat) * layout.beatWidth }
  }
  return null
}

export function currentKey(score: Score, beat: number): KeyMark {
  return keyAt(score, beat)
}
