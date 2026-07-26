/** Dispatch an uploaded file to the right parser. */

import type { Score } from '../core/types'
import { parseMidiFile } from './midifile'
import { parseMusicXml } from './musicxml'
import { extractMxl } from './mxl'

const MXL_MAGIC = 0x504b0304 // "PK\x03\x04"

export async function importFile(file: File): Promise<Score> {
  const name = file.name.toLowerCase()
  const buffer = await file.arrayBuffer()

  if (buffer.byteLength === 0) throw new Error('That file is empty.')

  // Sniff the contents rather than trusting the extension — plenty of MusicXML
  // in the wild is named .xml, and plenty of .mxl is really a bare .xml.
  const magic = buffer.byteLength >= 4 ? new DataView(buffer).getUint32(0, false) : 0

  if (magic === MXL_MAGIC) {
    return parseMusicXml(await extractMxl(buffer))
  }

  if (name.endsWith('.mid') || name.endsWith('.midi') || looksLikeMidi(buffer)) {
    return parseMidiFile(buffer)
  }

  const text = new TextDecoder().decode(buffer)
  if (text.includes('<score-partwise') || text.includes('<score-timewise') || text.includes('<?xml')) {
    return parseMusicXml(text)
  }

  throw new Error('Unrecognised file. Folio reads MusicXML (.xml, .musicxml, .mxl) and MIDI (.mid).')
}

function looksLikeMidi(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false
  const bytes = new Uint8Array(buffer, 0, 4)
  return bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64
}

export const ACCEPTED_TYPES = '.xml,.musicxml,.mxl,.mid,.midi'
