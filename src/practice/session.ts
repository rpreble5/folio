/**
 * A live practice session: keyboard in, position and highlight out.
 *
 * Owns the two mutable things — the device connection and the follower — and
 * keeps both out of React state, where a note event twenty times a second would
 * be a re-render twenty times a second for data nothing renders directly.
 *
 * Takes callbacks rather than importing the store. That avoids a cycle, but the
 * real reason is that it makes the session drivable from a test: `feed` puts
 * notes in without a device, so the whole path from key press to page turn can
 * be exercised with a synthetic player. Nothing here needs hardware to run.
 */

import type { Score } from '../core/types'
import type { MidiConnection, MidiDevice } from '../io/midi'
import { openMidi } from '../io/midi'
import type { Follower, FollowerOptions, FollowerSnapshot, Target } from './follower'
import { DEFAULT_FOLLOWER_OPTIONS, buildTargets, createFollower } from './follower'

export interface SessionHandlers {
  /** Connection state changed: devices appeared, or something failed. */
  onStatus(patch: { connected?: boolean; devices?: MidiDevice[]; error?: string | null }): void
  /** Keys down, and the score notes they account for. */
  onNotes(held: Set<number>, lit: Set<string>): void
  /** The follower moved. */
  onPosition(beat: number, snapshot: FollowerSnapshot): void
}

/**
 * What the incoming notes are for.
 *
 * `follow` runs the follower and moves the reading position. `raw` does not —
 * the notes still reach any listener, but nothing touches the score. Drills use
 * `raw`, because a drill's prompts have nothing to do with where the piece being
 * read has got to, and letting the follower run would leave the reading view
 * somewhere random when the drill ends.
 */
export type SessionMode = 'follow' | 'raw'

export interface Session {
  connect(): Promise<void>
  disconnect(): void
  setMode(mode: SessionMode): void
  /** Tap the raw note stream. Returns an unsubscribe. */
  listen(fn: (midi: number, on: boolean) => void): () => void
  /** Rebuild the follower for a different piece, or after a seek. */
  setScore(score: Score): void
  seek(beat: number): void
  /** Inject a note without a device. For tests, and for on-screen keyboards. */
  feed(midi: number, on: boolean): void
  options: FollowerOptions
  targets(): Target[]
}

export function createSession(
  handlers: SessionHandlers,
  options: FollowerOptions = DEFAULT_FOLLOWER_OPTIONS,
): Session {
  let connection: MidiConnection | null = null
  let follower: Follower | null = null
  let targets: Target[] = []
  let mode: SessionMode = 'follow'
  const listeners = new Set<(midi: number, on: boolean) => void>()

  const held = new Set<number>()
  const lit = new Set<string>()
  /** Which score notes each held key lit, so releasing it unlights exactly those. */
  const litByKey = new Map<number, string[]>()

  const press = (midi: number) => {
    if (!follower) return
    const result = follower.noteOn(midi)

    if (result.noteIds.length) {
      litByKey.set(midi, result.noteIds)
      for (const id of result.noteIds) lit.add(id)
    }
    handlers.onNotes(new Set(held), new Set(lit))

    // A wrong note must not move the position. That is the whole contract: a
    // page that turns because you fumbled is worse than one that never turns.
    if (result.verdict === 'match' || result.verdict === 'skip') {
      handlers.onPosition(result.beat, follower.snapshot())
    } else if (result.verdict === 'wrong') {
      handlers.onPosition(follower.snapshot().beat, follower.snapshot())
    }
  }

  const release = (midi: number) => {
    for (const id of litByKey.get(midi) ?? []) lit.delete(id)
    litByKey.delete(midi)
    handlers.onNotes(new Set(held), new Set(lit))
  }

  const handleNote = (midi: number, on: boolean) => {
    for (const listener of listeners) listener(midi, on)
    if (mode !== 'follow') return

    if (on) {
      // Some keyboards repeat a note-on for a key already down. Treating that as
      // a fresh press would advance the follower twice on one keystroke.
      if (held.has(midi)) return
      held.add(midi)
      press(midi)
    } else {
      if (!held.delete(midi)) return
      release(midi)
    }
  }

  return {
    options,

    setMode(next: SessionMode) {
      if (next === mode) return
      mode = next
      // Leaving follow mode with keys down would strand them lit forever.
      held.clear()
      lit.clear()
      litByKey.clear()
      handlers.onNotes(new Set(), new Set())
    },

    listen(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    async connect() {
      if (connection) return
      handlers.onStatus({ error: null })
      try {
        connection = await openMidi(
          (event) => handleNote(event.midi, event.on),
          (devices) => handlers.onStatus({ devices }),
        )
        handlers.onStatus({ connected: true, devices: connection.devices, error: null })
      } catch (error) {
        connection = null
        handlers.onStatus({
          connected: false,
          error: error instanceof Error ? error.message : 'Could not open MIDI.',
        })
      }
    },

    disconnect() {
      connection?.close()
      connection = null
      held.clear()
      lit.clear()
      litByKey.clear()
      handlers.onStatus({ connected: false, devices: [] })
      handlers.onNotes(new Set(), new Set())
    },

    setScore(score: Score) {
      targets = buildTargets(score)
      follower = createFollower(targets, options)
      held.clear()
      lit.clear()
      litByKey.clear()
      handlers.onNotes(new Set(), new Set())
    },

    seek(beat: number) {
      follower?.seek(beat)
    },

    feed: handleNote,
    targets: () => targets,
  }
}

/**
 * A player, without a player.
 *
 * Replays a score's own notes so the follower and the page turn can be tested
 * end to end with no keyboard attached — which is the only honest way to develop
 * this, since a bug that only appears on real hardware is a bug nobody can
 * reproduce.
 *
 * `mistakes` is the point of it. Perfect input proves nothing: what needs
 * testing is that a wrong note does not move the page, that a skipped bar is
 * caught up with rather than stalled on, and that a repeated note is shrugged
 * off.
 */
export interface RehearsalOptions {
  /** Fraction of presses that are a wrong note before the right one. */
  fumble: number
  /** Fraction of targets skipped entirely. */
  skip: number
  /** Deterministic seed, so a failure can be replayed exactly. */
  seed: number
}

export function rehearse(
  targets: Target[],
  play: (midi: number, on: boolean) => void,
  options: Partial<RehearsalOptions> = {},
): void {
  const { fumble = 0, skip = 0, seed = 1 } = options
  // A tiny deterministic generator: Math.random would make a failing run
  // impossible to reproduce, which is the one thing a test must never be.
  let state = seed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }

  for (const target of targets) {
    if (random() < skip) continue
    for (const pitch of target.pitches) {
      if (random() < fumble) {
        // A neighbouring key, which is what a real fumble is.
        const wrong = pitch + (random() < 0.5 ? 1 : -1)
        play(wrong, true)
        play(wrong, false)
      }
      play(pitch, true)
      play(pitch, false)
    }
  }
}
