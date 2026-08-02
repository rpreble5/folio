/**
 * Generate the home-screen icons.
 *
 * Run by hand and commit the output:
 *
 *     node tools/gen-icons.mjs
 *
 * Rendered through the browser that is already here for testing, rather than by
 * adding an image library for six files. The source is one SVG string, so the
 * icon and the favicon cannot drift apart.
 *
 * Two sizes because that is what Chrome asks for — 192 for the home screen, 512
 * for the splash — and two shapes:
 *
 *   - **any**: the icon drawn edge to edge.
 *   - **maskable**: the same icon inset into a safe zone, because Android crops
 *     an adaptive icon to whatever shape the launcher uses. Anything outside the
 *     middle 80% can be cut, so a maskable icon that is not padded loses its
 *     corners on a circular launcher.
 */

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const INK = '#0d0f14'

/** The four bars of the palette. The same motif as the favicon. */
const bars = (pad) => {
  const w = 32 - pad * 2
  const rows = [
    { y: 7, len: 20, fill: '#f8968f' },
    { y: 13, len: 14, fill: '#e3b53c' },
    { y: 19, len: 20, fill: '#7fd08a' },
    { y: 25, len: 9, fill: '#f2994a' },
  ]
  return rows
    .map((r) => {
      const x = pad + (6 / 32) * w
      const y = pad + (r.y / 32) * w
      const width = (r.len / 32) * w
      const height = (4 / 32) * w
      const rx = height / 2
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${r.fill}"/>`
    })
    .join('')
}

/**
 * `maskable` fills the whole square with the background and insets the marks,
 * so a launcher can crop to any shape without cutting into them. `any` keeps the
 * rounded square, which is what a browser tab and a desktop shortcut expect.
 */
const svg = (maskable) =>
  maskable
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
         <rect width="32" height="32" fill="${INK}"/>${bars(4)}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
         <rect width="32" height="32" rx="7" fill="${INK}"/>${bars(0)}</svg>`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
mkdirSync('public/icons', { recursive: true })

for (const size of [192, 512]) {
  for (const maskable of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}</style>${svg(maskable)}`,
    )
    const shot = await page.screenshot({ omitBackground: false })
    const name = `public/icons/icon-${size}${maskable ? '-maskable' : ''}.png`
    writeFileSync(name, shot)
    console.log(`wrote ${name}`)
    await page.close()
  }
}

await browser.close()
