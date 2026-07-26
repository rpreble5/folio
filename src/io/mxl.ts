/**
 * Minimal ZIP reader, just enough to open a compressed MusicXML file.
 *
 * `.mxl` is MuseScore's default export, so refusing it would mean telling most
 * users to go re-export their file — a bad first impression for a tool whose
 * whole premise is "bring us your music". Inflation uses the platform's
 * DecompressionStream, so this stays dependency-free.
 */

interface ZipEntry {
  name: string
  method: number
  offset: number
  compressedSize: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50

function findEndOfCentralDirectory(view: DataView): number {
  // The EOCD is at the end, but a trailing comment can push it back by up to
  // 64 KiB, so scan backwards rather than assuming it is the last 22 bytes.
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22)
  for (let i = view.byteLength - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i
  }
  return -1
}

function readCentralDirectory(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer)
  const eocd = findEndOfCentralDirectory(view)
  if (eocd === -1) throw new Error('Not a valid .mxl archive')

  const count = view.getUint16(eocd + 10, true)
  let pointer = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) break
    const method = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const offset = view.getUint32(pointer + 42, true)
    const name = decoder.decode(new Uint8Array(buffer, pointer + 46, nameLength))

    entries.push({ name, method, offset, compressedSize })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer)
  // The local header repeats the name and extra fields, and its extra-field
  // length can differ from the central directory's — so read it from here.
  const nameLength = view.getUint16(entry.offset + 26, true)
  const extraLength = view.getUint16(entry.offset + 28, true)
  const dataStart = entry.offset + 30 + nameLength + extraLength
  const data = new Uint8Array(buffer, dataStart, entry.compressedSize)

  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) throw new Error(`Unsupported compression method ${entry.method}`)

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/** Pull the score XML out of an .mxl container. */
export async function extractMxl(buffer: ArrayBuffer): Promise<string> {
  const entries = readCentralDirectory(buffer)

  // The spec says META-INF/container.xml names the root file. Honour it when
  // present, since an .mxl may legitimately carry several scores.
  const container = entries.find((e) => e.name === 'META-INF/container.xml')
  if (container) {
    const xml = await readEntry(buffer, container)
    const path = /full-path="([^"]+)"/.exec(xml)?.[1]
    const target = path && entries.find((e) => e.name === path)
    if (target) return readEntry(buffer, target)
  }

  const fallback = entries.find(
    (e) => !e.name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(e.name),
  )
  if (!fallback) throw new Error('No score found inside the .mxl archive')
  return readEntry(buffer, fallback)
}
