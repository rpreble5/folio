// Trail colour, trail fade and glow: what the theme says is what the SVG draws.
//
// Run with the dev server up:  node tools/checks/surface.mjs

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const SHOTS = process.env.SHOTS ?? '/tmp/folio-surface'
mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto('http://localhost:5173/')
await page.waitForTimeout(800)
await page.locator('button').first().click()
await page.waitForSelector('.score')

const out = await page.evaluate(async () => {
  const { useStore } = await import('/src/state/store.ts')
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const st = () => useStore.getState()

  // Two held notes, one per hand, so the trail is long enough to see.
  const N = (id, midi, step, octave, hand) => ({
    id, onset: 0, duration: 3, midi, spelling: { step, alter: 0, octave },
    hand, voice: 1, measure: 0, velocity: 0.8,
    notated: { segments: [{ type: 'half', dots: 1, beats: 3 }] },
  })
  useStore.setState({
    score: {
      id: 'surf', title: 'Surface', composer: '',
      notes: [N('r', 67, 'G', 4, 'right'), N('l', 48, 'C', 3, 'left')],
      tempos: [{ beat: 0, bpm: 100 }],
      timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
      keys: [{ beat: 0, fifths: 0, mode: 'major' }],
      length: 4,
    },
  })
  st().applyPreset('chromatic-roll')
  await wait(400)

  // The two paths of a note: trail first, head last. Sorted by height, so the
  // upper one is the right hand.
  const read = () => {
    const notes = [...document.querySelectorAll('.note')]
      .map((g) => {
        const paths = [...g.querySelectorAll(':scope > path')]
        const head = paths.at(-1)
        const trail = paths.length > 1 ? paths[0] : null
        return {
          y: head.getBBox().y,
          head: head.getAttribute('fill'),
          trail: trail?.getAttribute('fill') ?? null,
          mask: trail?.getAttribute('mask') ?? null,
        }
      })
      .sort((a, b) => a.y - b.y)
    return { right: notes[0], left: notes[1] }
  }

  const plain = read()
  st().patchEncodings({ trailColor: 'hand' })
  await wait(300)
  const byHand = read()
  st().patchEncodings({ trailColor: 'ink' })
  await wait(300)
  const byInk = read()
  const ink = st().theme.surface.text

  st().patchEncodings({ trailColor: 'same', trailFade: 0.6 })
  await wait(300)
  const faded = read()
  const fadeStop = document.querySelector('#trail-fade-grad stop:last-child')?.getAttribute('stop-color')

  st().patchEncodings({ glow: 0.5 })
  await wait(300)
  const glowGroup = !!document.querySelector('.score g[filter="url(#glow)"]')
  const blur = document.querySelector('#glow feGaussianBlur')?.getAttribute('stdDeviation')

  st().patchEncodings({ glow: 0, trailFade: 0 })
  await wait(300)
  const cleared = {
    glow: !!document.querySelector('.score g[filter="url(#glow)"]') || !!document.querySelector('#glow'),
    fade: !!document.querySelector('#trail-fade') || !!read().right.mask,
  }

  // The Notes tab offers all three.
  st().setStudioTab('marks')
  await wait(300)
  const panel = document.querySelector('.panel__body')?.textContent ?? ''
  const controls = {
    colouredBy: /Trail coloured by/.test(panel) && /Register/.test(panel),
    fade: /Trail fade/.test(panel),
    glow: /Glow/.test(panel),
  }

  return { plain, byHand, byInk, ink, faded, fadeStop, glowGroup, blur, cleared, controls }
})

console.log(JSON.stringify(out, null, 1))
const fail = []
const ok = (l, c) => { if (!c) fail.push(l) }

ok(`by default the trail is the head's colour (${out.plain.right.trail} / ${out.plain.right.head})`,
  out.plain.right.trail === out.plain.right.head && out.plain.left.trail === out.plain.left.head)
ok(`by hand, the right trail is the hand colour and the head is not (${out.byHand.right.trail})`,
  out.byHand.right.trail?.toLowerCase() === '#e69f00' && out.byHand.right.head === out.plain.right.head)
ok(`and the left trail is the other hand (${out.byHand.left.trail})`,
  out.byHand.left.trail?.toLowerCase() === '#0072b2')
ok(`by ink, the trail is the page's ink (${out.byInk.right.trail} / ${out.ink})`,
  out.byInk.right.trail?.toLowerCase() === out.ink.toLowerCase())
ok(`a fade masks the trail (${out.faded.right.mask})`, out.faded.right.mask === 'url(#trail-fade)')
ok(`and the ramp ends at forty per cent (${out.fadeStop})`, out.fadeStop === 'rgb(102,102,102)')
ok(`glow filters the note group (${out.glowGroup}, blur ${out.blur})`, out.glowGroup && out.blur === '4')
ok('turning them off removes the defs and attributes', !out.cleared.glow && !out.cleared.fade)
ok(`the Notes tab offers Coloured by, Fade and Glow (${JSON.stringify(out.controls)})`,
  out.controls.colouredBy && out.controls.fade && out.controls.glow)

// A showcase for the eye: Ode to Joy on the dark roll, two-tone, fading, glowing.
await page.evaluate(async () => {
  const { useStore } = await import('/src/state/store.ts')
  const { LIBRARY } = await import('/src/core/library.ts')
  useStore.getState().loadScore(LIBRARY[0].score)
  useStore.getState().applyPreset('chromatic-roll')
  useStore.getState().patchEncodings({ trailColor: 'hand', trailFade: 0.7, glow: 0.6 })
  useStore.getState().setScreen('read')
})
await page.waitForTimeout(900)
await page.screenshot({ path: `${SHOTS}/showcase-read.png` })

console.log(fail.length ? `\nFAIL (${fail.length})\n  ${fail.join('\n  ')}` : `\nPASS — 9/9`)
await browser.close()
process.exit(fail.length ? 1 : 0)
