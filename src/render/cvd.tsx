/**
 * Colour vision deficiency simulation.
 *
 * The point is not the novelty — it is that a sighted designer picking a
 * twelve-hue palette has no way to know what they have just made unreadable.
 * Putting the simulation one click away turns "we should be accessible" into
 * something you can actually check while you work.
 *
 * Matrices are the Machado, Oliveira & Fernandes (2009) approximations at full
 * severity, which is the standard model browsers and design tools use.
 */

export type CvdMode = 'none' | 'greyscale' | 'protanopia' | 'deuteranopia' | 'tritanopia'

export const CVD_MODES: { id: CvdMode; label: string; note: string }[] = [
  { id: 'none', label: 'Normal', note: 'No simulation' },
  {
    id: 'greyscale',
    label: 'Brightness only',
    note: 'Strips hue, leaving what the fast, achromatic part of vision sees. If the page goes flat, nothing survives for a quick glance.',
  },
  { id: 'protanopia', label: 'Protanopia', note: 'Red-blind — about 1% of men' },
  { id: 'deuteranopia', label: 'Deuteranopia', note: 'Green-blind — the most common, about 6% of men' },
  { id: 'tritanopia', label: 'Tritanopia', note: 'Blue-blind — rare, affects all genders equally' },
]

const MATRICES: Record<Exclude<CvdMode, 'none'>, number[]> = {
  // Rec. 709 luma, replicated across all three channels.
  greyscale: [
    0.2126, 0.7152, 0.0722,
    0.2126, 0.7152, 0.0722,
    0.2126, 0.7152, 0.0722,
  ],
  protanopia: [
    0.152286, 1.052583, -0.204868,
    0.114503, 0.786281, 0.099216,
    -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968,
    0.280085, 0.672501, 0.047413,
    -0.011820, 0.042940, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779,
    -0.078411, 0.930809, 0.147602,
    0.004733, 0.691367, 0.303900,
  ],
}

/** Expand a 3×3 colour transform into the 4×5 matrix feColorMatrix expects. */
function toFeMatrix(m: number[]): string {
  return [
    m[0], m[1], m[2], 0, 0,
    m[3], m[4], m[5], 0, 0,
    m[6], m[7], m[8], 0, 0,
    0, 0, 0, 1, 0,
  ].join(' ')
}

export function CvdFilters() {
  return (
    <defs>
      {(Object.keys(MATRICES) as Exclude<CvdMode, 'none'>[]).map((mode) => (
        <filter key={mode} id={`cvd-${mode}`} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={toFeMatrix(MATRICES[mode])} />
        </filter>
      ))}
    </defs>
  )
}

export function cvdFilterUrl(mode: CvdMode): string | undefined {
  return mode === 'none' ? undefined : `url(#cvd-${mode})`
}
