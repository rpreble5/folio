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

// ---------------------------------------------------------------------------
// The way back
// ---------------------------------------------------------------------------

function decode(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** sRGB hex → OKLab. Needed to adjust a colour we did not generate. */
export function hexToOklab(hex: string): { L: number; a: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return null
  const [R, G, B] = [m[1], m[2], m[3]].map((h) => decode(parseInt(h, 16)))

  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const mm = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)

  // Each row sums to zero for a neutral (a and b) or to one (L). Worth
  // remembering: a transposed digit here tints every colour instead of failing,
  // which is the kind of bug that only shows up as "why is everything pink".
  return {
    L: 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s,
  }
}

export function lightnessOf(hex: string): number {
  return hexToOklab(hex)?.L ?? 0.5
}

/**
 * Nudge a colour's lightness while holding its hue and chroma.
 *
 * Working in OKLab means the hue survives the move — lightening a blue in sRGB
 * drifts it toward cyan, which would corrupt whatever the hue was encoding.
 */
export function shiftLightness(hex: string, delta: number): string {
  const lab = hexToOklab(hex)
  if (!lab || delta === 0) return hex
  const L = Math.min(0.99, Math.max(0.02, lab.L + delta))
  const chroma = Math.hypot(lab.a, lab.b)
  const hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  return oklch(L, chroma, hue)
}

/**
 * Move a colour to an absolute lightness, capping how much chroma comes with it.
 *
 * The cap is the point. A pale cream carries little chroma *relative to its
 * lightness*, but that same chroma at a much lower lightness reads as vivid
 * pink — so deriving a dark line from a light page by lightness alone produces
 * a colour, not a grey. Capping keeps the page's hue as a tint.
 */
export function withLightness(hex: string, L: number, chromaCap: number): string {
  const lab = hexToOklab(hex)
  if (!lab) return hex
  const chroma = Math.min(Math.hypot(lab.a, lab.b), chromaCap)
  const hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  return oklch(Math.min(0.99, Math.max(0.02, L)), chroma, hue)
}
