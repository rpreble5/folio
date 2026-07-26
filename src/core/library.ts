/**
 * The built-in repertoire.
 *
 * A prototype with an empty state is a prototype nobody evaluates. Every one of
 * these is public domain and short enough to read in one screen, and between
 * them they cover the cases that stress a notation design: stepwise melody,
 * fast repeated chromatics, wide leaps, and a plain scale where any distortion
 * in the pitch axis becomes obvious.
 */

import { eventsFromDsl } from './dsl'
import { beatsPerMeasure } from './types'
import type { Score, TimeSignature } from './types'

interface PieceSpec {
  id: string
  title: string
  composer: string
  blurb: string
  bpm: number
  time: [number, number]
  fifths: number
  mode: 'major' | 'minor'
  right: string
  left: string
}

const SPECS: PieceSpec[] = [
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Beethoven',
    blurb: 'Stepwise and predictable. The gentlest test of whether a pitch axis reads.',
    bpm: 108,
    time: [4, 4],
    fifths: 0,
    mode: 'major',
    right: `
      E4/q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/q. D4/e D4/h |
      E4/q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/q. C4/e C4/h
    `,
    left: `
      (C3 E3 G3)/h (C3 E3 G3) | (G2 D3 G3) (C3 E3 G3) | (C3 E3 G3) (G2 D3 G3) | (C3 E3 G3) (G2 D3 G3) |
      (C3 E3 G3) (C3 E3 G3) | (G2 D3 G3) (C3 E3 G3) | (C3 E3 G3) (G2 D3 G3) | (C3 E3 G3)/w
    `,
  },
  {
    id: 'fur-elise',
    title: 'Für Elise',
    composer: 'Beethoven',
    blurb: 'Fast alternating semitones in the right hand — where colour-only encodings start to strain.',
    bpm: 72,
    time: [3, 8],
    fifths: 0,
    mode: 'minor',
    right: `
      r/s r r r E5 D#5 | E5/s D#5 E5 B4 D5 C5 | A4/e r/s C4 E4 A4 |
      B4/e r/s E4 G#4 B4 | C5/e r/s E4 E5 D#5 |
      E5/s D#5 E5 B4 D5 C5 | A4/e r/s C4 E4 A4 |
      B4/e r/s E4 C5 B4 | A4/q.
    `,
    left: `
      r/q. | r/q. | A2/s E3 A3 r r r |
      E2/s E3 G#3 r r r | A2/s E3 A3 r r r |
      r/q. | A2/s E3 A3 r r r |
      E2/s E3 G#3 r r r | A2/s E3 A3 r/e
    `,
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G',
    composer: 'Petzold',
    blurb: 'Wide leaps and two genuinely independent hands. Good for testing hand-colouring.',
    bpm: 120,
    time: [3, 4],
    fifths: 1,
    mode: 'major',
    right: `
      D5/q G4/e A4 B4 C5 | D5/q G4 G4 | E5/q C5/e D5 E5 F#5 | G5/q G4 G4 |
      C5/q D5/e C5 B4 A4 | B4/q C5/e B4 A4 G4 | F#4/q G4/e A4 B4 G4 | A4/h.
    `,
    left: `
      G3/h B3/q | A3/h B3/q | C4/h. | B3/q A3 G3 |
      A3/h. | G3/h. | D3/q D4 C4 | D4/h.
    `,
  },
  {
    id: 'scale-study',
    title: 'Scale & Arpeggio',
    composer: 'Study',
    blurb: 'Two octaves up and down, fingering included. Any kink in the pitch axis shows up here instantly.',
    bpm: 96,
    time: [4, 4],
    fifths: 0,
    mode: 'major',
    right: `
      C4:1/e D4:2 E4:3 F4:1 G4:2 A4:3 B4:4 C5:5 |
      D5:1 E5:2 F5:3 G5:4 A5:5 B5:4 C6:5 B5:4 |
      A5:3 G5:2 F5:1 E5:3 D5:2 C5:1 B4:3 A4:2 |
      G4:1 F4:3 E4:2 D4:1 C4:1/h |
      (C4 E4 G4)/q (E4 G4 C5) (G4 C5 E5) (C5 E5 G5) | (C4 E4 G4 C5)/w
    `,
    left: `
      C3/h G3 | C3 G3 | C3 G3 | C3/w |
      C2/q G2 C3 G2 | C2/w
    `,
  },
]

function buildScore(spec: PieceSpec): Score {
  const ts: TimeSignature = { beat: 0, numerator: spec.time[0], denominator: spec.time[1] }
  const bpm = beatsPerMeasure(ts)

  const notes = [
    ...eventsFromDsl(spec.right, 'right', bpm, 0.75),
    ...eventsFromDsl(spec.left, 'left', bpm, 0.6),
  ].sort((a, b) => a.onset - b.onset || a.midi - b.midi)

  const length = notes.reduce((max, n) => Math.max(max, n.onset + n.duration), 0)

  return {
    id: spec.id,
    title: spec.title,
    composer: spec.composer,
    notes,
    tempos: [{ beat: 0, bpm: spec.bpm }],
    timeSignatures: [ts],
    keys: [{ beat: 0, fifths: spec.fifths, mode: spec.mode }],
    // Round up to a whole measure so the last system does not end ragged.
    length: Math.ceil(length / bpm) * bpm,
  }
}

export interface LibraryEntry {
  score: Score
  blurb: string
}

export const LIBRARY: LibraryEntry[] = SPECS.map((spec) => ({
  score: buildScore(spec),
  blurb: spec.blurb,
}))

export function libraryEntry(id: string): LibraryEntry {
  return LIBRARY.find((e) => e.score.id === id) ?? LIBRARY[0]
}
