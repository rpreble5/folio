/**
 * MusicXML → Score IR.
 *
 * MusicXML is the preferred input because it carries what MIDI throws away:
 * how a note is *spelled* (F♯ vs G♭), which staff and voice it belongs to,
 * fingering, articulation, and how the note was *written* — a two-beat sound as
 * one half note or as two tied quarters. All of that is encodable as a visual
 * channel, so losing it would quietly shrink what a user can design with.
 *
 * Deliberately unhandled for now: grace notes (no duration to place them in),
 * tuplet bracketing (the ratio is already baked into <duration>), and
 * score-timewise files (vanishingly rare in the wild).
 */

import type {
  BeamState,
  Hand,
  KeyMark,
  Notated,
  NotatedSegment,
  NoteEvent,
  NoteType,
  Score,
  Spelling,
  Step,
  TempoMark,
  TimeSignature,
} from '../core/types'
import { markBarStarts } from '../core/types'
import { spellingToMidi } from '../core/pitch'

const num = (el: Element | null | undefined, fallback = 0): number => {
  const text = el?.textContent?.trim()
  if (!text) return fallback
  const value = Number(text)
  return Number.isFinite(value) ? value : fallback
}

const text = (el: Element | null | undefined): string => el?.textContent?.trim() ?? ''

interface PendingTie {
  key: string
  index: number
}

export function parseMusicXml(xml: string): Score {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('This file is not valid XML.')

  const root = doc.querySelector('score-partwise')
  if (!root) {
    throw new Error(
      doc.querySelector('score-timewise')
        ? 'Timewise MusicXML is not supported — re-export as partwise.'
        : 'This does not look like a MusicXML score.',
    )
  }

  const title =
    text(doc.querySelector('work > work-title')) ||
    text(doc.querySelector('movement-title')) ||
    'Untitled'
  const composer =
    text(doc.querySelector('identification > creator[type="composer"]')) ||
    text(doc.querySelector('identification > creator')) ||
    'Unknown'

  const notes: NoteEvent[] = []
  const tempos: TempoMark[] = []
  const timeSignatures: TimeSignature[] = []
  const keys: KeyMark[] = []

  const parts = Array.from(root.querySelectorAll(':scope > part'))
  let idCounter = 0

  parts.forEach((part, partIndex) => {
    let divisions = 1
    let staves = 1
    let measureStart = 0
    const pendingTies = new Map<string, PendingTie>()

    const measures = Array.from(part.querySelectorAll(':scope > measure'))

    measures.forEach((measure, measureIndex) => {
      let cursor = measureStart
      let measureEnd = measureStart
      // Chord notes attach to whatever came immediately before them, so the
      // previous onset has to survive across siblings.
      let lastOnset = measureStart

      for (const child of Array.from(measure.children)) {
        switch (child.tagName) {
          case 'attributes': {
            const div = child.querySelector('divisions')
            if (div) divisions = num(div, divisions) || 1

            const stavesEl = child.querySelector('staves')
            if (stavesEl) staves = num(stavesEl, 1) || 1

            const key = child.querySelector('key')
            if (key && partIndex === 0) {
              keys.push({
                beat: cursor,
                fifths: num(key.querySelector('fifths')),
                mode: text(key.querySelector('mode')) === 'minor' ? 'minor' : 'major',
              })
            }

            const time = child.querySelector('time')
            if (time && partIndex === 0) {
              timeSignatures.push({
                beat: cursor,
                numerator: num(time.querySelector('beats'), 4) || 4,
                denominator: num(time.querySelector('beat-type'), 4) || 4,
              })
            }
            break
          }

          case 'direction': {
            const sound = child.querySelector('sound[tempo]')
            const perMinute = child.querySelector('metronome > per-minute')
            const bpm = sound
              ? Number(sound.getAttribute('tempo'))
              : perMinute
                ? num(perMinute)
                : NaN
            if (Number.isFinite(bpm) && bpm > 0) tempos.push({ beat: cursor, bpm })
            break
          }

          case 'sound': {
            const bpm = Number(child.getAttribute('tempo'))
            if (Number.isFinite(bpm) && bpm > 0) tempos.push({ beat: cursor, bpm })
            break
          }

          case 'backup':
            cursor -= num(child.querySelector('duration')) / divisions
            break

          case 'forward':
            cursor += num(child.querySelector('duration')) / divisions
            break

          case 'note': {
            // Grace notes carry no <duration>; placing them would require
            // stealing time from a neighbour, so they are dropped for now.
            if (child.querySelector('grace')) break

            const duration = num(child.querySelector('duration')) / divisions
            const isChord = child.querySelector('chord') !== null
            const onset = isChord ? lastOnset : cursor

            if (child.querySelector('rest')) {
              cursor += duration
              measureEnd = Math.max(measureEnd, cursor)
              break
            }

            const pitchEl = child.querySelector('pitch')
            if (!pitchEl) {
              if (!isChord) cursor += duration
              break
            }

            const spelling: Spelling = {
              step: (text(pitchEl.querySelector('step')) || 'C') as Step,
              alter: num(pitchEl.querySelector('alter')),
              octave: num(pitchEl.querySelector('octave'), 4),
            }
            const midi = spellingToMidi(spelling)
            const staff = num(child.querySelector('staff'), 1) || 1
            const voice = num(child.querySelector('voice'), 1) || 1
            const hand = assignHand(midi, staff, staves, partIndex, parts.length)

            const tieKey = `${midi}:${voice}:${staff}`
            const stopsTie = child.querySelector('tie[type="stop"], tied[type="stop"]') !== null
            const startsTie = child.querySelector('tie[type="start"], tied[type="start"]') !== null

            if (stopsTie) {
              const pending = pendingTies.get(tieKey)
              if (pending !== undefined) {
                // Extend the held note rather than emitting a second one, so a
                // tie reads as one long shape instead of two abutting ones. The
                // written head is still recorded, so a notation renderer can
                // put the two heads and the curve back.
                const held = notes[pending.index]
                held.duration += duration
                held.notated?.segments.push(readSegment(child, duration))
                if (!startsTie) pendingTies.delete(tieKey)
                if (!isChord) cursor += duration
                measureEnd = Math.max(measureEnd, cursor)
                lastOnset = onset
                break
              }
            }

            idCounter += 1
            const dynamic = child.querySelector('notations > dynamics')
            notes.push({
              id: `x${idCounter}`,
              onset,
              duration,
              midi,
              spelling,
              hand,
              voice,
              measure: measureIndex,
              velocity: dynamic ? 0.9 : 0.7,
              notated: readNotated(child, duration),
              finger: num(child.querySelector('technical > fingering'), 0) || undefined,
              articulation: readArticulation(child),
            })

            if (startsTie) pendingTies.set(tieKey, { key: tieKey, index: notes.length - 1 })

            if (!isChord) cursor += duration
            measureEnd = Math.max(measureEnd, cursor)
            lastOnset = onset
            break
          }
        }
      }

      // Honour whatever the measure actually filled, so pickup bars and
      // irregular measures do not drift the timeline.
      measureStart = Math.max(measureEnd, cursor)
    })
  })

  markBarStarts(notes)

  notes.sort((a, b) => a.onset - b.onset || a.midi - b.midi)

  const length = notes.reduce((max, n) => Math.max(max, n.onset + n.duration), 0)

  return {
    id: `import-${Date.now().toString(36)}`,
    title,
    composer,
    notes,
    tempos: tempos.length ? dedupeByBeat(tempos) : [{ beat: 0, bpm: 100 }],
    timeSignatures: timeSignatures.length
      ? dedupeByBeat(timeSignatures)
      : [{ beat: 0, numerator: 4, denominator: 4 }],
    keys: keys.length ? dedupeByBeat(keys) : [{ beat: 0, fifths: 0, mode: 'major' }],
    length,
  }
}

/**
 * Written length of each note type, in quarter-note beats.
 *
 * Ordered longest first only so `inferType` walks it predictably; nothing else
 * depends on the order. MusicXML's `long` and `maxima` are folded into `breve`
 * because nothing downstream draws them differently, and anything shorter than
 * a 128th is folded the other way for the same reason.
 */
const TYPE_BEATS: ReadonlyArray<readonly [NoteType, number]> = [
  ['breve', 8],
  ['whole', 4],
  ['half', 2],
  ['quarter', 1],
  ['eighth', 0.5],
  ['16th', 0.25],
  ['32nd', 0.125],
  ['64th', 0.0625],
  ['128th', 0.03125],
]

const TYPE_ALIASES: Record<string, NoteType> = {
  maxima: 'breve',
  long: 'breve',
  breve: 'breve',
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  '16th': '16th',
  '32nd': '32nd',
  '64th': '64th',
  '128th': '128th',
  '256th': '128th',
  '512th': '128th',
  '1024th': '128th',
}

const BEAM_STATES = new Set<string>([
  'begin',
  'continue',
  'end',
  'forward hook',
  'backward hook',
])

const STEM_DIRECTIONS = new Set<string>(['up', 'down', 'none', 'double'])

/** What the engraver printed, as far as the file says it. */
function readNotated(note: Element, beats: number): Notated {
  const notated: Notated = { segments: [readSegment(note, beats)] }

  const accidental = text(note.querySelector(':scope > accidental'))
  if (accidental) notated.accidental = accidental

  const stem = text(note.querySelector(':scope > stem'))
  if (STEM_DIRECTIONS.has(stem)) notated.stem = stem as Notated['stem']

  return notated
}

/**
 * One written notehead.
 *
 * `<type>` is optional in MusicXML — a few exporters and most hand-written files
 * omit it — so the sounding length is the fallback. That inference is only ever
 * a guess about *spelling*, never about time: `beats` is what the file said, and
 * it is what the app draws.
 */
function readSegment(note: Element, beats: number): NotatedSegment {
  const written = TYPE_ALIASES[text(note.querySelector(':scope > type'))]
  const dots = note.querySelectorAll(':scope > dot').length
  const beams = readBeams(note)

  const segment: NotatedSegment = written
    ? { type: written, dots, beats }
    : { ...inferType(beats), beats }
  if (beams) segment.beams = beams
  return segment
}

/**
 * Beam states, outermost beam first.
 *
 * MusicXML numbers beams from 1 (the eighth-note beam) outwards and may skip a
 * level in malformed files; a skipped level is filled with `continue`, which is
 * the only reading that keeps the outer beams unbroken.
 */
function readBeams(note: Element): BeamState[] | undefined {
  const elements = Array.from(note.querySelectorAll(':scope > beam'))
  if (!elements.length) return undefined

  const byLevel: BeamState[] = []
  for (const element of elements) {
    const state = text(element)
    if (!BEAM_STATES.has(state)) continue
    const level = Math.max(1, Math.round(Number(element.getAttribute('number') ?? 1) || 1))
    byLevel[level - 1] = state as BeamState
  }

  if (!byLevel.length) return undefined
  return Array.from(byLevel, state => state ?? 'continue')
}

/** The shortest written value that accounts for a sounding length. */
function inferType(beats: number): { type: NoteType; dots: number } {
  let best: { type: NoteType; dots: number } = { type: 'quarter', dots: 0 }
  let closest = Infinity

  for (const [type, base] of TYPE_BEATS) {
    for (let dots = 0; dots <= 2; dots += 1) {
      // A dot adds half again, a second dot half of that: base * (2 - 2^-dots).
      const written = base * (2 - 2 ** -dots)
      const error = Math.abs(written - beats)
      if (error < closest - 1e-9) {
        closest = error
        best = { type, dots }
      }
    }
  }

  return best
}

function readArticulation(note: Element): NoteEvent['articulation'] {
  if (note.querySelector('articulations > staccato')) return 'staccato'
  if (note.querySelector('articulations > accent')) return 'accent'
  if (note.querySelector('articulations > tenuto')) return 'tenuto'
  return undefined
}

/**
 * Decide which hand a note belongs to.
 *
 * Grand-staff scores say so explicitly via <staff>. Scores that split the hands
 * into separate <part>s do not, so fall back to part order, and finally to
 * middle C — crude, but only reached for single-staff imports where the
 * distinction is mostly cosmetic anyway.
 */
function assignHand(
  midi: number,
  staff: number,
  staves: number,
  partIndex: number,
  partCount: number,
): Hand {
  if (staves > 1) return staff >= 2 ? 'left' : 'right'
  if (partCount > 1) return partIndex >= 1 ? 'left' : 'right'
  return midi < 60 ? 'left' : 'right'
}

/** Keep the last entry at each beat; repeated attributes are common and harmless. */
function dedupeByBeat<T extends { beat: number }>(items: T[]): T[] {
  const byBeat = new Map<number, T>()
  for (const item of items) byBeat.set(item.beat, item)
  return Array.from(byBeat.values()).sort((a, b) => a.beat - b.beat)
}
