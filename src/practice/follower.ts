/**
 * Score following: turning what was played into where the player is.
 *
 * MIDI itself is exact — there is no ambiguity about which key went down. The
 * hard part is alignment: deciding which moment in the score a key press
 * belongs to when the player skips a note, repeats a bar, hesitates, or fumbles.
 *
 * This does **pitch and order only**. Timing is deliberately not consulted, and
 * that is a design decision rather than a simplification: judging a learner on
 * rubato is the opposite of making music less intimidating, and for the one job
 * this has — knowing which system to show — timing adds nothing. A player who
 * takes four seconds over a chord is still on that chord.
 *
 * Two properties matter more than accuracy:
 *
 *   - **A wrong note must never move the position.** The page turn is the thing
 *     this drives, and a page that turns because you fumbled is worse than one
 *     that does not turn at all.
 *   - **It must not be able to stall.** If the player skips ahead, the follower
 *     jumps to meet them rather than waiting for a note that is never coming.
 *
 * Pure and DOM-free, driven only by a stream of pitches, so the whole thing can
 * be exercised with a synthetic player — which is the only way to test it
 * without a keyboard plugged in.
 */

import type { Score } from '../core/types'

/**
 * One moment to be played: everything that sounds together.
 *
 * The same unit the engraver spaces by, and for the same reason — a chord is one
 * event, not three. Both hands are in one target, so a grand-staff chord matches
 * when all of it has been played, in any order within the chord.
 */
export interface Target {
  index: number
  beat: number
  /** MIDI numbers sounding at this moment. */
  pitches: number[]
  /** Score note ids, for lighting up what was hit. */
  noteIds: string[]
}

export type Verdict =
  /** Belonged to the target we were waiting for. */
  | 'match'
  /** Belonged to a later target: the player skipped ahead, so we followed. */
  | 'skip'
  /** Belonged to the target just finished — a re-strike or a held key. Harmless. */
  | 'again'
  /** Belonged nowhere in range. */
  | 'wrong'

export interface FollowResult {
  verdict: Verdict
  /** Score notes this press accounted for, if any. */
  noteIds: string[]
  /** Where the follower now believes the player is, in beats. */
  beat: number
  /** How many targets were jumped over, when the verdict is a skip. */
  skipped: number
}

export interface FollowerOptions {
  /**
   * How far ahead a press may be matched, in targets.
   *
   * Small values make the follower stubborn — it will call a skipped phrase a
   * run of wrong notes and stay put. Large values make it flighty: a note that
   * happens to appear again in twenty targets' time will drag the page with it.
   * Eight covers a skipped bar of quavers without reaching into the next phrase.
   */
  lookahead: number
  /** Accept a note played in the wrong octave. Off: an octave error is an error. */
  octaveTolerant: boolean
}

export const DEFAULT_FOLLOWER_OPTIONS: FollowerOptions = {
  lookahead: 8,
  octaveTolerant: false,
}

/** Onsets closer together than this are the same moment. */
const EPSILON = 1e-3

/**
 * Every moment in the score that has something to play, in order.
 *
 * Rests produce no targets: there is nothing to press, and waiting for silence
 * would stall the follower at every phrase end.
 */
export function buildTargets(score: Score): Target[] {
  const byBeat = new Map<number, { pitches: number[]; noteIds: string[] }>()

  for (const note of score.notes) {
    const beat = Math.round(note.onset / EPSILON) * EPSILON
    const bucket = byBeat.get(beat)
    if (bucket) {
      bucket.pitches.push(note.midi)
      bucket.noteIds.push(note.id)
    } else {
      byBeat.set(beat, { pitches: [note.midi], noteIds: [note.id] })
    }
  }

  return Array.from(byBeat.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([beat, bucket], index) => ({ index, beat, ...bucket }))
}

export interface FollowerSnapshot {
  /** Index of the target being waited for. */
  cursor: number
  beat: number
  matched: number
  wrong: number
  skipped: number
  /**
   * How well recent presses have agreed with the score, 0 to 1.
   *
   * A rolling average rather than a total, so a rough opening does not haunt the
   * rest of the piece. Reported, not acted on — the follower advances on
   * evidence, and confidence is for telling the *player* how it is doing.
   */
  confidence: number
  /** True once every target has been played. */
  finished: boolean
}

export interface Follower {
  noteOn(midi: number): FollowResult
  /** Jump the cursor, for a manual resync or a restart. */
  seek(beat: number): void
  snapshot(): FollowerSnapshot
  /** Notes of the target currently being waited for. */
  expecting(): Target | undefined
}

/** Weight of the newest press in the rolling confidence. */
const CONFIDENCE_ALPHA = 0.25

export function createFollower(
  targets: Target[],
  options: FollowerOptions = DEFAULT_FOLLOWER_OPTIONS,
): Follower {
  let cursor = 0
  let pending = new Set(targets[0]?.pitches ?? [])
  let matched = 0
  let wrong = 0
  let skipped = 0
  let confidence = 0

  const sameNote = (a: number, b: number) =>
    options.octaveTolerant ? (((a - b) % 12) + 12) % 12 === 0 : a === b

  const enter = (index: number) => {
    cursor = index
    pending = new Set(targets[index]?.pitches ?? [])
  }

  const beatNow = () => targets[Math.min(cursor, targets.length - 1)]?.beat ?? 0

  const credit = (hit: boolean) => {
    confidence = confidence * (1 - CONFIDENCE_ALPHA) + (hit ? CONFIDENCE_ALPHA : 0)
  }

  /** Remove one pitch from the pending set, honouring octave tolerance. */
  const consume = (midi: number): boolean => {
    for (const pitch of pending) {
      if (sameNote(midi, pitch)) {
        pending.delete(pitch)
        return true
      }
    }
    return false
  }

  return {
    noteOn(midi: number): FollowResult {
      const target = targets[cursor]
      if (!target) {
        return { verdict: 'wrong', noteIds: [], beat: beatNow(), skipped: 0 }
      }

      // 1. The note we were waiting for.
      if (consume(midi)) {
        matched += 1
        credit(true)
        const ids = idsFor(target, midi, sameNote)
        // A finished chord moves us on, which is what makes the display advance
        // as the last note of a system is released rather than after it.
        if (pending.size === 0 && cursor < targets.length - 1) enter(cursor + 1)
        else if (pending.size === 0) cursor = targets.length - 1
        return { verdict: 'match', noteIds: ids, beat: beatNow(), skipped: 0 }
      }

      // 2. A note from further on: the player skipped, so follow rather than
      //    stall. Only inside the window — beyond it, a coincidental pitch match
      //    is far more likely than a genuine leap.
      for (let k = 1; k <= options.lookahead; k += 1) {
        const ahead = targets[cursor + k]
        if (!ahead) break
        if (!ahead.pitches.some((p) => sameNote(midi, p))) continue

        skipped += k
        matched += 1
        credit(true)
        enter(cursor + k)
        consume(midi)
        const ids = idsFor(ahead, midi, sameNote)
        if (pending.size === 0 && cursor < targets.length - 1) enter(cursor + 1)
        return { verdict: 'skip', noteIds: ids, beat: beatNow(), skipped: k }
      }

      // 3. Something from the target just finished — a re-strike, or a key
      //    pressed again while its chord was still under the hands. Not an
      //    error, and it must not move anything.
      const previous = targets[cursor - 1]
      if (previous?.pitches.some((p) => sameNote(midi, p))) {
        return { verdict: 'again', noteIds: [], beat: beatNow(), skipped: 0 }
      }

      wrong += 1
      credit(false)
      return { verdict: 'wrong', noteIds: [], beat: beatNow(), skipped: 0 }
    },

    seek(beat: number) {
      let index = targets.findIndex((t) => t.beat >= beat - EPSILON)
      if (index < 0) index = Math.max(0, targets.length - 1)
      enter(index)
    },

    snapshot(): FollowerSnapshot {
      return {
        cursor,
        beat: beatNow(),
        matched,
        wrong,
        skipped,
        confidence,
        finished: cursor >= targets.length - 1 && pending.size === 0,
      }
    },

    expecting: () => targets[cursor],
  }
}

/** Which score notes in a target a given key press accounts for. */
function idsFor(
  target: Target,
  midi: number,
  sameNote: (a: number, b: number) => boolean,
): string[] {
  const ids: string[] = []
  for (const [i, pitch] of target.pitches.entries()) {
    if (sameNote(midi, pitch)) ids.push(target.noteIds[i])
  }
  return ids
}
