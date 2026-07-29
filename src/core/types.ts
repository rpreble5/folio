/**
 * Score IR — the normalized musical document.
 *
 * Every input path (MusicXML, MIDI file, the shorthand DSL, and later a live
 * MIDI stream) converges here, and every renderer reads only from here. Keeping
 * this boundary strict is what lets a new visual language be a config object
 * instead of a code change — and what will let live keyboard input reuse the
 * renderer untouched.
 */

/** Which hand/staff an event belongs to. Piano-centric for now. */
export type Hand = 'right' | 'left'

/** Letter name without accidental. */
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

/**
 * How a pitch is *written*, as distinct from how it sounds. F#4 and Gb4 are the
 * same MIDI number but different notation, and the distinction drives accidental
 * rendering, diatonic vertical placement, and scale-degree colouring. MIDI file
 * import cannot recover this, which is why MusicXML is the preferred input.
 */
export interface Spelling {
  step: Step
  /** Semitone displacement: -1 flat, 0 natural, +1 sharp. */
  alter: number
  octave: number
}

/**
 * How a note was *written*, as opposed to how long it sounds.
 *
 * The IR's `duration` is the sounding length in beats, which is all the app
 * needed to draw colour and length. Traditional notation needs the other thing:
 * a two-beat sound could be written as a half note, or as two quarters tied, or
 * as a quarter tied across a barline — identical in `duration`, three different
 * pictures. MusicXML records which one the composer wrote, and the importer used
 * to read past it.
 *
 * Undefined for MIDI and for the built-in DSL pieces, which genuinely do not
 * carry it. Anything reading this must cope with its absence rather than assume.
 */
export type NoteType =
  | 'breve'
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | '16th'
  | '32nd'
  | '64th'
  | '128th'

export type BeamState = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook'

export interface NotatedSegment {
  type: NoteType
  /** Augmentation dots. Each adds half again to the written length. */
  dots: number
  /** This segment's own sounding length in quarter-note beats. */
  beats: number
  /** Beam states by level, outermost first. Absent when unbeamed. */
  beams?: BeamState[]
}

export interface Notated {
  /**
   * One entry per written notehead. More than one means the note was tied, and
   * the entries are in playing order.
   *
   * Keeping segments rather than a single type is what lets the renderer go on
   * drawing a tie as one long shape — which is the right reading of it — while
   * still knowing it was engraved as two heads and a curve.
   */
  segments: NotatedSegment[]
  /**
   * The accidental actually printed. Distinct from `spelling.alter`, which is
   * the sounding alteration whether or not a symbol appeared — a key signature
   * sharp alters the pitch with no accidental on the note, and a courtesy
   * natural prints a symbol that alters nothing.
   */
  accidental?: string
  /** The engraver's stem direction, when the file states one. */
  stem?: 'up' | 'down' | 'none' | 'double'
}

export interface NoteEvent {
  id: string
  /** Start time in quarter-note beats from the top of the piece. */
  onset: number
  /** Length in quarter-note beats. Ties are already merged into this. */
  duration: number
  /** MIDI note number. 60 = middle C. */
  midi: number
  spelling: Spelling
  hand: Hand
  /** Independent melodic line within a hand. Used to disambiguate overlaps. */
  voice: number
  /** Zero-based measure index, for measure markers and section looping. */
  measure: number
  /** 0..1 velocity-ish. Available as an encodable dimension. */
  velocity: number
  /** True for the earliest note of its bar, so labels can mark bar starts. */
  firstInBar?: boolean
  /** How this note was written, when the source said. See Notated. */
  notated?: Notated
  /** Optional performance hints, encodable as visual channels. */
  finger?: number
  articulation?: 'staccato' | 'accent' | 'tenuto'
}

export interface TempoMark {
  /** Beat position where this tempo takes effect. */
  beat: number
  bpm: number
}

export interface TimeSignature {
  beat: number
  numerator: number
  denominator: number
}

export interface KeyMark {
  beat: number
  /** Circle-of-fifths position: -7..7. Negative = flats. */
  fifths: number
  mode: 'major' | 'minor'
}

export interface Score {
  id: string
  title: string
  composer: string
  notes: NoteEvent[]
  tempos: TempoMark[]
  timeSignatures: TimeSignature[]
  keys: KeyMark[]
  /** Total length in beats. */
  length: number
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function tempoAt(score: Score, beat: number): number {
  let bpm = score.tempos[0]?.bpm ?? 100
  for (const t of score.tempos) {
    if (t.beat <= beat) bpm = t.bpm
    else break
  }
  return bpm
}

export function keyAt(score: Score, beat: number): KeyMark {
  let key = score.keys[0] ?? { beat: 0, fifths: 0, mode: 'major' as const }
  for (const k of score.keys) {
    if (k.beat <= beat) key = k
    else break
  }
  return key
}

export function timeSignatureAt(score: Score, beat: number): TimeSignature {
  let ts = score.timeSignatures[0] ?? { beat: 0, numerator: 4, denominator: 4 }
  for (const t of score.timeSignatures) {
    if (t.beat <= beat) ts = t
    else break
  }
  return ts
}

/** Beats per measure at a given point, in quarter-note units. */
export function beatsPerMeasure(ts: TimeSignature): number {
  return ts.numerator * (4 / ts.denominator)
}

/** Convert a beat position to seconds, honouring every tempo change before it. */
export function beatToSeconds(score: Score, beat: number): number {
  let seconds = 0
  let cursor = 0
  let bpm = score.tempos[0]?.bpm ?? 100

  for (const t of score.tempos) {
    if (t.beat >= beat) break
    if (t.beat > cursor) {
      seconds += ((t.beat - cursor) * 60) / bpm
      cursor = t.beat
    }
    bpm = t.bpm
  }
  seconds += ((beat - cursor) * 60) / bpm
  return seconds
}

/** Inverse of {@link beatToSeconds}. Used to drive the playhead. */
export function secondsToBeat(score: Score, seconds: number): number {
  let beat = 0
  let elapsed = 0
  let bpm = score.tempos[0]?.bpm ?? 100

  for (const t of score.tempos) {
    if (t.beat <= beat) {
      bpm = t.bpm
      continue
    }
    const spanSeconds = ((t.beat - beat) * 60) / bpm
    if (elapsed + spanSeconds >= seconds) return beat + ((seconds - elapsed) * bpm) / 60
    elapsed += spanSeconds
    beat = t.beat
    bpm = t.bpm
  }
  return beat + ((seconds - elapsed) * bpm) / 60
}

/**
 * Mark the first note of each bar. Done once when a score is built rather than
 * per render, since it depends only on the notes themselves.
 */
export function markBarStarts(notes: NoteEvent[]): void {
  const earliest = new Map<number, number>()
  for (const n of notes) {
    const at = earliest.get(n.measure)
    if (at === undefined || n.onset < at - 1e-6) earliest.set(n.measure, n.onset)
  }
  for (const n of notes) {
    n.firstInBar = Math.abs(n.onset - (earliest.get(n.measure) ?? -1)) < 1e-6
  }
}

export function pitchRange(score: Score): { min: number; max: number } {
  if (score.notes.length === 0) return { min: 60, max: 72 }
  let min = Infinity
  let max = -Infinity
  for (const n of score.notes) {
    if (n.midi < min) min = n.midi
    if (n.midi > max) max = n.midi
  }
  return { min, max }
}
