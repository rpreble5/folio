/**
 * Texture patterns.
 *
 * Texture is drawn as a second copy of the same shape, filled with a pattern
 * and laid over the solid one. That avoids a clip path per note — the copy is
 * already exactly coincident with what it is texturing — and keeps one shared
 * pattern definition serving every note on the page.
 *
 * Three families share the mechanism. Drawn patterns are a few marks in an
 * eight-unit tile. Image tiles are seamless rasters bundled with the app,
 * alpha-only, inked at render time through a small filter so one file serves
 * a dark page and a paper one alike. The reader's own picture is the third:
 * tiled through the same pattern, or laid over the page once, which is not a
 * pattern at all and is drawn by the page itself.
 *
 * A caveat worth knowing rather than hiding: a drawn texture only reads as
 * texture when a mark is big enough to hold roughly three cycles of it. Below
 * that it is just noise, which is why the Studio warns when notes are too
 * small for the scale chosen.
 */

import { IMAGE_TEXTURES, isImageTexture, type TextureConfig, type TextureKind } from '../core/theme'

/** Base tile size in user units, before the config's scale is applied. */
const TILE = 8
/** Image tiles are drawn larger: a texture is a surface, not a pattern. */
const IMAGE_TILE = 128
/** The reader's picture, as a tile. */
const PICTURE_TILE = 160

const LIGHT = '#ffffff'
const DARK = '#000000'

export function textureId(kind: TextureKind, ink: 'light' | 'dark'): string {
  return kind === 'image' ? 'tex-image' : `tex-${kind}-${ink}`
}

/**
 * The fill that paints this texture, or nothing when there is nothing to
 * paint — no texture, or a picture that covers the page rather than tiling
 * it, which the page draws as an image in its own right.
 */
export function textureFill(texture: TextureConfig): string | undefined {
  if (texture.kind === 'none') return undefined
  if (texture.kind === 'image') {
    return texture.image && texture.fit !== 'cover' ? `url(#${textureId('image', 'dark')})` : undefined
  }
  return `url(#${textureId(texture.kind, texture.ink)})`
}

/** Where a bundled tile lives, under whatever base the app is served from. */
export const textureHref = (kind: TextureKind): string =>
  `${import.meta.env.BASE_URL}${IMAGE_TEXTURES[kind] ?? ''}`

function Tile({ kind, ink }: { kind: TextureKind; ink: 'light' | 'dark' }) {
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
    default:
      return null
  }
}

const DRAWN: TextureKind[] = ['grain', 'dots', 'lines', 'cross', 'weave']
const IMAGES: TextureKind[] = Object.keys(IMAGE_TEXTURES) as TextureKind[]

/**
 * Every pattern, defined once per page.
 *
 * Scale lives on the pattern rather than on each use, so all three surfaces —
 * page, note, trail — can carry different scales without duplicating tiles.
 */
export function TextureDefs({
  textures,
  fade = 0,
  glow = 0,
  sketch = 0,
}: {
  textures: TextureConfig[]
  /** How far a trail fades toward the page by its end, 0 to 1. */
  fade?: number
  /** Bloom strength, 0 to 1. */
  glow?: number
  /** Hand-drawn wobble, 0 to 1. */
  sketch?: number
}) {
  const wanted = textures.filter((t) => t.kind !== 'none')
  const picture = wanted.find((t) => t.kind === 'image' && t.image && t.fit !== 'cover')
  // A mask is luminance: white keeps, black drops. The end of the ramp is
  // however much of the trail should survive.
  const survives = Math.round((1 - Math.max(0, Math.min(1, fade))) * 255)
  const fadeEnd = `rgb(${survives},${survives},${survives})`

  return (
    <defs>
      {fade > 0 && (
        <>
          <linearGradient id="trail-fade-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor={fadeEnd} />
          </linearGradient>
          <mask id="trail-fade" maskContentUnits="objectBoundingBox">
            <rect width="1" height="1" fill="url(#trail-fade-grad)" />
          </mask>
        </>
      )}

      {/* The bloom: the mark blurred and brightened, under the mark itself.
          The region is widened so the halo is not clipped at the note's box. */}
      {glow > 0 && (
        <filter id="glow" x="-30%" y="-80%" width="160%" height="260%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={1.5 + glow * 5} />
          <feComponentTransfer>
            <feFuncA type="linear" slope={0.6 + glow * 1.2} />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      )}

      {/* The hand-drawn edge: every outline displaced by a little low-frequency
          noise, so straight becomes almost straight. Fixed seed, so the page
          wobbles the same way every time it is drawn. */}
      {sketch > 0 && (
        <filter id="sketch" x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={1 + sketch * 7}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      )}

      {/* An image tile carries only alpha; these give it its ink. */}
      {(['light', 'dark'] as const).map((ink) => (
        <filter key={ink} id={`tex-ink-${ink}`} x="0" y="0" width="100%" height="100%">
          <feFlood floodColor={ink === 'light' ? LIGHT : DARK} />
          <feComposite in2="SourceAlpha" operator="in" />
        </filter>
      ))}

      {DRAWN.flatMap((kind) =>
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

      {IMAGES.flatMap((kind) =>
        (['light', 'dark'] as const).map((ink) => {
          const use = wanted.find((t) => t.kind === kind && t.ink === ink)
          if (!use) return null
          return (
            <pattern
              key={`${kind}-${ink}`}
              id={textureId(kind, ink)}
              width={IMAGE_TILE}
              height={IMAGE_TILE}
              patternUnits="userSpaceOnUse"
              patternTransform={`scale(${use.scale})`}
            >
              <image
                href={textureHref(kind)}
                width={IMAGE_TILE}
                height={IMAGE_TILE}
                filter={`url(#tex-ink-${ink})`}
                preserveAspectRatio="none"
              />
            </pattern>
          )
        }),
      )}

      {picture && (
        <pattern
          id={textureId('image', 'dark')}
          width={PICTURE_TILE}
          height={PICTURE_TILE}
          patternUnits="userSpaceOnUse"
          patternTransform={`scale(${picture.scale})`}
        >
          <image
            href={picture.image}
            width={PICTURE_TILE}
            height={PICTURE_TILE}
            preserveAspectRatio="xMidYMid slice"
          />
        </pattern>
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
 * Under about three, a drawn texture stops reading as one. Image tiles are
 * surfaces rather than patterns and never trigger the warning.
 */
export function cyclesAcross(texture: TextureConfig, markHeight: number): number {
  if (texture.kind === 'none' || texture.kind === 'image' || isImageTexture(texture.kind)) {
    return Infinity
  }
  return markHeight / (TILE * Math.max(0.1, texture.scale))
}
