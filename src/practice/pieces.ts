/**
 * Learning real pieces, piece by piece: right hand, left hand, hands together.
 *
 * The levels teach reading; this is where reading becomes repertoire. A piece
 * is cut into short sections — two bars at a time — and each section is
 * learnt the way piano teachers have always taught it: one hand alone, then
 * the other, then both at once. Every stage is an ordinary practice run over
 * an ordinary prompt, so the whole machine — the reader's own notation, the
 * ghost when stuck, the extra turns on what went wrong, the history and the
 * weaning — works on Beethoven exactly as it works on a warm-up.
 *
 * Crucially the prompt is a *slice of the real score*, not a regenerated
 * imitation: the actual rhythm, the actual beams, the actual fingering marks.
 * What you practise here is literally what the reading view will show you
 * when you play the piece whole.
 */

import { LIBRARY } from '../core/library'
import {
  beatsPerMeasure,
  keyAt,
  markBarStarts,
  tempoAt,
  timeSignatureAt,
} from '../core/types'
import type { NoteEvent, NoteType, Score } from '../core/types'
import type { Prompt } from './drills'
import type { Level } from './levels'
import type { Progress } from './progress'

export type PieceHands = 'right' | 'left' | 'both'

export interface PieceSection {
  index: number
  fromBeat: number
  toBeat: number
  /** 1-based bar numbers, for the row label. */
  firstBar: number
  lastBar: number
  label: string
}

export interface Piece {
  id: string
  title: string
  composer: string
  score: Score
  sections: PieceSection[]
}

/**
 * Two bars per section. Long enough to be music, short enough that a stumble
 * in bar seven does not cost you bars one to six — which is the entire reason
 * pieces are learnt in pieces.
 */
const BARS_PER_SECTION = 2

/** One clean read out of two. A run is the section played twice. */
export const PIECE_PASS = 0.5

const EPS = 1e-4

export const PIECES: Piece[] = LIBRARY.map(({ score }) => {
  const barBeats = beatsPerMeasure(timeSignatureAt(score, 0))
  const bars = Math.max(1, Math.round(score.length / barBeats))
  const sections: PieceSection[] = []
  for (let bar = 0, index = 0; bar < bars; bar += BARS_PER_SECTION, index += 1) {
    const lastBar = Math.min(bar + BARS_PER_SECTION, bars)
    sections.push({
      index,
      fromBeat: bar * barBeats,
      toBeat: lastBar * barBeats,
      firstBar: bar + 1,
      lastBar,
      label: lastBar === bar + 1 ? `Bar ${bar + 1}` : `Bars ${bar + 1}–${lastBar}`,
    })
  }
  return { id: score.id, title: score.title, composer: score.composer, score, sections }
})

/** The section's notes for one hand, or for both, in playing order. */
export function sectionNotes(piece: Piece, section: PieceSection, hands: PieceHands): NoteEvent[] {
  return piece.score.notes
    .filter((n) => n.onset >= section.fromBeat - EPS && n.onset < section.toBeat - EPS)
    .filter((n) => hands === 'both' || n.hand === hands)
    .sort((a, b) => a.onset - b.onset || a.midi - b.midi)
}

/**
 * Which stages a section offers.
 *
 * A hand with nothing to play in these bars — Für Elise's left hand rests
 * through the opening — simply has no stage, and "together" only exists where
 * there are two hands to put together; offering it anyway would be the same
 * exercise twice under two names.
 */
export function sectionStages(piece: Piece, section: PieceSection): PieceHands[] {
  const right = sectionNotes(piece, section, 'right').length > 0
  const left = sectionNotes(piece, section, 'left').length > 0
  const stages: PieceHands[] = []
  if (right) stages.push('right')
  if (left) stages.push('left')
  if (right && left) stages.push('both')
  return stages
}

export const stageId = (pieceId: string, sectionIndex: number, hands: PieceHands): string =>
  `piece:${pieceId}:${sectionIndex}:${hands}`

export const stageDone = (
  progress: Progress,
  piece: Piece,
  section: PieceSection,
  hands: PieceHands,
): boolean => (progress.best[stageId(piece.id, section.index, hands)] ?? 0) >= PIECE_PASS

/**
 * Hands-together waits for each hand alone.
 *
 * The one gate in the whole panel, and it is the method rather than a
 * difficulty wall: playing both hands before either one is how a section
 * becomes a thing you fight instead of a thing you know.
 */
export function stageOpen(
  progress: Progress,
  piece: Piece,
  section: PieceSection,
  hands: PieceHands,
): boolean {
  if (hands !== 'both') return true
  return stageDone(progress, piece, section, 'right') && stageDone(progress, piece, section, 'left')
}

/** Stages done and offered across a whole piece, for tallies and the finale. */
export function pieceTally(progress: Progress, piece: Piece): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const section of piece.sections) {
    for (const hands of sectionStages(piece, section)) {
      total += 1
      if (stageDone(progress, piece, section, hands)) done += 1
    }
  }
  return { done, total }
}

/** A written type for a duration that had to be re-notated after clamping. */
function typeFor(beats: number): { type: NoteType; dots: number } {
  if (beats >= 6) return { type: 'whole', dots: 1 }
  if (beats >= 4) return { type: 'whole', dots: 0 }
  if (beats >= 3) return { type: 'half', dots: 1 }
  if (beats >= 2) return { type: 'half', dots: 0 }
  if (beats >= 1.5) return { type: 'quarter', dots: 1 }
  if (beats >= 1) return { type: 'quarter', dots: 0 }
  if (beats >= 0.75) return { type: 'eighth', dots: 1 }
  if (beats >= 0.5) return { type: 'eighth', dots: 0 }
  return { type: '16th', dots: 0 }
}

/**
 * One section, one hand (or both), as an ordinary practice prompt.
 *
 * A genuine slice of the score: onsets shifted to zero, the key and time and
 * tempo that were in force carried along, and every note keeping its written
 * duration, beams and fingering. Note ids are renamed to the step-indexed
 * form the practice view lights and ghosts by, which is the whole cost of
 * admission to the existing machinery.
 */
export function sectionPrompt(piece: Piece, section: PieceSection, hands: PieceHands): Prompt {
  const from = section.fromBeat
  const chosen = sectionNotes(piece, section, hands)
  const barBeats = beatsPerMeasure(timeSignatureAt(piece.score, from))

  const onsets: number[] = []
  for (const n of chosen) {
    if (!onsets.some((o) => Math.abs(o - n.onset) < EPS)) onsets.push(n.onset)
  }
  const steps = onsets.map((o) => [
    ...new Set(chosen.filter((n) => Math.abs(n.onset - o) < EPS).map((n) => n.midi)),
  ])

  const id = `${piece.id}-${section.index}-${hands}`
  const seen = new Map<number, number>()
  const notes: NoteEvent[] = chosen.map((n) => {
    const i = onsets.findIndex((o) => Math.abs(o - n.onset) < EPS)
    const j = seen.get(i) ?? 0
    seen.set(i, j + 1)
    // A note sounding past the section's edge is cut at the edge and written
    // as the longest value that fits — the next section owns the rest of it.
    const duration = Math.min(n.duration, section.toBeat - n.onset)
    const clamped = duration < n.duration - EPS
    return {
      ...n,
      id: `${id}-${i}-${j}`,
      onset: n.onset - from,
      duration,
      measure: Math.floor((n.onset - from + EPS) / barBeats),
      ...(clamped
        ? { notated: { segments: [{ ...typeFor(duration), beats: duration }] } }
        : {}),
    }
  })
  markBarStarts(notes)

  const score: Score = {
    id: `piece-${id}`,
    title: piece.title,
    composer: piece.composer,
    notes,
    tempos: [{ beat: 0, bpm: tempoAt(piece.score, from) }],
    timeSignatures: [{ ...timeSignatureAt(piece.score, from), beat: 0 }],
    keys: [{ ...keyAt(piece.score, from), beat: 0 }],
    length: section.toBeat - from,
  }
  return { id, steps, score }
}

const HAND_NAMES: Record<PieceHands, string> = {
  right: 'right hand',
  left: 'left hand',
  both: 'hands together',
}

/**
 * A section-stage as a Level, so the run machinery needs no new ideas.
 *
 * The run is the section twice — read it, then prove it — and passing means
 * one of the two came out clean. `make` ignores the ambient key and seed on
 * purpose: a piece is in its own key, and there is nothing to vary.
 */
export function stageLevel(piece: Piece, section: PieceSection, hands: PieceHands): Level {
  const prompt = sectionPrompt(piece, section, hands)
  return {
    id: stageId(piece.id, section.index, hands),
    name: `${section.label} · ${HAND_NAMES[hands]}`,
    group: 'Pieces',
    goal: `${piece.title}, ${section.label.toLowerCase()}, ${HAND_NAMES[hands]}.`,
    pass: PIECE_PASS,
    make: () => [prompt, prompt],
  }
}

/** Whether a run id belongs to a piece stage, for the view's routing. */
export const isPieceStage = (levelId: string | undefined): boolean =>
  !!levelId && levelId.startsWith('piece:')
