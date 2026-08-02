/**
 * What has been passed, and how well.
 *
 * Local only. Practice history is nobody's business but the player's, there is
 * no server to send it to, and a music app that needs an account before it will
 * remember your warm-up is an app people close.
 *
 * Storing the best score rather than the last one is deliberate: a level you have
 * played well once stays passed. Losing a badge to a bad morning is exactly the
 * kind of thing that makes people stop opening a practice app.
 */

import { LEVELS } from './levels'

const KEY = 'folio.progress.v1'

export interface Progress {
  /** Best fraction answered first-try, per level id. */
  best: Record<string, number>
}

const EMPTY: Progress = { best: {} }

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return EMPTY
    const best = (parsed as Progress).best
    return { best: best && typeof best === 'object' ? best : {} }
  } catch {
    // A corrupt entry should cost someone their badges, not the app.
    return EMPTY
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress))
  } catch {
    // Private browsing, or a full quota. Remembering is a convenience.
  }
}

export function recordResult(progress: Progress, levelId: string, score: number): Progress {
  const previous = progress.best[levelId] ?? 0
  if (score <= previous) return progress
  const next: Progress = { best: { ...progress.best, [levelId]: score } }
  saveProgress(next)
  return next
}

export const isPassed = (progress: Progress, levelId: string): boolean => {
  const level = LEVELS.find((l) => l.id === levelId)
  return level ? (progress.best[levelId] ?? 0) >= level.pass : false
}

/**
 * Which levels can be started.
 *
 * The first is always open, and each one opens when the one before it is passed.
 * A single unlock rule rather than a graph: eight levels in a line is a course
 * someone can hold in their head, and prerequisites they cannot see are just a
 * locked door.
 */
export function unlockedCount(progress: Progress): number {
  let unlocked = 1
  for (const level of LEVELS) {
    if (!isPassed(progress, level.id)) break
    unlocked += 1
  }
  return Math.min(unlocked, LEVELS.length)
}
