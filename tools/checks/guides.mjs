// Guides under the notes: beat shading, lit lanes, chord blocks.
//
// Run with the dev server up:  node tools/checks/guides.mjs

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const SHOTS = process.env.SHOTS ?? '/tmp/folio-guides'
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
  const { LIBRARY } = await import('/src/core/library.ts')
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const st = () => useStore.getState()
  const count = (cls) => document.querySelectorAll(`.score .${cls}`).length
  const opacity = (cls) => document.querySelector(`.score .${cls}`)?.getAttribute('opacity')

  st().loadScore(LIBRARY[0].score) // Ode to Joy: 8 bars, C major, left-hand triads
  st().applyPreset('chromatic-roll')
  await wait(400)
  const none = { shade: count('score__beat-shade'), lanes: count('score__lane'), chords: count('score__chord') }

  st().patchLayout({ beatShade: 'downbeat', guideStrength: 0.1 })
  await wait(300)
  const downbeat = {
    count: count('score__beat-shade'),
    opacity: opacity('score__beat-shade'),
    width: Number(document.querySelector('.score .score__beat-shade')?.getAttribute('width')),
  }

  st().patchLayout({ beatShade: 'zebra' })
  await wait(300)
  const zebra = count('score__beat-shade')
  // One beat of a 4/4 bar is a quarter of the bar, at whatever width the
  // layout stretched the bar to.
  const barWidth = Number(document.querySelector('.score .score__beat-shade')?.getAttribute('width'))

  st().patchLayout({ beatShade: 'none', litLanes: true })
  await wait(300)
  const lanes = {
    count: count('score__lane'),
    rows: st().theme.layout.mode === 'roll' ? document.querySelectorAll('.score [data-slot]').length : 0,
  }

  st().patchLayout({ litLanes: false, chordBlocks: true })
  await wait(300)
  const chords = {
    count: count('score__chord'),
    opacity: opacity('score__chord'),
    underNotes: (() => {
      const block = document.querySelector('.score .score__chord')
      const note = document.querySelector('.score .note')
      if (!block || !note) return false
      // Document order is paint order: the block must come before the notes.
      return !!(block.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)
    })(),
  }

  // On a staff the lanes and blocks have no meaning and are not drawn.
  st().patchLayout({ litLanes: true })
  st().applyPreset('engraved')
  st().patchLayout({ litLanes: true, chordBlocks: true, beatShade: 'downbeat' })
  await wait(400)
  const staff = { lanes: count('score__lane'), chords: count('score__chord'), shade: count('score__beat-shade') }

  st().applyPreset('chromatic-roll')
  st().setStudioTab('page')
  await wait(300)
  const panel = document.querySelector('.panel__body')?.textContent ?? ''
  const studio = /Shade the beat/.test(panel) && /Light the key/.test(panel) && /Block out chords/.test(panel)

  return { none, downbeat, zebra, barWidth, lanes, chords, staff, studio }
})

console.log(JSON.stringify(out, null, 1))
const fail = []
const ok = (l, c) => { if (!c) fail.push(l) }

ok('nothing is drawn until asked', out.none.shade === 0 && out.none.lanes === 0 && out.none.chords === 0)
ok(`downbeats shade every bar (${out.downbeat.count}) at the chosen strength (${out.downbeat.opacity})`,
  out.downbeat.count === 8 && out.downbeat.opacity === '0.1')
ok(`a downbeat is a quarter of a 4/4 bar (${out.downbeat.width} of ${out.barWidth})`,
  Math.abs(out.downbeat.width * 4 - out.barWidth) < 1)
ok(`zebra shades every other bar (${out.zebra})`, out.zebra === 4)
ok(`lit lanes are drawn for the key's notes (${out.lanes.count})`, out.lanes.count > 0)
ok(`fifteen left-hand triads become fifteen blocks (${out.chords.count})`, out.chords.count === 15)
ok(`blocks sit under the notes (${out.chords.underNotes})`, out.chords.underNotes)
ok(`a staff draws the beat shade only (${JSON.stringify(out.staff)})`,
  out.staff.lanes === 0 && out.staff.chords === 0 && out.staff.shade === 8)
ok('the Form tab offers all three', out.studio)
ok(`no page errors (${errors.join(' | ').slice(0, 120)})`, errors.length === 0)

await page.evaluate(async () => {
  const { useStore } = await import('/src/state/store.ts')
  const st = useStore.getState()
  st.applyPreset('chromatic-roll')
  st.patchLayout({ beatShade: 'downbeat', litLanes: true, chordBlocks: true, guideStrength: 0.1 })
  st.setScreen('read')
})
await page.waitForTimeout(800)
await page.screenshot({ path: `${SHOTS}/guides-read.png` })

console.log(fail.length ? `\nFAIL (${fail.length})\n  ${fail.join('\n  ')}` : `\nPASS — 10/10`)
await browser.close()
process.exit(fail.length ? 1 : 0)
