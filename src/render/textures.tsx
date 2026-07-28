/**
 * Texture patterns.
 *
 * Texture is drawn as a second copy of the same shape, filled with a pattern
 * and laid over the solid one. That avoids a clip path per note — the copy is
 * already exactly coincident with what it is texturing — and keeps one shared
 * pattern definition serving every note on the page.
 *
 * A caveat worth knowing rather than hiding: texture only reads as texture when
 * a mark is big enough to hold roughly three cycles of it. Below that it is
 * just noise, which is why the Studio warns when notes are too small for the
 * scale chosen.
 */

import type { TextureConfig, TextureKind } from '../core/theme'

/** Base tile size in user units, before the config's scale is applied. */
const TILE = 8

const LIGHT = '#ffffff'
const DARK = '#000000'

export function textureId(kind: TextureKind, ink: 'light' | 'dark'): string {
  return `tex-${kind}-${ink}`
}

export function textureFill(texture: TextureConfig): string | undefined {
  if (texture.kind === 'none') return undefined
  return `url(#${textureId(texture.kind, texture.ink)})`
}

function Tile({ kind, ink }: { kind: Exclude<TextureKind, 'none'>; ink: 'light' | 'dark' }) {
  const color = ink === 'light' ? LIGHT : DARK

  switch (kind) {
    case 'grain':
      // A fixed scatter rather than a random one: the pattern is a repeating
      // tile, so genuine randomness would still repeat — this just avoids the
      // obvious grid a regular scatter produces.
      return (
        <>
          {[
            [1.2, 2.1], [3.4, 0.8], [5.9, 3.2], [2.2, 5.4], [6.8, 6.1],
            [0.6, 6.8], [4.6, 4.4], [7.2, 1.4], [3.1, 7.3], [5.2, 0.3],
          ].map(([x, y], i) => (
            <rect key={i} x={x} y={y} width={0.9} height={0.9} fill={color} />
          ))}
        </>
      )
    case 'dots':
      return (
        <>
          <circle cx={2} cy={2} r={1.1} fill={color} />
          <circle cx={6} cy={6} r={1.1} fill={color} />
        </>
      )
    case 'lines':
      return <path d={`M -2 2 L 2 -2 M 0 8 L 8 0 M 6 10 L 10 6`} stroke={color} strokeWidth={1.4} />
    case 'cross':
      return (
        <path
          d={`M -2 2 L 2 -2 M 0 8 L 8 0 M 6 10 L 10 6 M -2 6 L 6 -2 M 2 10 L 10 2`}
          stroke={color}
          strokeWidth={1}
        />
      )
    case 'weave':
      return (
        <>
          <rect x={0} y={0} width={4} height={4} fill={color} />
          <rect x={4} y={4} width={4} height={4} fill={color} />
        </>
      )
  }
}

const KINDS: Exclude<TextureKind, 'none'>[] = ['grain', 'dots', 'lines', 'cross', 'weave']

/**
 * Every pattern, defined once per page.
 *
 * Scale lives on the pattern rather than on each use, so all three surfaces —
 * page, note, trail — can carry different scales without duplicating tiles.
 */
export function TextureDefs({ textures }: { textures: TextureConfig[] }) {
  const wanted = textures.filter((t) => t.kind !== 'none')

  return (
    <defs>
      {KINDS.flatMap((kind) =>
        (['light', 'dark'] as const).map((ink) => {
          const use = wanted.find((t) => t.kind === kind && t.ink === ink)
          if (!use) return null
          return (
            <pattern
              key={`${kind}-${ink}`}
              id={textureId(kind, ink)}
              width={TILE}
              height={TILE}
              patternUnits="userSpaceOnUse"
              patternTransform={`scale(${use.scale})`}
            >
              <Tile kind={kind} ink={ink} />
            </pattern>
          )
        }),
      )}

      {/* Ramps a trail's texture from nothing at the head to full at the tail,
          in the trail's own bounding box so one definition serves them all. */}
      <linearGradient id="trail-ramp-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#000000" />
        <stop offset="0.35" stopColor="#3a3a3a" />
        <stop offset="1" stopColor="#ffffff" />
      </linearGradient>
      <mask id="trail-ramp" maskContentUnits="objectBoundingBox">
        <rect width="1" height="1" fill="url(#trail-ramp-grad)" />
      </mask>
    </defs>
  )
}

/**
 * Roughly how many pattern cycles fit across a mark of this height.
 * Under about three, a texture stops reading as one.
 */
export function cyclesAcross(texture: TextureConfig, markHeight: number): number {
  if (texture.kind === 'none') return Infinity
  return markHeight / (TILE * Math.max(0.1, texture.scale))
}
