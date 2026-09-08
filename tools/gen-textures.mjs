// Seamless page textures, made rather than photographed.
//
// Each tile is an alpha-only PNG: the pixel is white and the *alpha* carries
// the texture, so the page can colour it with any ink at render time through
// one small filter. Everything is built from periodic noise — lattices whose
// period divides the tile — so the tiles repeat without a seam, and nothing
// here is anybody's photograph.
//
//   node tools/gen-textures.mjs      → public/textures/*.png

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const SIZE = 256
const OUT = new URL('../public/textures/', import.meta.url)
mkdirSync(OUT, { recursive: true })

// --- deterministic randomness ----------------------------------------------

function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** A lattice of random values whose period divides the tile, bilinearly read. */
function lattice(cell, seed) {
  const n = SIZE / cell
  const rand = rng(seed)
  const grid = Array.from({ length: n * n }, () => rand())
  const at = (i, j) => grid[((j % n) + n) % n * n + ((i % n) + n) % n]
  const smooth = (t) => t * t * (3 - 2 * t)
  return (x, y) => {
    const gx = x / cell
    const gy = y / cell
    const i = Math.floor(gx)
    const j = Math.floor(gy)
    const fx = smooth(gx - i)
    const fy = smooth(gy - j)
    const a = at(i, j) * (1 - fx) + at(i + 1, j) * fx
    const b = at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx
    return a * (1 - fy) + b * fy
  }
}

/** Layered lattice noise, 0..1, biased toward the middle. */
function fbm(cells, seed) {
  const layers = cells.map((cell, i) => ({ f: lattice(cell, seed + i * 97), w: 1 / (i + 1) }))
  const total = layers.reduce((s, l) => s + l.w, 0)
  return (x, y) => layers.reduce((s, l) => s + l.f(x, y) * l.w, 0) / total
}

const clamp = (v) => Math.max(0, Math.min(1, v))
/** Stretch the middle of a noise field toward the ends. */
const contrast = (v, k) => clamp(0.5 + (v - 0.5) * k)

// --- fibres, drawn with wrap so they cross the seam -------------------------

function fibres(field, count, length, alpha, seed) {
  const rand = rng(seed)
  for (let f = 0; f < count; f += 1) {
    const x0 = rand() * SIZE
    const y0 = rand() * SIZE
    const angle = rand() * Math.PI
    const len = length * (0.6 + rand() * 0.8)
    for (let t = 0; t < len; t += 0.5) {
      const x = ((Math.round(x0 + Math.cos(angle) * t) % SIZE) + SIZE) % SIZE
      const y = ((Math.round(y0 + Math.sin(angle) * t) % SIZE) + SIZE) % SIZE
      field[y * SIZE + x] = clamp(field[y * SIZE + x] + alpha * (1 - t / len))
    }
  }
}

function speckle(field, count, alpha, seed) {
  const rand = rng(seed)
  for (let s = 0; s < count; s += 1) {
    const x = Math.floor(rand() * SIZE)
    const y = Math.floor(rand() * SIZE)
    field[y * SIZE + x] = clamp(field[y * SIZE + x] + alpha * (0.5 + rand() * 0.5))
  }
}

// --- the textures -------------------------------------------------------------

const TEXTURES = {
  // Laid paper: fine grain with a few long fibres.
  paper: () => {
    const noise = fbm([2, 4, 8, 16], 11)
    const field = new Float32Array(SIZE * SIZE)
    for (let y = 0; y < SIZE; y += 1)
      for (let x = 0; x < SIZE; x += 1) field[y * SIZE + x] = contrast(noise(x, y), 1.3) * 0.5
    fibres(field, 260, 14, 0.28, 12)
    return field
  },
  // Linen: two thread directions over a soft irregularity.
  linen: () => {
    const noise = fbm([4, 8, 16], 21)
    const field = new Float32Array(SIZE * SIZE)
    for (let y = 0; y < SIZE; y += 1)
      for (let x = 0; x < SIZE; x += 1) {
        const warp = 0.5 + 0.5 * Math.sin((x / 4) * Math.PI * 2)
        const weft = 0.5 + 0.5 * Math.sin((y / 4) * Math.PI * 2)
        const thread = Math.max(warp, weft) * 0.7 + Math.min(warp, weft) * 0.3
        field[y * SIZE + x] = clamp(thread * 0.6 + (noise(x, y) - 0.5) * 0.5)
      }
    return field
  },
  // Kraft: coarse mottling, flecks and short fibres.
  kraft: () => {
    const noise = fbm([2, 4, 8, 16, 32], 31)
    const field = new Float32Array(SIZE * SIZE)
    for (let y = 0; y < SIZE; y += 1)
      for (let x = 0; x < SIZE; x += 1) field[y * SIZE + x] = contrast(noise(x, y), 1.2) * 0.55
    fibres(field, 220, 8, 0.35, 32)
    speckle(field, 900, 0.55, 33)
    return field
  },
  // Chalk: dust — mostly nothing, then bright grains and a soft haze.
  chalk: () => {
    const haze = fbm([16, 32, 64], 41)
    const fine = lattice(2, 42)
    const field = new Float32Array(SIZE * SIZE)
    for (let y = 0; y < SIZE; y += 1)
      for (let x = 0; x < SIZE; x += 1) {
        const h = clamp((haze(x, y) - 0.45) * 1.2) * 0.35
        const grain = fine(x, y) > 0.82 ? 0.5 : 0
        field[y * SIZE + x] = clamp(h + grain)
      }
    speckle(field, 2200, 0.7, 43)
    return field
  },
  // Stone: broad mottling with a little fine grain, like slate.
  stone: () => {
    const broad = fbm([32, 64, 128], 51)
    const mid = fbm([8, 16], 53)
    const fine = fbm([2, 4], 52)
    const field = new Float32Array(SIZE * SIZE)
    for (let y = 0; y < SIZE; y += 1)
      for (let x = 0; x < SIZE; x += 1)
        field[y * SIZE + x] = clamp(
          contrast(broad(x, y), 1.5) * 0.55 + (mid(x, y) - 0.5) * 0.3 + (fine(x, y) - 0.5) * 0.2,
        )
    return field
  },
}

// --- a minimal PNG writer: 8-bit grey + alpha ---------------------------------

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(field) {
  const raw = Buffer.alloc((SIZE * 2 + 1) * SIZE)
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 2 + 1)] = 0
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * (SIZE * 2 + 1) + 1 + x * 2
      raw[i] = 255
      raw[i + 1] = Math.round(clamp(field[y * SIZE + x]) * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 4 // grey + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [name, make] of Object.entries(TEXTURES)) {
  const bytes = png(make())
  writeFileSync(new URL(`${name}.png`, OUT), bytes)
  console.log(`${name}.png  ${(bytes.length / 1024).toFixed(1)} KB`)
}
