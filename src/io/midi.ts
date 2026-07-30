/**
 * MIDI input: a keyboard, as a stream of note events.
 *
 * Deliberately thin. Everything that decides what a note *means* lives in
 * practice/follower.ts; this only opens the device and normalises its bytes, so
 * the interesting code can be driven by a synthetic stream instead of hardware.
 *
 * **Bluetooth needs nothing special here.** On Android, macOS and Windows the
 * operating system pairs a BLE-MIDI keyboard and hands it to the browser as an
 * ordinary MIDI input, so Web MIDI covers both cables and Bluetooth. Web
 * Bluetooth would only be needed on a platform that refuses to bridge, and it
 * would mean parsing BLE-MIDI's own packet framing by hand.
 *
 * **Safari has no Web MIDI**, and on iOS every browser is Safari underneath, so
 * an iPad cannot connect a keyboard to a web app at all. `midiSupport()` reports
 * that rather than letting the UI offer a button that can only fail.
 *
 * The MIDIAccess types come from the standard library; `requestMIDIAccess` is
 * optional on Navigator because it genuinely may not be there.
 */

export interface MidiDevice {
  id: string
  name: string
  manufacturer: string
}

export interface MidiNoteEvent {
  midi: number
  /** 0–1. Zero on a note-off. */
  velocity: number
  on: boolean
  /** Milliseconds since page load, from the event itself where available. */
  time: number
}

export type MidiSupport =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Whether this browser can talk to a keyboard at all.
 *
 * Two separate failures, worth telling apart: the API missing entirely (Safari,
 * and therefore every iOS browser) and the page not being secure. The second is
 * fixable by the developer; the first is not fixable by anyone.
 */
export function midiSupport(): MidiSupport {
  if (typeof navigator === 'undefined') return { ok: false, reason: 'No browser environment.' }
  if (!window.isSecureContext) {
    return { ok: false, reason: 'MIDI needs a secure page. Open this over HTTPS.' }
  }
  if (typeof navigator.requestMIDIAccess !== 'function') {
    return {
      ok: false,
      reason:
        'This browser has no MIDI support. Safari does not implement it, and on iPhone and iPad every browser is Safari underneath. Chrome on Android or on a computer will work.',
    }
  }
  return { ok: true }
}

export interface MidiConnection {
  devices: MidiDevice[]
  /** Stop listening and release the handlers. */
  close(): void
}

const NOTE_ON = 0x90
const NOTE_OFF = 0x80

/**
 * Open MIDI and listen to every input at once.
 *
 * Every input rather than a chosen one on purpose: a keyboard often presents
 * several ports, and asking a player to guess which of "Digital Piano" and
 * "Digital Piano MIDI 1" is the real one is a question with no good answer.
 * Notes are notes whichever port they arrive on.
 *
 * `onDevices` fires again whenever something is plugged in or paired, so a
 * keyboard switched on after the app can still be picked up.
 */
export async function openMidi(
  onNote: (event: MidiNoteEvent) => void,
  onDevices: (devices: MidiDevice[]) => void,
): Promise<MidiConnection> {
  const support = midiSupport()
  if (!support.ok) throw new Error(support.reason)

  const access = await navigator.requestMIDIAccess()
  let closed = false

  const handle = (event: MIDIMessageEvent) => {
    if (closed || !event.data || event.data.length < 3) return
    const [status, note, velocity] = event.data
    const command = status & 0xf0

    // A note-on at zero velocity is a note-off. Many keyboards send only that
    // form, so treating 0x90 as always-on leaves every key stuck down.
    if (command === NOTE_ON && velocity > 0) {
      onNote({ midi: note, velocity: velocity / 127, on: true, time: event.timeStamp })
    } else if (command === NOTE_OFF || (command === NOTE_ON && velocity === 0)) {
      onNote({ midi: note, velocity: 0, on: false, time: event.timeStamp })
    }
  }

  const attach = () => {
    const devices: MidiDevice[] = []
    for (const input of access.inputs.values()) {
      input.onmidimessage = handle
      if (input.state === 'connected') {
        devices.push({
          id: input.id,
          name: input.name ?? 'Keyboard',
          manufacturer: input.manufacturer ?? '',
        })
      }
    }
    onDevices(devices)
  }

  attach()
  access.onstatechange = () => {
    if (!closed) attach()
  }

  return {
    devices: Array.from(access.inputs.values())
      .filter((i) => i.state === 'connected')
      .map((i) => ({ id: i.id, name: i.name ?? 'Keyboard', manufacturer: i.manufacturer ?? '' })),
    close() {
      closed = true
      access.onstatechange = null
      for (const input of access.inputs.values()) input.onmidimessage = null
    },
  }
}
