/**
 * A practice session: warm up, review, then the thing you are learning.
 *
 * A level list is a menu, and a menu is not a practice session. Left to
 * choose, people play the level they are already good at, or the newest one
 * cold — and neither is how anybody's teacher would spend fifteen minutes.
 * The shape here is the one every instrumental lesson has had for two hundred
 * years:
 *
 *   1. **Warm up** on something already comfortable. Hands moving, nothing at
 *      stake, no reading problem to solve.
 *   2. **Review** what is going least well, drawn from everything passed. This
 *      is the part a menu can never offer, because it needs a memory — and it
 *      is the part that stops passed material quietly rotting.
 *   3. **The next level**, in full and in order, as written.
 *
 * Only the third part is assessed. The first two are practice, and scoring them
 * would mean a session you needed is a session you are punished for.
 *
 * Everything is drawn from the levels themselves rather than from separate
 * "session material" — the same prompts, in a different order, chosen by what
 * the record says. There is no second curriculum to keep in step with the
 * first.
 */

import type { KeyMark } from '../core/types'
import type { Prompt } from './drills'
import { notesOf } from './drills'
import { weighPrompt, today, type History } from './history'
import { isPassed, unlockedCount, type Progress } from './progress'
import { LEVELS, type Level } from './levels'
import type { Scored } from './adapt'

/** Prompts of warm-up, taken in order from an easy level. */
const WARM_UP = 2

/** Most review prompts a session will ask for. */
const REVIEW = 6

export interface Session {
  prompts: Prompt[]
  /** What to call the part of the session each prompt belongs to. */
  labels: string[]
  /**
   * Whether each prompt should be played through first.
   *
   * Per prompt, not per session, because a session draws from several levels
   * and they do not agree: a scale wants hearing before it is read, and a
   * reading drill emphatically does not — playing a single note through before
   * asking which note it is hands over the answer.
   */
  demos: boolean[]
  scored: Scored
  /** The level the scored part is, so passing it still unlocks the next. */
  level: Level | null
  /** One line for the card: what this session is going to be. */
  summary: string
}

/** Deterministic, so the same day's session is the same session. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function pick(pool: { weight: number }[], roll: number): number {
  const total = pool.reduce((sum, p) => sum + p.weight, 0)
  let target = roll * total
  for (let i = 0; i < pool.length; i += 1) {
    target -= pool[i].weight
    if (target <= 0) return i
  }
  return pool.length - 1
}

/**
 * Is there enough history for a session to be worth offering?
 *
 * One passed level. Before that a session would be a warm-up you have not
 * learnt, a review of nothing, and level one — which is just level one with
 * two thirds of it invented, and the list says that better.
 */
export const canPlanSession = (progress: Progress): boolean =>
  LEVELS.some((level) => isPassed(progress, level.id))

/**
 * The level being learnt: the first one open and not yet passed.
 *
 * If everything is passed there is nothing new, so the session focuses on
 * whichever passed level is going worst — which is what "practice" means once
 * a course has been finished.
 */
function focusOf(progress: Progress, history: History, key: KeyMark, seed: number): Level | null {
  const unlocked = unlockedCount(progress)
  const next = LEVELS.slice(0, unlocked).find((level) => !isPassed(progress, level.id))
  if (next) return next

  const day = today()
  const scored = LEVELS.map((level) => {
    const prompts = level.make(key, seed)
    const weights = prompts.map((p) => weighPrompt(history, level.id, p.id, notesOf(p), day))
    return { level, weight: weights.length ? Math.max(...weights) : 0 }
  })
  return scored.sort((a, b) => b.weight - a.weight)[0]?.level ?? null
}

export function buildSession(
  key: KeyMark,
  seed: number,
  history: History,
  progress: Progress,
): Session {
  const day = today()
  const unlocked = unlockedCount(progress)
  const open = LEVELS.slice(0, unlocked)
  const passed = open.filter((level) => isPassed(progress, level.id))
  const focus = focusOf(progress, history, key, seed)

  const prompts: Prompt[] = []
  const labels: string[] = []
  const demos: boolean[] = []
  const add = (list: Prompt[], label: string, demo: boolean) => {
    for (const prompt of list) {
      prompts.push(prompt)
      labels.push(label)
      demos.push(demo)
    }
  }

  // 1. Warm up on the earliest thing already passed — the least demanding
  //    material available, which is exactly what a warm-up wants.
  const easiest = passed[0]
  if (easiest) add(easiest.make(key, seed).slice(0, WARM_UP), 'warm up', !!easiest.demo)

  /*
   * 2. Review, drawn by weight across everything passed *except* the focus.
   *
   * Excluding the focus matters: it is about to be played in full, and drawing
   * it here as well would spend the review on the one thing the session was
   * already going to cover.
   */
  const pool = passed
    .filter((level) => level.id !== focus?.id)
    .flatMap((level) =>
      level.make(key, seed).map((prompt) => ({
        prompt,
        level,
        weight: weighPrompt(history, level.id, prompt.id, notesOf(prompt), day),
      })),
    )

  const rand = random(seed + 1)
  const chosen: typeof pool = []
  const remaining = [...pool]
  while (chosen.length < REVIEW && remaining.length > 0) {
    const index = pick(remaining, rand())
    chosen.push(remaining[index])
    // Without replacement: a session that reviews the same bar six times has
    // reviewed one bar.
    remaining.splice(index, 1)
  }
  // Back into course order, so review climbs rather than jumping about.
  chosen.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
  for (const entry of chosen) add([entry.prompt], 'review', !!entry.level.demo)

  // 3. The level itself, in full and in its own order. The only assessed part.
  const from = prompts.length
  if (focus) add(focus.make(key, seed), focus.name, !!focus.demo)
  const to = prompts.length

  const parts: string[] = []
  if (easiest) parts.push('warm up')
  if (chosen.length) parts.push(`${chosen.length} to review`)
  if (focus) parts.push(focus.name.toLowerCase())

  return {
    prompts,
    labels,
    demos,
    scored: { from, to },
    level: focus,
    summary: parts.join(' · '),
  }
}
