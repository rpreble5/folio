/**
 * Bluetooth MIDI, spoken directly.
 *
 * Chrome's Web MIDI does not reach Bluetooth keyboards on Android, and Android's
 * own Bluetooth settings screen can pair a BLE-MIDI device without ever enabling
 * the MIDI link. So the only route left is to be the app that opens the
 * connection — which is exactly what the manufacturer's own app is doing, and why
 * its manual says the app is "required to pair". Nothing is locked; BLE-MIDI is
 * simply per-application by design.
 *
 * That means Web Bluetooth: find the device, open its GATT server, subscribe to
 * one characteristic, and decode what arrives. The decoding is the part worth
 * being careful about, because BLE-MIDI is not raw MIDI — it is MIDI wrapped in a
 * timestamp framing that shares its high bit with status bytes, and getting the
 * two confused does not produce silence, it produces stuck notes.
 *
 * Two caveats that bite in practice:
 *
 *   - A BLE peripheral normally accepts one connection at a time. If the
 *     manufacturer's app is holding the instrument, nothing else can have it —
 *     it has to be closed, not merely backgrounded.
 *   - Web Bluetooth needs a secure page and a real user gesture, and on Android
 *     it has historically also needed Location permission, because a BLE scan can
 *     be used to infer position.
 */

// ---------------------------------------------------------------------------
// Web Bluetooth surface
//
// Not in the standard library types, and a whole dependency to describe six
// members is not worth carrying.
// ---------------------------------------------------------------------------

interface BleCharacteristic extends EventTarget {
  value?: DataView
  startNotifications(): Promise<BleCharacteristic>
  stopNotifications(): Promise<BleCharacteristic>
}

interface BleService {
  getCharacteristic(uuid: string): Promise<BleCharacteristic>
}

interface BleServer {
  connected: boolean
  disconnect(): void
  getPrimaryService(uuid: string): Promise<BleService>
}

interface BleDevice extends EventTarget {
  id: string
  name?: string
  gatt?: { connect(): Promise<BleServer>; connected: boolean; disconnect(): void }
}

interface Bluetooth {
  getAvailability?(): Promise<boolean>
  requestDevice(options: {
    filters?: { services?: string[]; namePrefix?: string }[]
    optionalServices?: string[]
    acceptAllDevices?: boolean
  }): Promise<BleDevice>
}

interface BluetoothNavigator {
  bluetooth?: Bluetooth
}

/** The MIDI-over-BLE service and its one data characteristic, both fixed by spec. */
export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700'
export const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3'

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export interface MidiMessage {
  status: number
  data1: number
  data2: number
}

/**
 * How many data bytes follow a status byte.
 *
 * Getting this wrong is what desynchronises a parser, and a desynchronised MIDI
 * parser does not fail loudly — it emits a note-on whose note-off it will never
 * recognise, and the note hangs.
 */
function dataBytesFor(status: number): number {
  if (status >= 0xf8) return 0 // real time
  switch (status) {
    case 0xf1: // MTC quarter frame
    case 0xf3: // song select
      return 1
    case 0xf2: // song position
      return 2
    case 0xf4:
    case 0xf5:
    case 0xf6:
    case 0xf7:
      return 0
  }
  const kind = status & 0xf0
  // Program change and channel pressure carry one byte; everything else two.
  return kind === 0xc0 || kind === 0xd0 ? 1 : 2
}

/**
 * Decode one BLE-MIDI packet.
 *
 * The framing: a header byte, then repeating pairs of a timestamp byte and a
 * MIDI message. Both timestamp bytes and status bytes have their high bit set,
 * so they cannot be told apart by value — only by position. A byte with the high
 * bit set where a message is expected is a timestamp; the byte after it is a
 * status if its high bit is set, and otherwise the message is running status.
 *
 * Running status is the part that is easy to get wrong twice over: the status
 * byte may be omitted, *and* so may the timestamp byte before it. So a byte with
 * the high bit clear, arriving where a timestamp was expected, is the first data
 * byte of a running-status message.
 *
 * Real-time messages never disturb running status, and system common clears it.
 * Treating them all alike leaves the parser one byte out for the rest of the
 * packet.
 *
 * SysEx is skipped rather than assembled. Nothing here reads it, and doing it
 * properly means carrying state across packets.
 */
export function decodeBlePacket(
  data: Uint8Array,
  state: { runningStatus: number } = { runningStatus: 0 },
): MidiMessage[] {
  const out: MidiMessage[] = []
  if (data.length < 2) return out

  // data[0] is the header: high timestamp bits, which nothing here needs.
  let i = 1

  while (i < data.length) {
    let status: number

    if (data[i] & 0x80) {
      // A timestamp. What follows is either a status byte or running-status data.
      i += 1
      if (i >= data.length) break
      if (data[i] & 0x80) {
        status = data[i]
        i += 1
      } else {
        status = state.runningStatus
      }
    } else {
      // Running status with the timestamp elided too.
      status = state.runningStatus
    }

    if (status === 0) {
      // Nothing to attach these bytes to. Skip one and resynchronise rather than
      // guessing, which is how a parser turns one bad packet into a bad stream.
      i += 1
      continue
    }

    if (status < 0xf8 && status >= 0xf0) state.runningStatus = 0
    else if (status < 0xf0) state.runningStatus = status

    if (status === 0xf0) {
      // SysEx: run to its terminator, ignoring the timestamp bytes inside.
      while (i < data.length && data[i] !== 0xf7) i += 1
      i += 1
      continue
    }

    const wanted = dataBytesFor(status)
    if (i + wanted > data.length) break

    const data1 = wanted > 0 ? data[i] : 0
    const data2 = wanted > 1 ? data[i + 1] : 0
    i += wanted

    out.push({ status, data1, data2 })
  }

  return out
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type BluetoothSupport = { ok: true } | { ok: false; reason: string }

export function bluetoothSupport(): BluetoothSupport {
  if (typeof navigator === 'undefined') return { ok: false, reason: 'No browser environment.' }
  if (!window.isSecureContext) {
    return { ok: false, reason: 'Bluetooth needs a secure page. Open this over https.' }
  }
  if (!(navigator as BluetoothNavigator).bluetooth) {
    return {
      ok: false,
      reason:
        'This browser has no Web Bluetooth. Chrome on Android or on a computer will work; Safari does not implement it, on any device.',
    }
  }
  return { ok: true }
}

export interface BleConnection {
  name: string
  close(): void
}

export interface BleNoteEvent {
  midi: number
  velocity: number
  on: boolean
}

/**
 * Ask the user to pick a keyboard, then listen to it.
 *
 * The chooser is the browser's own and cannot be skipped or pre-filled — a page
 * is not allowed to know what is nearby until someone points at one thing. That
 * is a deliberate privacy boundary, not an obstacle to route around, and it means
 * this must be called straight from a click.
 */
export async function openBluetoothMidi(
  onNote: (event: BleNoteEvent) => void,
  onDisconnect: (reason: string) => void,
): Promise<BleConnection> {
  const support = bluetoothSupport()
  if (!support.ok) throw new Error(support.reason)

  const bluetooth = (navigator as BluetoothNavigator).bluetooth!
  const device = await bluetooth.requestDevice({
    filters: [{ services: [BLE_MIDI_SERVICE] }],
    optionalServices: [BLE_MIDI_SERVICE],
  })

  if (!device.gatt) throw new Error('That device has no GATT server.')

  const server = await device.gatt.connect()
  const service = await server.getPrimaryService(BLE_MIDI_SERVICE)
  const characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC)

  // Running status carries across packets, so the state lives out here.
  const state = { runningStatus: 0 }
  let closed = false

  const handle = (event: Event) => {
    if (closed) return
    const value = (event.target as BleCharacteristic).value
    if (!value) return

    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    for (const message of decodeBlePacket(bytes, state)) {
      const kind = message.status & 0xf0
      // A note-on at zero velocity is a note-off, and many instruments send only
      // that form — treating 0x90 as always-on leaves every key stuck down.
      if (kind === 0x90 && message.data2 > 0) {
        onNote({ midi: message.data1, velocity: message.data2 / 127, on: true })
      } else if (kind === 0x80 || (kind === 0x90 && message.data2 === 0)) {
        onNote({ midi: message.data1, velocity: 0, on: false })
      }
    }
  }

  characteristic.addEventListener('characteristicvaluechanged', handle)
  await characteristic.startNotifications()

  const onGattLost = () => {
    if (!closed) onDisconnect('The keyboard disconnected.')
  }
  device.addEventListener('gattserverdisconnected', onGattLost)

  return {
    name: device.name ?? 'Bluetooth keyboard',
    close() {
      closed = true
      characteristic.removeEventListener('characteristicvaluechanged', handle)
      device.removeEventListener('gattserverdisconnected', onGattLost)
      try {
        device.gatt?.disconnect()
      } catch {
        // Already gone. Nothing to release.
      }
    },
  }
}
