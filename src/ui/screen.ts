/**
 * Making the screen behave like a music stand.
 *
 * Four separate browser capabilities, each of which fails differently and none
 * of which is guaranteed. They are gathered here so the views can ask for what
 * they want in one line and never have to care which of them was refused —
 * every one of these degrades to doing nothing.
 */

/**
 * Go fullscreen.
 *
 * **Must be called from inside a click handler.** Android will refuse a request
 * that is not attached to a real gesture, and an effect that runs after
 * navigation is not one — the promise simply rejects. That is precisely how this
 * was failing before: the reading view asked for fullscreen on mount, the
 * request was denied, and the rejection was swallowed.
 *
 * Refusal is fine and expected, so this never reports it. The view works the
 * same either way; it is just larger when it works.
 */
export function enterFullscreen(): void {
  const element = document.documentElement
  const request =
    element.requestFullscreen ??
    // Older WebKit spells it differently, and there is no cost to trying.
    (element as unknown as { webkitRequestFullscreen?: () => Promise<void> })
      .webkitRequestFullscreen

  try {
    void request?.call(element)?.catch?.(() => {})
  } catch {
    // Some browsers throw synchronously rather than rejecting.
  }
}

export function exitFullscreen(): void {
  if (!document.fullscreenElement) return
  try {
    void document.exitFullscreen?.().catch(() => {})
  } catch {
    // As above.
  }
}

interface WakeLockLike {
  release(): Promise<void>
  released: boolean
}

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> }
}

/**
 * Keep the screen awake, and keep it awake.
 *
 * Arguably the single most important thing on this page. A piece takes minutes;
 * a phone dims and locks in far less, and a reading view that goes black halfway
 * through a piece is worse than no reading view.
 *
 * The re-acquisition is not optional. A wake lock is released automatically
 * whenever the page is hidden — switching apps, answering a message — and is
 * *not* restored when you come back. Without the visibility listener the lock
 * survives exactly until the first interruption, which is the point at which
 * someone would most like it to still be there.
 *
 * Returns a function that releases it.
 */
export function keepAwake(): () => void {
  const api = (navigator as WakeLockNavigator).wakeLock
  if (!api) return () => {}

  let lock: WakeLockLike | null = null
  let stopped = false

  const acquire = () => {
    if (stopped || document.visibilityState !== 'visible') return
    api
      .request('screen')
      .then((next) => {
        if (stopped) void next.release().catch(() => {})
        else lock = next
      })
      .catch(() => {
        // Refused — a low battery mode, or the tab is not visible after all.
      })
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible' && (!lock || lock.released)) acquire()
  }

  acquire()
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisible)
    void lock?.release().catch(() => {})
    lock = null
  }
}

/**
 * Register the offline worker.
 *
 * After load rather than during it: the worker's install fetches the whole app
 * shell, and doing that while the app is still starting makes the first paint
 * compete with a download it does not need yet.
 *
 * Silent on failure. A refused registration — a private window, an unsupported
 * browser, an http origin — costs offline support and nothing else, and there is
 * nothing the reader could do about it anyway.
 */
export function registerOfflineWorker(): void {
  if (!('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
