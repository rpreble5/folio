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

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface MidiPortReport {
  id: string
  name: string
  manufacturer: string
  state: string
  connection: string
  direction: 'input' | 'output'
}

export interface MidiReport {
  /** Where the page is loaded from, which decides whether MIDI is allowed at all. */
  origin: string
  secure: boolean
  hasApi: boolean
  permission: string
  /** Null until access has been requested. */
  accessError: string | null
  inputs: MidiPortReport[]
  outputs: MidiPortReport[]
  userAgent: string
}

/**
 * Everything that decides whether a keyboard can work, gathered in one pass.
 *
 * Opens its own MIDI access rather than reusing the session's, on purpose: when
 * someone says "it did not work", the first thing to rule out is this app's own
 * plumbing, and a report that runs through the same code as the failure cannot
 * do that.
 *
 * Outputs are listed as well as inputs even though nothing sends. If a piano
 * appears as an output and not as an input, the cable and the drivers are fine
 * and the problem is at the instrument's end — which is a completely different
 * thing to go and check.
 */
export async function midiReport(): Promise<MidiReport> {
  const report: MidiReport = {
    origin: typeof location === 'undefined' ? '' : location.origin,
    secure: typeof window !== 'undefined' && window.isSecureContext,
    hasApi: typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function',
    permission: 'unknown',
    accessError: null,
    inputs: [],
    outputs: [],
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  }

  try {
    // Not in every browser, and not always with 'midi' as a valid name, so a
    // failure here says nothing except that we could not ask.
    const status = await navigator.permissions?.query({ name: 'midi' as PermissionName })
    if (status) report.permission = status.state
  } catch {
    report.permission = 'unavailable'
  }

  if (!report.hasApi) {
    report.accessError = 'This browser does not implement Web MIDI.'
    return report
  }
  if (!report.secure) {
    report.accessError =
      'The page is not a secure context, so the browser blocks MIDI before it is even asked. Load the app over https.'
    return report
  }

  try {
    const access = await navigator.requestMIDIAccess()
    const describe = (port: MIDIPort, direction: 'input' | 'output'): MidiPortReport => ({
      id: port.id,
      name: port.name ?? '',
      manufacturer: port.manufacturer ?? '',
      state: port.state,
      connection: port.connection,
      direction,
    })
    for (const input of access.inputs.values()) report.inputs.push(describe(input, 'input'))
    for (const output of access.outputs.values()) report.outputs.push(describe(output, 'output'))
  } catch (error) {
    report.accessError =
      error instanceof Error ? `${error.name}: ${error.message}` : 'MIDI access was refused.'
  }

  return report
}

export interface RawMessage {
  /** Bytes as hex, exactly as they arrived. */
  hex: string
  /** A plain-language name for the status byte, or 'unknown'. */
  kind: string
  port: string
  at: number
}

/**
 * Every byte from every input, undecoded.
 *
 * The note handler ignores anything that is not a note on or off, and drops
 * messages shorter than three bytes. That is right for playing and wrong for
 * diagnosis: an instrument sending nothing but active sensing is indisputably
 * connected, and the ordinary path shows exactly the same nothing as a dead
 * cable. This shows the difference.
 */
export async function watchRaw(
  onMessage: (message: RawMessage) => void,
): Promise<() => void> {
  const access = await navigator.requestMIDIAccess()
  let closed = false

  const handle = (event: MIDIMessageEvent, portName: string) => {
    if (closed || !event.data) return
    const bytes = Array.from(event.data)
    onMessage({
      hex: bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '),
      kind: describeStatus(bytes[0] ?? 0),
      port: portName,
      at: event.timeStamp,
    })
  }

  for (const input of access.inputs.values()) {
    input.onmidimessage = (event) => handle(event, input.name ?? input.id)
  }

  return () => {
    closed = true
    for (const input of access.inputs.values()) input.onmidimessage = null
  }
}

function describeStatus(status: number): string {
  switch (status & 0xf0) {
    case 0x80:
      return 'note off'
    case 0x90:
      return 'note on'
    case 0xa0:
      return 'aftertouch'
    case 0xb0:
      return 'control change'
    case 0xc0:
      return 'program change'
    case 0xd0:
      return 'channel pressure'
    case 0xe0:
      return 'pitch bend'
    case 0xf0:
      // The one that matters here: a keyboard idling sends active sensing and
      // nothing else, which proves the link without producing a single note.
      if (status === 0xfe) return 'active sensing'
      if (status === 0xf8) return 'clock'
      if (status === 0xf0) return 'sysex'
      return 'system'
    default:
      return 'unknown'
  }
}

export type MidiVerdict = 'bad' | 'warn' | 'ok'

/**
 * The one sentence worth reading.
 *
 * Ordered by how early in the chain the failure is, so the first thing that is
 * actually broken is what gets named — telling someone their instrument is silent
 * when the real problem is that the page is not on https would send them to take
 * the piano apart.
 */
export function diagnoseMidi(
  report: MidiReport,
  count: number,
): { text: string; tone: MidiVerdict } {
  if (!report.secure) {
    return {
      tone: 'bad',
      text: 'The page is not on a secure origin, so the browser refuses MIDI outright. Open the published https address rather than a plain http one.',
    }
  }
  if (!report.hasApi) {
    return {
      tone: 'bad',
      text: 'This browser has no Web MIDI. Safari does not implement it, and on iPhone and iPad every browser is Safari underneath — Chrome on Android or a computer will work.',
    }
  }
  if (report.permission === 'denied') {
    return {
      tone: 'bad',
      text: 'MIDI permission has been denied for this site. Clear it in the browser’s site settings and reload.',
    }
  }
  if (report.accessError) {
    return { tone: 'bad', text: report.accessError }
  }
  if (report.inputs.length === 0 && report.outputs.length === 0) {
    return {
      tone: 'bad',
      text: 'The browser has MIDI but sees no device. Over USB, check the cable goes to the instrument’s USB-to-Host socket and that the phone can act as a USB host — a charge-only cable will not do. Over Bluetooth on Android, pairing in the system settings does not switch MIDI on.',
    }
  }
  if (report.inputs.length === 0) {
    return {
      tone: 'warn',
      text: 'The instrument is visible as an output but not as an input, so the connection itself is fine. Something at the instrument’s end is not transmitting — look for a MIDI transmit or Local Control setting.',
    }
  }
  if (count === 0) {
    return {
      tone: 'warn',
      text: 'A device is connected but has sent nothing. Press a key: if this stays at zero, the instrument is not transmitting.',
    }
  }
  return { tone: 'ok', text: 'Connected and receiving. Everything below is working.' }
}

