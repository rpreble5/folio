/**
 * Generate src/render/glyphs.ts from Bravura's outlines.
 *
 * Run once, by hand, and commit the result:
 *
 *     npm install --no-save vexflow@4.2.3
 *     node tools/gen-glyphs.mjs
 *
 * Why generate rather than hand-draw: a G clef is a spiral with a
 * counter-curve, and the difference between a good one and a bad one is the
 * difference between the app looking like sheet music and looking like a
 * facsimile of it. Bravura is the SMuFL reference font and its shapes are the
 * ones a reader's eye is trained on.
 *
 * Why generate rather than ship the font: what lands in the repo is a list of
 * path strings. Nothing loads at runtime, nothing waits on a font, and any one
 * glyph can be replaced with our own drawing by editing one string — which is
 * the whole premise of the app applied to its own notation.
 *
 * Two conversions happen here, and both matter:
 *
 *   - **Units.** Everything comes out in staff spaces, so a path is independent
 *     of the staff size — the renderer scales by whatever staff space is in
 *     force and the glyph is right by construction. Note that the outlines and
 *     the bounding boxes arrive in two *different* unit scales; see below.
 *
 *   - **Direction.** Font y points up, screen y points down, so y is negated.
 *     That also puts the origin where notation wants it: y=0 is the glyph's
 *     baseline, which for a clef or a rest is the staff line it attaches to.
 */

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// By file path, not package name: vexflow's package exports do not expose the
// font modules, and this script is reaching past the public API on purpose.
const source = pathToFileURL(
  'node_modules/vexflow/build/esm/src/fonts/bravura_glyphs.js',
).href
const GLYPHS = Object.values(await import(source))[0].glyphs

/**
 * One staff space, in units — and there are two answers, which is a trap.
 *
 * VexFlow's records carry the bounding box (`x_min`, `y_max`, …) and the outline
 * (`o`) in *different* scales, differing by a factor of about 1.44. Using one
 * divisor for both produces glyphs whose paths and whose reserved widths
 * disagree by 44%, which looks like a spacing bug rather than a unit bug and is
 * a genuinely annoying afternoon.
 *
 * Both numbers are pinned by SMuFL's definition that a black notehead is exactly
 * one staff space tall: it measures 250 in the metrics and 360 in the outline.
 */
const SPACE_METRICS = 250
const SPACE_OUTLINE = 360

/**
 * What we take, grouped the way the renderer asks for it.
 *
 * Deliberately not the whole font. 442 glyphs is most of a megabyte of path
 * data, and Tier 1 needs 42 of them; anything else can be added the day it is
 * drawn on the page.
 */
const WANTED = {
  clef: {
    G: 'gClef',
    F: 'fClef',
    C: 'cClef',
  },
  rest: {
    breve: 'restDoubleWhole',
    whole: 'restWhole',
    half: 'restHalf',
    quarter: 'restQuarter',
    eighth: 'rest8th',
    '16th': 'rest16th',
    '32nd': 'rest32nd',
    '64th': 'rest64th',
    '128th': 'rest128th',
  },
  accidental: {
    sharp: 'accidentalSharp',
    flat: 'accidentalFlat',
    natural: 'accidentalNatural',
    'double-sharp': 'accidentalDoubleSharp',
    'sharp-sharp': 'accidentalDoubleSharp',
    'flat-flat': 'accidentalDoubleFlat',
  },
  flag: {
    eighthUp: 'flag8thUp',
    eighthDown: 'flag8thDown',
    '16thUp': 'flag16thUp',
    '16thDown': 'flag16thDown',
    '32ndUp': 'flag32ndUp',
    '32ndDown': 'flag32ndDown',
  },
  head: {
    black: 'noteheadBlack',
    half: 'noteheadHalf',
    whole: 'noteheadWhole',
    breve: 'noteheadDoubleWhole',
  },
  digit: Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [String(i), `timeSig${i}`]),
  ),
  mark: {
    dot: 'augmentationDot',
    accentAbove: 'articAccentAbove',
    accentBelow: 'articAccentBelow',
    staccatoAbove: 'articStaccatoAbove',
    staccatoBelow: 'articStaccatoBelow',
    tenutoAbove: 'articTenutoAbove',
    tenutoBelow: 'articTenutoBelow',
  },
}

/** Trim to 4 decimals in staff spaces — about a thousandth of a pixel on screen. */
const round = (v) => {
  const r = Math.round(v * 10000) / 10000
  return Object.is(r, -0) ? 0 : r
}

/** Outline coordinate to staff spaces. */
const n = (v) => round(v / SPACE_OUTLINE)

/** Metrics coordinate to staff spaces. */
const mn = (v) => round(v / SPACE_METRICS)

/**
 * VexFlow's outline format to an SVG path.
 *
 * The token orders differ from SVG's: a curve gives its *end* point first and
 * its controls after. Getting that backwards produces a shape that is the right
 * size and completely wrong, which is exactly the kind of bug that survives a
 * glance at a screenshot, so it is worth naming here.
 */
function toPath(outline) {
  const t = outline.split(' ').filter(Boolean)
  const out = []
  let i = 0

  while (i < t.length) {
    const op = t[i++]
    const f = () => Number(t[i++])

    switch (op) {
      case 'm': {
        const x = f(), y = f()
        out.push(`M${n(x)} ${n(-y)}`)
        break
      }
      case 'l': {
        const x = f(), y = f()
        out.push(`L${n(x)} ${n(-y)}`)
        break
      }
      case 'q': {
        // end, then one control.
        const x = f(), y = f(), cx = f(), cy = f()
        out.push(`Q${n(cx)} ${n(-cy)} ${n(x)} ${n(-y)}`)
        break
      }
      case 'b': {
        // end, then two controls.
        const x = f(), y = f(), c1x = f(), c1y = f(), c2x = f(), c2y = f()
        out.push(`C${n(c1x)} ${n(-c1y)} ${n(c2x)} ${n(-c2y)} ${n(x)} ${n(-y)}`)
        break
      }
      case 'z':
      case 'Z':
        out.push('Z')
        break
      default:
        throw new Error(`unknown outline op ${op}`)
    }
  }

  // Bravura's outlines rely on an implicit close per subpath; SVG fill does the
  // same with nonzero winding, but closing explicitly keeps strokes usable if a
  // theme ever outlines a glyph.
  return out.join('') + 'Z'
}

function metricsOf(glyph) {
  return {
    // Advance width, which is what spacing needs from a glyph.
    width: mn(glyph.x_max - glyph.x_min),
    left: mn(glyph.x_min),
    top: mn(-glyph.y_max),
    bottom: mn(-glyph.y_min),
  }
}

let ts = `/**
 * Notation glyphs, as SVG paths in staff-space units.
 *
 * GENERATED by tools/gen-glyphs.mjs — do not edit by hand, or rather: do, but
 * know that regenerating overwrites it. Each entry is an ordinary path string,
 * so replacing one with our own drawing is a one-line change and the rest of
 * the system neither knows nor cares.
 *
 * Coordinates are in **staff spaces**, not pixels, with y increasing downward
 * and the origin at the glyph's attachment point — the staff line a clef wraps,
 * the middle line a rest hangs from, the notehead's centre. Scale by the staff
 * space in force and the glyph is the right size by construction.
 *
 * Outlines derive from Bravura, the SMuFL reference font, © Steinberg Media
 * Technologies GmbH & Co. KG, under the SIL Open Font License 1.1. See
 * LICENSES.md.
 */

export interface GlyphMetrics {
  /** Advance width in staff spaces. What spacing reserves for the glyph. */
  width: number
  /** Bounding box, in staff spaces, y down. */
  left: number
  top: number
  bottom: number
}

export interface Glyph extends GlyphMetrics {
  path: string
}

`

let count = 0
for (const [group, entries] of Object.entries(WANTED)) {
  const lines = []
  for (const [key, name] of Object.entries(entries)) {
    const glyph = GLYPHS[name]
    if (!glyph) throw new Error(`Bravura has no glyph named ${name}`)
    const m = metricsOf(glyph)
    lines.push(
      `  ${JSON.stringify(key)}: { width: ${m.width}, left: ${m.left}, top: ${m.top}, bottom: ${m.bottom}, path: ${JSON.stringify(toPath(glyph.o))} },`,
    )
    count += 1
  }
  const type = `Record<string, Glyph>`
  ts += `export const ${group.toUpperCase()}_GLYPHS: ${type} = {\n${lines.join('\n')}\n}\n\n`
}

writeFileSync('src/render/glyphs.ts', ts)
console.log(`wrote src/render/glyphs.ts — ${count} glyphs`)
