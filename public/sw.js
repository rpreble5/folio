/*
 * Offline, so a music stand is not a network dependency.
 *
 * A piano is often in a room with poor signal, and a page that needs a round
 * trip to open is a page that fails at exactly the wrong moment. Hand-written
 * rather than generated: it is fifty lines, and a build plugin that owns the
 * caching strategy is a thing to keep updated for no gain here.
 *
 * Two strategies, because the two kinds of file want opposite things:
 *
 *   - **Navigations go to the network first.** The HTML names which hashed
 *     bundle to load, so serving a stale one pins the app at an old version
 *     forever. Falling back to cache only when the network fails is what makes
 *     it work on a plane without freezing the app in amber.
 *   - **Everything else is cache first.** Vite's asset names contain a content
 *     hash, so a given URL's contents can never change. Going to the network to
 *     confirm that would be a round trip to learn nothing.
 *
 * Deliberately no skipWaiting. Swapping the worker mid-session can leave a
 * running page asking for chunks that the new build renamed, and a reader whose
 * app breaks mid-piece is worse served than one who gets the update next time
 * they open it.
 */

const VERSION = 'folio-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // Individually, and tolerantly: one missing file must not fail the whole
      // install and leave the app with no worker at all.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))),
    ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(VERSION).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./index.html'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        // Only opaque-free, successful responses are worth keeping; caching an
        // error would serve it back forever.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          void caches.open(VERSION).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
