/**
 * MusicXML → Score IR.
 *
 * MusicXML is the preferred input because it carries what MIDI throws away:
 * how a note is *spelled* (F♯ vs G♭), which staff and voice it belongs to,
 * fingering, and articulation. All of that is encodable as a visual channel, so
 * losing it would quietly shrink what a user can design with.
 *
 * Deliberately unhandled for now: grace notes (no duration to place them in),
 * tuplet bracketing (the ratio is already baked into <duration>), and
 * score-timewise files (vanishingly rare in the wild).
 */

import type { Hand, KeyMark, NoteEvent, Score, Spelling, Step, TempoMark, TimeSignature } from '../core/types'
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
                // tie reads as one long shape instead of two abutting ones.
                notes[pending.index].duration += duration
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
