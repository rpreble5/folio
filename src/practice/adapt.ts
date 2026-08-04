/**
 * Building a run out of a level's prompts and what the app remembers.
 *
 * The rule is deliberately conservative: **the level is always played as
 * written, and then whatever you are struggling with comes round again.**
 *
 * The obvious design — pick prompts by weight instead of playing the level —
 * is worse in two ways. It throws away the order the material was written in,
 * which is usually doing something (a scale up and then down is one idea, not
 * two), and on a bad day it produces a run made entirely of the thing you
 * cannot do, which is how a practice app becomes something people stop
 * opening. Appending instead means a good run is exactly the level, and a bad
 * one earns a few more turns at the part that went wrong.
 *
 * Nothing is ever dropped and nothing is ever repeated back to back.
 *
 * `make` stays pure and seeded — adaptation happens to the list it returns, not
 * inside it — so a level is still reproducible from a seed, and the extras are
 * reproducible from a seed plus a history.
 */

import type { Prompt } from './drills'
import { notesOf } from './drills'
import { weighPrompt, today, type History } from './history'

/**
 * Weight above which something is worth another turn.
 *
 * Just above the 1.5 that unseen material scores, so a level you have never
 * played is delivered exactly as written — a first run should be the lesson
 * somebody designed, not a guess about you. A prompt answered cleanly and
 * recently scores 1.
 */
const WORTH_REPEATING = 1.6

/** Extras are capped twice over: by a fraction of the run, and absolutely. */
const EXTRA_FRACTION = 0.5
const EXTRA_LIMIT = 4

/**
 * Which prompts of a run count toward the pass mark.
 *
 * A range rather than a length, because the assessed part is not always at the
 * front: a level run is the level and then some extra turns, but a session is a
 * warm-up and some review *before* the level it is assessing.
 *
 * Everything outside the range is practice. The extra turns are there because
 * something went wrong, and counting them would mean being bad at a level makes
 * it harder to pass — a penalty for needing the practice they exist to give.
 */
export interface Scored {
  from: number
  to: number
}

export interface Run {
  prompts: Prompt[]
  scored: Scored
}

/** Deterministic, so a run can be replayed exactly given the same history. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** One weighted draw. */
function pick(pool: { prompt: Prompt; weight: number }[], roll: number): number {
  const total = pool.reduce((sum, p) => sum + p.weight, 0)
  let target = roll * total
  for (let i = 0; i < pool.length; i += 1) {
    target -= pool[i].weight
    if (target <= 0) return i
  }
  return pool.length - 1
}

export function buildRun(
  prompts: Prompt[],
  history: History,
  levelId: string,
  seed: number,
): Run {
  const scored: Scored = { from: 0, to: prompts.length }
  if (prompts.length === 0) return { prompts, scored }

  const day = today()
  const pool = prompts
    .map((prompt) => ({
      prompt,
      weight: weighPrompt(history, levelId, prompt.id, notesOf(prompt), day),
    }))
    .filter((entry) => entry.weight >= WORTH_REPEATING)

  if (pool.length === 0) return { prompts, scored }

  const count = Math.min(
    EXTRA_LIMIT,
    Math.max(1, Math.floor(prompts.length * EXTRA_FRACTION)),
    // Never more extras than there are things worth repeating, doubled: three
    // bad prompts can justify six turns, one bad prompt cannot justify four.
    pool.length * 2,
  )

  const rand = random(seed)
  const extras: Prompt[] = []
  /*
   * Seeded with the last prompt of the level, not with nothing.
   *
   * The extras are appended, so the first of them sits directly after the final
   * prompt as written — and if they are the same prompt, that is a back-to-back
   * repeat just as much as two extras in a row would be. It also stops the
   * play-through: the demo is keyed on the prompt's identity, so an immediate
   * repeat of the same prompt is not played through again.
   */
  let last = prompts[prompts.length - 1].id
  for (let i = 0; i < count; i += 1) {
    let index = pick(pool, rand())
    // Not twice in a row. Playing the same bar twice over is memorising it, and
    // the point of the repeat is to read it again.
    if (pool.length > 1 && pool[index].prompt.id === last) {
      index = (index + 1) % pool.length
    }
    last = pool[index].prompt.id
    extras.push(pool[index].prompt)
  }

  return { prompts: [...prompts, ...extras], scored }
}
