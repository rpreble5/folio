// Shapes: the new sets, the keys set's narrow black keys, the reader's own
// path, and the hand-drawn edge.
//
// Run with the dev server up:  node tools/checks/shapes.mjs

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const SHOTS = process.env.SHOTS ?? '/tmp/folio-shapes'
mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5173/')
await page.waitForTimeout(800)
await page.locator('button').first().click()
await page.waitForSelector('.score')

const out = await page.evaluate(async () => {
  const { useStore } = await import('/src/state/store.ts')
  const P = await import('/src/core/palettes.ts')
  const S = await import('/src/render/shapes.ts')
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const st = () => useStore.getState()

  const sets = P.SHAPE_SETS.map((s) => s.id)

  // Geometry: a star has ten corners, a pentagon five, a teardrop a point on
  // the right, and every shape closes.
  const star = S.headPath('star', 0, 0, 20, 2)
  const pentagon = S.headPath('pentagon', 0, 0, 20, 2)
  const teardrop = S.headPath('teardrop', 0, 0, 20, 2)
  const geometry = {
    starCorners: (star.match(/[ML] /g) ?? []).length,
    pentagonCorners: (pentagon.match(/[ML] /g) ?? []).length,
    teardropPoint: /L 20 10 Z$/.test(teardrop),
    closed: ['circle', 'star', 'keyWhite', 'keyBlack', 'teardrop', 'custom'].every((k) =>
      S.headPath(k, 0, 0, 20, 2).trim().endsWith('Z'),
    ),
  }

  // Two notes a semitone apart — one white key, one black — on the Keys set.
  const N = (id, midi, step, alter) => ({
    id, onset: 0, duration: 2, midi, spelling: { step, alter, octave: 4 },
    hand: 'right', voice: 1, measure: 0, velocity: 0.8,
    notated: { segments: [{ type: 'half', dots: 0, beats: 2 }] },
  })
  useStore.setState({
    score: {
      id: 'shp', title: 'Shapes', composer: '',
      notes: [N('w', 60, 'C', 0), N('b', 61, 'C', 1)],
      tempos: [{ beat: 0, bpm: 100 }],
      timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
      keys: [{ beat: 0, fifths: 0, mode: 'major' }],
      length: 4,
    },
  })
  st().applyPreset('chromatic-roll')
  st().patchEncodings({ shapeSet: 'keys' })
  await wait(400)
  const heads = [...document.querySelectorAll('.note')]
    .map((g) => {
      const paths = [...g.querySelectorAll(':scope > path')]
      const head = paths.at(-1).getBBox()
      const trail = paths.length > 1 ? paths[0].getBBox() : null
      return { y: head.y, headH: head.height, trailH: trail?.height ?? 0 }
    })
    .sort((a, b) => a.y - b.y)
  // The higher note (C#) is drawn above (smaller y).
  const keys = { black: heads[0], white: heads[1] }

  // The reader's own path is drawn scaled from its 100-unit box.
  st().patchEncodings({ shapeSet: 'custom', customShape: 'M 0 0 L 100 0 L 100 100 L 0 100 Z' })
  await wait(300)
  const customHead = document.querySelector('.note path:last-of-type')
  const custom = {
    d: customHead?.getAttribute('d'),
    transform: customHead?.getAttribute('transform'),
    stroke: customHead?.getAttribute('vector-effect'),
    size: customHead?.getBBox().width,
    laneHeight: st().theme.layout.laneHeight,
  }

  // Hand-drawn: a displacement filter on the notes, gone when off.
  st().patchEncodings({ shapeSet: 'circle', sketch: 0.5 })
  await wait(300)
  const sketch = {
    filter: !!document.querySelector('.score g[filter="url(#sketch)"]'),
    scale: document.querySelector('#sketch feDisplacementMap')?.getAttribute('scale'),
  }
  st().patchEncodings({ sketch: 0 })
  await wait(200)
  const sketchOff = !document.querySelector('#sketch') && !document.querySelector('.score g[filter="url(#sketch)"]')

  // The Notes tab offers the sets and the path box.
  st().setStudioTab('marks')
  await wait(300)
  let panel = document.querySelector('.panel__body')?.textContent ?? ''
  const studio = {
    sets: ['Teardrop', 'Star', 'Keys', 'Your own'].every((s) => panel.includes(s)),
    handDrawn: /Hand-drawn/.test(panel),
  }
  st().patchEncodings({ shapeSet: 'custom' })
  await wait(300)
  const pathBox = !!document.querySelector('.panel__body textarea.text-input--path')
  st().patchEncodings({ shapeSet: 'capsule' })

  return { sets, geometry, keys, custom, sketch, sketchOff, studio, pathBox }
})

console.log(JSON.stringify(out, null, 1))
const fail = []
const ok = (l, c) => { if (!c) fail.push(l) }

ok(`eleven shape sets, ending in the reader's own (${out.sets.join(',')})`,
  out.sets.length === 11 && out.sets.at(-1) === 'custom' && out.sets.includes('keys'))
ok(`a star has ten corners, a pentagon five (${out.geometry.starCorners}, ${out.geometry.pentagonCorners})`,
  out.geometry.starCorners === 10 && out.geometry.pentagonCorners === 5)
ok('a teardrop points toward the trail', out.geometry.teardropPoint)
ok('every head closes', out.geometry.closed)
ok(`a black key is shorter than a white one (${out.keys.black.headH.toFixed(1)} vs ${out.keys.white.headH.toFixed(1)})`,
  out.keys.black.headH < out.keys.white.headH * 0.75)
ok(`and so is its trail (${out.keys.black.trailH.toFixed(1)} vs ${out.keys.white.trailH.toFixed(1)})`,
  out.keys.black.trailH < out.keys.white.trailH * 0.75)
ok(`the reader's path is drawn as given and scaled into the box (${out.custom.transform})`,
  out.custom.d === 'M 0 0 L 100 0 L 100 100 L 0 100 Z' && /scale\(/.test(out.custom.transform ?? ''))
// getBBox ignores the element's own transform, so the scale is read from it.
const scale = Number((out.custom.transform ?? '').match(/scale\(([\d.]+)\)/)?.[1] ?? 0)
ok(`scaled to the head's size (${(scale * 100).toFixed(1)} vs ${out.keys.white.headH.toFixed(1)})`,
  Math.abs(scale * 100 - out.keys.white.headH) < 0.5)
ok('with a stroke that does not scale', out.custom.stroke === 'non-scaling-stroke')
ok(`hand-drawn displaces the notes (${out.sketch.scale})`, out.sketch.filter && out.sketch.scale === '4.5')
ok('and leaves no trace when off', out.sketchOff)
ok(`the Notes tab offers the sets and Hand-drawn (${JSON.stringify(out.studio)})`, out.studio.sets && out.studio.handDrawn)
ok('and a box for the path when Your own is chosen', out.pathBox)
ok(`no page errors (${errors.join(' | ').slice(0, 120)})`, errors.length === 0)

await page.evaluate(async () => {
  const { useStore } = await import('/src/state/store.ts')
  const { LIBRARY } = await import('/src/core/library.ts')
  const st = useStore.getState()
  st.loadScore(LIBRARY[2].score)
  st.applyPreset('classroom')
  st.patchEncodings({ shapeSet: 'keys', sketch: 0.35 })
  st.setScreen('read')
})
await page.waitForTimeout(800)
await page.screenshot({ path: `${SHOTS}/keys-sketch.png` })
await page.evaluate(async () => {
  const { useStore } = await import('/src/state/store.ts')
  const st = useStore.getState()
  st.patchEncodings({ shapeSet: 'star', sketch: 0 })
})
await page.waitForTimeout(500)
await page.screenshot({ path: `${SHOTS}/stars.png` })

console.log(fail.length ? `\nFAIL (${fail.length})\n  ${fail.join('\n  ')}` : `\nPASS — 14/14`)
await browser.close()
process.exit(fail.length ? 1 : 0)
