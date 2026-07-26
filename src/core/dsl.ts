/**
 * A tiny text notation, used to author the built-in library.
 *
 * Real pieces arrive as MusicXML or MIDI. This exists so the demo repertoire is
 * legible in source and diffable, instead of a wall of encoded blobs — and it
 * doubles as the quickest way to hand-write a test case.
 *
 *   C4 D4 E4          three quarter notes (duration persists between tokens)
 *   G4/h A4           a half note, then another half note
 *   F#3 Bb2           accidentals, either spelling
 *   (C4 E4 G4)/w      a chord
 *   r/e               an eighth rest
 *   C4:1              fingering
 *   |                 barline, ignored by the parser but kept for readability
 *
 * Durations: w h q e s t  (whole … thirty-second), suffix `.` to dot.
 */

import type { Hand, NoteEvent, Spelling, Step } from './types'
import { spellingToMidi } from './pitch'

const DURATIONS: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125 }

interface ParsedEvent {
  pitches: Spelling[]
  fingers: (number | undefined)[]
  duration: number
  isRest: boolean
}

function parseDuration(code: string | undefined, fallback: number): number {
  if (!code) return fallback
  let dots = 0
  let base = code
  while (base.endsWith('.')) {
    dots += 1
    base = base.slice(0, -1)
  }
  const value = DURATIONS[base]
  if (value === undefined) throw new Error(`Unknown duration "${code}"`)
  // Each dot adds half of what came before it.
  let total = value
  let add = value
  for (let i = 0; i < dots; i++) {
    add /= 2
    total += add
  }
  return total
}

function parsePitch(token: string): { spelling: Spelling; finger?: number } {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2}|)(-?\d)(?::([1-5]))?$/.exec(token)
  if (!m) throw new Error(`Unparseable pitch "${token}"`)
  const step = m[1].toUpperCase() as Step
  const accidental = m[2]
  const alter = accidental.startsWith('#') ? accidental.length : accidental.startsWith('b') ? -accidental.length : 0
  return {
    spelling: { step, alter, octave: parseInt(m[3], 10) },
    finger: m[4] ? parseInt(m[4], 10) : undefined,
  }
}

/** Split on whitespace but keep parenthesised chords together. */
function tokenize(src: string): string[] {
  const cleaned = src.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens: string[] = []
  let i = 0
  while (i < cleaned.length) {
    if (cleaned[i] === ' ') {
      i += 1
      continue
    }
    if (cleaned[i] === '(') {
      const close = cleaned.indexOf(')', i)
      if (close === -1) throw new Error('Unclosed chord bracket')
      let end = close + 1
      while (end < cleaned.length && cleaned[end] !== ' ') end += 1
      tokens.push(cleaned.slice(i, end))
      i = end
      continue
    }
    let end = cleaned.indexOf(' ', i)
    if (end === -1) end = cleaned.length
    tokens.push(cleaned.slice(i, end))
    i = end
  }
  return tokens
}

function parseEvents(src: string): ParsedEvent[] {
  const events: ParsedEvent[] = []
  let running = 1 // default quarter

  for (const token of tokenize(src)) {
    const slash = token.lastIndexOf('/')
    // A slash inside a chord's parentheses would be a syntax error anyway, so a
    // slash after the closing bracket is the only meaningful one.
    const hasDuration = slash > token.lastIndexOf(')')
    const body = hasDuration ? token.slice(0, slash) : token
    const duration = parseDuration(hasDuration ? token.slice(slash + 1) : undefined, running)
    running = duration

    if (body === 'r' || body === 'R') {
      events.push({ pitches: [], fingers: [], duration, isRest: true })
      continue
    }

    const parts = body.startsWith('(') ? body.slice(1, -1).trim().split(/\s+/) : [body]
    const parsed = parts.map(parsePitch)
    events.push({
      pitches: parsed.map((p) => p.spelling),
      fingers: parsed.map((p) => p.finger),
      duration,
      isRest: false,
    })
  }
  return events
}

let idCounter = 0

export function eventsFromDsl(
  src: string,
  hand: Hand,
  beatsPerMeasure: number,
  velocity = 0.7,
): NoteEvent[] {
  const notes: NoteEvent[] = []
  let onset = 0

  for (const ev of parseEvents(src)) {
    if (!ev.isRest) {
      ev.pitches.forEach((spelling, i) => {
        idCounter += 1
        notes.push({
          id: `n${idCounter}`,
          onset,
          duration: ev.duration,
          midi: spellingToMidi(spelling),
          spelling,
          hand,
          voice: hand === 'right' ? 1 : 2,
          measure: Math.floor(onset / beatsPerMeasure),
          velocity,
          finger: ev.fingers[i],
        })
      })
    }
    onset += ev.duration
  }
  return notes
}
