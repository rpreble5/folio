// Image textures: bundled tiles ink themselves to the page, the reader's own
// picture tiles or covers, and the notes can wear a tile too.
//
// Run with the dev server up:  node tools/checks/textures.mjs

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const SHOTS = process.env.SHOTS ?? '/tmp/folio-textures'
mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5173/')
await page.waitForTimeout(800)
await page.locator('button').first().click()
await page.waitForSelector('.score')

// A 2x2 red/blue picture, the smallest thing that is recognisably an image.
const PICTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVQI12P4z8DwHwyBFDLj/38GAJ2mCf9ETfheAAAAAElFTkSuQmCC'

const out = await page.evaluate(async (picture) => {
  const { useStore } = await import('/src/state/store.ts')
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const st = () => useStore.getState()
  const pageTex = (patch) =>
    st().patchLayout({ pageTexture: { ...st().theme.layout.pageTexture, ...patch } })
  const pageRect = () => document.querySelector('.score > rect:nth-of-type(2)')
  const pageFillRect = () =>
    [...document.querySelectorAll('.score > rect')].find((r) => (r.getAttribute('fill') ?? '').startsWith('url('))

  // Paper on a dark page inks itself light.
  st().applyPreset('chromatic-roll')
  pageTex({ kind: 'paper', strength: 0.4 })
  await wait(400)
  const darkPage = {
    fill: pageFillRect()?.getAttribute('fill'),
    href: document.querySelector('#tex-paper-light image')?.getAttribute('href'),
    filter: document.querySelector('#tex-paper-light image')?.getAttribute('filter'),
    flood: document.querySelector('#tex-ink-light feFlood')?.getAttribute('flood-color'),
  }

  // And dark on paper.
  st().applyPreset('ink')
  pageTex({ kind: 'paper', strength: 0.4 })
  await wait(400)
  const paperPage = {
    fill: pageFillRect()?.getAttribute('fill'),
    href: document.querySelector('#tex-paper-dark image')?.getAttribute('href'),
  }

  // The tile is real: the browser could load it.
  const loaded = await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = paperPage.href ?? ''
  })

  // The reader's picture, covering.
  pageTex({ kind: 'image', image: picture, fit: 'cover', strength: 0.5 })
  await wait(300)
  const coverEl = document.querySelector('.score image.score__cover')
  const cover = {
    there: !!coverEl,
    slice: coverEl?.getAttribute('preserveAspectRatio'),
    opacity: coverEl?.getAttribute('opacity'),
    noPattern: !document.querySelector('#tex-image'),
  }

  // Tiled instead.
  pageTex({ fit: 'tile' })
  await wait(300)
  const tile = {
    pattern: !!document.querySelector('#tex-image image'),
    fill: pageFillRect()?.getAttribute('fill'),
    noCover: !document.querySelector('.score image.score__cover'),
  }

  // Notes can wear an image tile, and it takes the note texture's own ink.
  pageTex({ kind: 'none' })
  st().patchEncodings({ texture: { kind: 'linen', scale: 1, strength: 0.5, ink: 'light' } })
  await wait(300)
  const noteTile = {
    pattern: !!document.querySelector('#tex-linen-light image'),
    onNote: [...document.querySelectorAll('.note path')].some((p) => p.getAttribute('fill') === 'url(#tex-linen-light)'),
  }
  st().patchEncodings({ texture: { kind: 'none', scale: 1, strength: 0.3, ink: 'dark' } })

  // The Style tab offers the tiles and the picture.
  st().setStudioTab('styles')
  await wait(300)
  const panel = document.querySelector('.panel__body')?.textContent ?? ''
  const studio = {
    tiles: ['Paper', 'Linen', 'Kraft', 'Chalk', 'Stone'].every((t) => panel.includes(t)),
    picture: /own picture/.test(panel),
    input: !!document.querySelector('.page-picture input[type="file"]'),
  }

  return { darkPage, paperPage, loaded, cover, tile, noteTile, studio }
}, PICTURE)

console.log(JSON.stringify(out, null, 1))
const fail = []
const ok = (l, c) => { if (!c) fail.push(l) }

ok(`paper on a dark page is inked light (${out.darkPage.fill}, ${out.darkPage.filter}, ${out.darkPage.flood})`,
  out.darkPage.fill === 'url(#tex-paper-light)' && out.darkPage.filter === 'url(#tex-ink-light)' && out.darkPage.flood === '#ffffff')
ok(`and on paper it is inked dark (${out.paperPage.fill})`, out.paperPage.fill === 'url(#tex-paper-dark)')
ok(`the tile is a real file the browser can load (${JSON.stringify(out.loaded)})`, out.loaded?.w === 256)
ok(`a covering picture is drawn once, sliced (${JSON.stringify(out.cover)})`,
  out.cover.there && out.cover.slice === 'xMidYMid slice' && out.cover.opacity === '0.5' && out.cover.noPattern)
ok(`a tiled picture is a pattern (${JSON.stringify(out.tile)})`,
  out.tile.pattern && out.tile.fill === 'url(#tex-image)' && out.tile.noCover)
ok(`a note can wear linen in its own ink (${JSON.stringify(out.noteTile)})`,
  out.noteTile.pattern && out.noteTile.onNote)
ok(`the Style tab offers the tiles and a picture (${JSON.stringify(out.studio)})`,
  out.studio.tiles && out.studio.picture && out.studio.input)
ok(`no page errors (${errors.join(' | ').slice(0, 120)})`, errors.length === 0)

// For the eye: kraft on the Ink page, stone on the dark roll.
for (const [preset, kind, name] of [['ink', 'kraft', 'paper-kraft'], ['chromatic-roll', 'stone', 'dark-stone']]) {
  await page.evaluate(async ([p, k]) => {
    const { useStore } = await import('/src/state/store.ts')
    useStore.getState().applyPreset(p)
    const st = useStore.getState()
    st.patchLayout({ pageTexture: { ...st.theme.layout.pageTexture, kind: k, strength: 0.45, scale: 1 } })
    st.setScreen('read')
  }, [preset, kind])
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
  await page.evaluate(async () => {
    const { useStore } = await import('/src/state/store.ts')
    useStore.getState().setScreen('score')
  })
}

console.log(fail.length ? `\nFAIL (${fail.length})\n  ${fail.join('\n  ')}` : `\nPASS — 8/8`)
await browser.close()
process.exit(fail.length ? 1 : 0)
