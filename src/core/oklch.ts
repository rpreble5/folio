/**
 * OKLCH → sRGB.
 *
 * Palettes are generated rather than hand-picked because eyeballing twelve hex
 * values gives uneven results: HSL treats yellow and blue at the same
 * "lightness" as equal when they are nothing of the sort. OKLCH is
 * perceptually uniform, so one lightness and one chroma across twelve hues
 * produces twelve colours that actually look equally vivid — which is the whole
 * point when the hue is carrying meaning.
 */

/** Gamma-encode a linear sRGB channel. */
function encode(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
}

function toLinearRgb(L: number, C: number, hDegrees: number): [number, number, number] {
  const h = (hDegrees * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = ([r, g, b]: [number, number, number]): boolean =>
  r >= -0.0001 && r <= 1.0001 && g >= -0.0001 && g <= 1.0001 && b >= -0.0001 && b <= 1.0001

/**
 * Convert to a hex colour, reducing chroma until the result fits in sRGB.
 *
 * Clamping the channels instead would shift the hue — a vivid blue that clips
 * comes back purple — so the saturation gives way and the hue survives. That
 * matters here because hue is the thing carrying the pitch.
 */
export function oklch(L: number, C: number, hue: number): string {
  let lo = 0
  let hi = C

  if (inGamut(toLinearRgb(L, C, hue))) {
    lo = C
  } else {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(toLinearRgb(L, mid, hue))) lo = mid
      else hi = mid
    }
  }

  const [r, g, b] = toLinearRgb(L, lo, hue)
  return `#${[encode(r), encode(g), encode(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Text colour for a swatch, decided from OKLCH lightness directly rather than
 * by round-tripping through luminance. 0.72 is roughly where black text starts
 * winning on a mid-chroma background.
 */
export function inkOn(L: number): string {
  return L > 0.72 ? '#0f1116' : '#f4f6fb'
}
