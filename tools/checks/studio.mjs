// The studio panel: every tab fits without scrolling, at every size that matters.
//
// Run with the dev server up:  node tools/checks/studio.mjs
// Screenshots land in the directory named by SHOTS (defaults to /tmp/folio-studio).

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const SHOTS = process.env.SHOTS ?? '/tmp/folio-studio'
mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

// A tablet held sideways, a laptop, a small tablet sideways, a tablet upright.
const VIEWPORTS = [
  [1280, 800],
  [1100, 900],
  [1024, 768],
  [800, 1280],
]

const fail = []
const ok = (l, c) => { if (!c) fail.push(l) }
const results = []

for (const [w, h] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto('http://localhost:5173/')
  await page.waitForTimeout(800)
  await page.locator('button').first().click()
  await page.waitForSelector('.score')

  for (const preset of ['Classroom', 'Engraved']) {
    await page.locator('.tab', { hasText: 'Style' }).first().click()
    await page.locator('.preset-tile', { hasText: preset }).click()
    await page.waitForTimeout(300)

    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('.tab')].map((t) => t.textContent.trim()),
    )
    const shot = { w, h, preset, tabs, fits: {}, overflow: {} }

    for (const label of tabs) {
      await page.locator('.tab', { hasText: label }).first().click()
      await page.waitForTimeout(280)
      const m = await page.evaluate(() => {
        const body = document.querySelector('.panel__body')
        const strip = document.querySelector('.stage').getBoundingClientRect()
        return {
          fits: body.scrollHeight <= body.clientHeight + 1,
          wide: body.scrollWidth <= body.clientWidth + 1,
          over: body.scrollHeight - body.clientHeight,
          strip: Math.round(strip.height),
          blurb: document.querySelector('.tabs__blurb')?.textContent ?? '',
        }
      })
      shot.fits[label] = m.fits
      shot.overflow[label] = m.over
      shot.strip = m.strip
      ok(`${w}x${h} ${preset} · ${label} fits without scrolling (${m.over}px over)`, m.fits)
      ok(`${w}x${h} ${preset} · ${label} does not overflow sideways`, m.wide)
      if ((w === 1280 && h === 800) || (w === 1024 && h === 768) || (w === 800 && h === 1280)) {
        await page.screenshot({ path: `${SHOTS}/${w}-${preset.toLowerCase()}-${label.toLowerCase()}.png` })
      }
    }
    results.push(shot)

    const expected = preset === 'Engraved'
      ? ['Style', 'Form', 'Notation', 'Colour', 'Emphasis', 'Notes', 'Labels', 'Lines']
      : ['Style', 'Form', 'Colour', 'Emphasis', 'Notes', 'Labels', 'Lines']
    ok(`${w}x${h} ${preset} · tabs are ${expected.join('/')} (${tabs.join('/')})`,
      tabs.join() === expected.join())
    const strip = Math.round(Math.min(280, Math.max(120, 0.22 * h)))
    ok(`${w}x${h} · the preview strip is ${strip}px (${shot.strip})`, Math.abs(shot.strip - strip) <= 2)
  }

  // Contents landed where the map says.
  const placed = await page.evaluate(async () => {
    const click = (label) =>
      [...document.querySelectorAll('.tab')].find((t) => t.textContent.trim() === label)?.click()
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const has = (sel) => !!document.querySelector(sel)
    const hasText = (text) => document.querySelector('.panel__body')?.textContent.includes(text)
    click('Style'); await wait(250)
    const styleHasPage = has('.page-swatch') && !hasText('Protanopia')
    click('Colour'); await wait(250)
    const colourHasCvd = hasText('Protanopia')
    click('Form'); await wait(250)
    const formHasRollStaff = hasText('Roll') && hasText('Staff') && hasText('Width means')
    click('Notation'); await wait(250)
    const notationNoSpacing = !hasText('Width means') && hasText('Stems')
    // Switching to a roll while on Notation lands on Form.
    const { useStore } = await import('/src/state/store.ts')
    useStore.getState().applyPreset('classroom')
    await wait(300)
    const landed = [...document.querySelectorAll('.tab')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent.trim()
    // Contrast of the muted ink against the panel.
    const css = getComputedStyle(document.documentElement)
    const hex = (v) => v.trim().replace('#', '')
    const lum = (h) => {
      const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (lum(hex(css.getPropertyValue('--ink-3'))) + 0.05) / (lum(hex(css.getPropertyValue('--surface'))) + 0.05)
    return { styleHasPage, colourHasCvd, formHasRollStaff, notationNoSpacing, landed, ratio: +ratio.toFixed(2) }
  })
  if (w === 1280) {
    ok(`page colour lives on Style, the colour check does not`, placed.styleHasPage)
    ok(`the colour check lives on Colour`, placed.colourHasCvd)
    ok(`Form opens with Roll/Staff and holds Spacing`, placed.formHasRollStaff)
    ok(`Notation keeps the furniture and lost Spacing`, placed.notationNoSpacing)
    ok(`leaving the staff while on Notation lands on Form (${placed.landed})`, placed.landed === 'Form')
    ok(`muted ink clears 4.5:1 on the panel (${placed.ratio})`, placed.ratio >= 4.5)
  }
  await page.close()
}

console.log(JSON.stringify(results.map((r) => ({ size: `${r.w}x${r.h}`, preset: r.preset, strip: r.strip, over: r.overflow })), null, 1))
const total = fail.length
console.log(total ? `\nFAIL (${total})\n  ${fail.join('\n  ')}` : `\nPASS — studio fits everywhere`)
await browser.close()
process.exit(total ? 1 : 0)
