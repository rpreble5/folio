/**
 * Standard MIDI File → Score IR.
 *
 * MIDI is the lossy path: it knows a key was pressed, not how it was written.
 * Spelling is reconstructed from the key signature, and hands are inferred from
 * track layout. Good enough to get a file on screen, but MusicXML is what the
 * app should nudge people toward.
 */

import type { Hand, KeyMark, NoteEvent, Score, Spelling, Step, TempoMark, TimeSignature } from '../core/types'
import { markBarStarts } from '../core/types'

const SHARP_SPELLINGS: [Step, number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
]
const FLAT_SPELLINGS: [Step, number][] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
]

function spell(midi: number, fifths: number): Spelling {
  const table = fifths < 0 ? FLAT_SPELLINGS : SHARP_SPELLINGS
  const [step, alter] = table[((midi % 12) + 12) % 12]
  return { step, alter, octave: Math.floor(midi / 12) - 1 }
}

class Reader {
  offset = 0
  constructor(readonly view: DataView) {}

  u8(): number {
    return this.view.getUint8(this.offset++)
  }
  u16(): number {
    const v = this.view.getUint16(this.offset, false)
    this.offset += 2
    return v
  }
  u32(): number {
    const v = this.view.getUint32(this.offset, false)
    this.offset += 4
    return v
  }
  /** MIDI's 7-bits-per-byte variable-length quantity. */
  varint(): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const byte = this.u8()
      value = (value << 7) | (byte & 0x7f)
      if ((byte & 0x80) === 0) break
    }
    return value
  }
  ascii(length: number): string {
    let out = ''
    for (let i = 0; i < length; i++) out += String.fromCharCode(this.u8())
    return out
  }
}

interface RawNote {
  tick: number
  durationTicks: number
  midi: number
  velocity: number
  track: number
}

export function parseMidiFile(buffer: ArrayBuffer): Score {
  const reader = new Reader(new DataView(buffer))

  if (reader.ascii(4) !== 'MThd') throw new Error('Not a MIDI file.')
  const headerLength = reader.u32()
  reader.u16() // format — we merge every track regardless
  const trackCount = reader.u16()
  const division = reader.u16()
  reader.offset += headerLength - 6

  if (division & 0x8000) {
    throw new Error('SMPTE-timed MIDI files are not supported — re-export with musical timing.')
  }
  const ticksPerQuarter = division || 480

  const rawNotes: RawNote[] = []
  const tempos: TempoMark[] = []
  const timeSignatures: TimeSignature[] = []
  const keys: KeyMark[] = []
  let title = ''
  const tracksWithNotes = new Set<number>()

  for (let track = 0; track < trackCount; track++) {
    if (reader.offset >= reader.view.byteLength) break
    if (reader.ascii(4) !== 'MTrk') break
    const trackLength = reader.u32()
    const trackEnd = reader.offset + trackLength

    let tick = 0
    let runningStatus = 0
    // Multiple note-ons for the same pitch before a note-off are legal; keep a
    // stack per pitch so they unwind in order rather than colliding.
    const open = new Map<number, { tick: number; velocity: number }[]>()

    while (reader.offset < trackEnd) {
      tick += reader.varint()
      let status = reader.u8()

      if (status < 0x80) {
        // Running status: reuse the previous status byte and step back.
        reader.offset -= 1
        status = runningStatus
      } else if (status < 0xf0) {
        runningStatus = status
      }

      const type = status & 0xf0

      if (status === 0xff) {
        const metaType = reader.u8()
        const length = reader.varint()
        const start = reader.offset

        if (metaType === 0x51 && length === 3) {
          const microseconds = (reader.view.getUint8(start) << 16) |
            (reader.view.getUint8(start + 1) << 8) |
            reader.view.getUint8(start + 2)
          if (microseconds > 0) {
            tempos.push({ beat: tick / ticksPerQuarter, bpm: 60_000_000 / microseconds })
          }
        } else if (metaType === 0x58 && length >= 2) {
          timeSignatures.push({
            beat: tick / ticksPerQuarter,
            numerator: reader.view.getUint8(start),
            denominator: 2 ** reader.view.getUint8(start + 1),
          })
        } else if (metaType === 0x59 && length >= 2) {
          keys.push({
            beat: tick / ticksPerQuarter,
            fifths: reader.view.getInt8(start),
            mode: reader.view.getUint8(start + 1) === 1 ? 'minor' : 'major',
          })
        } else if ((metaType === 0x03 || metaType === 0x01) && !title && length > 0) {
          title = new TextDecoder().decode(new Uint8Array(buffer, start, length)).trim()
        }

        reader.offset = start + length
        continue
      }

      if (status === 0xf0 || status === 0xf7) {
        reader.offset += reader.varint()
        continue
      }

      switch (type) {
        case 0x90: {
          const midi = reader.u8()
          const velocity = reader.u8()
          if (velocity > 0) {
            if (!open.has(midi)) open.set(midi, [])
            open.get(midi)!.push({ tick, velocity })
            tracksWithNotes.add(track)
          } else {
            closeNote(open, rawNotes, midi, tick, track)
          }
          break
        }
        case 0x80: {
          const midi = reader.u8()
          reader.u8()
          closeNote(open, rawNotes, midi, tick, track)
          break
        }
        case 0xa0:
        case 0xb0:
        case 0xe0:
          reader.offset += 2
          break
        case 0xc0:
        case 0xd0:
          reader.offset += 1
          break
        default:
          // Unknown status: bail out of this track rather than desyncing.
          reader.offset = trackEnd
      }
    }

    // Anything still held at end-of-track gets clipped there.
    for (const [midi, stack] of open) {
      for (const held of stack) {
        rawNotes.push({
          tick: held.tick,
          durationTicks: Math.max(1, tick - held.tick),
          midi,
          velocity: held.velocity,
          track,
        })
      }
    }

    reader.offset = trackEnd
  }

  const fifths = keys[0]?.fifths ?? 0
  const musicTracks = Array.from(tracksWithNotes).sort((a, b) => a - b)

  const timeSigs = timeSignatures.length
    ? timeSignatures
    : [{ beat: 0, numerator: 4, denominator: 4 }]
  const beatsPerBar = timeSigs[0].numerator * (4 / timeSigs[0].denominator)

  let idCounter = 0
  const notes: NoteEvent[] = rawNotes.map((raw) => {
    idCounter += 1
    const onset = raw.tick / ticksPerQuarter
    return {
      id: `m${idCounter}`,
      onset,
      duration: raw.durationTicks / ticksPerQuarter,
      midi: raw.midi,
      spelling: spell(raw.midi, fifths),
      hand: assignHand(raw.midi, raw.track, musicTracks),
      voice: musicTracks.indexOf(raw.track) + 1,
      measure: Math.floor(onset / beatsPerBar),
      velocity: raw.velocity / 127,
    }
  })

  markBarStarts(notes)

  notes.sort((a, b) => a.onset - b.onset || a.midi - b.midi)

  return {
    id: `import-${Date.now().toString(36)}`,
    title: title || 'Imported MIDI',
    composer: 'Unknown',
    notes,
    tempos: tempos.length ? tempos.sort((a, b) => a.beat - b.beat) : [{ beat: 0, bpm: 100 }],
    timeSignatures: timeSigs.sort((a, b) => a.beat - b.beat),
    keys: keys.length ? keys.sort((a, b) => a.beat - b.beat) : [{ beat: 0, fifths: 0, mode: 'major' }],
    length: notes.reduce((max, n) => Math.max(max, n.onset + n.duration), 0),
  }
}

function closeNote(
  open: Map<number, { tick: number; velocity: number }[]>,
  out: RawNote[],
  midi: number,
  tick: number,
  track: number,
): void {
  const stack = open.get(midi)
  if (!stack || stack.length === 0) return
  const held = stack.shift()!
  out.push({
    tick: held.tick,
    durationTicks: Math.max(1, tick - held.tick),
    midi,
    velocity: held.velocity,
    track,
  })
  if (stack.length === 0) open.delete(midi)
}

/** Two music tracks almost always means hands were split; otherwise use middle C. */
function assignHand(midi: number, track: number, musicTracks: number[]): Hand {
  if (musicTracks.length >= 2) {
    return track === musicTracks[0] ? 'right' : 'left'
  }
  return midi < 60 ? 'left' : 'right'
}
