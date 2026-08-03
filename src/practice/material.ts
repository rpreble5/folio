/**
 * The advanced material: real patterns, written out.
 *
 * Everything here is a thing people actually play — a turnaround, a rootless
 * voicing, a bebop scale — rather than an interval generator with a genre name
 * on it. Past the beginner levels that distinction stops being cosmetic: a
 * generated sequence of blue notes teaches reading and nothing else, while a
 * turnaround teaches reading *and* leaves the player with a turnaround.
 *
 * Written as semitone offsets from the tonic, so one definition is the exercise
 * in every key. Where a pattern has a fixed hand position — a bass figure, a
 * comping voicing — the register is chosen here and then fitted to the hand's
 * range, rather than being allowed to drift wherever the key puts it.
 */

import type { KeyMark } from '../core/types'
import type { Prompt } from './drills'
import { scoreFor } from './drills'
import {
  fitOctave,
  LEFT_HOME,
  LEFT_RANGE,
  line,
  RIGHT_HOME,
  RIGHT_RANGE,
  rootNear,
  scaleFrom,
  tonicOf,
  type Hand,
} from './tonality'

/** One prompt, built and fitted. */
function prompt(
  steps: number[][],
  key: KeyMark,
  hand: Hand,
  id: string,
  options: Parameters<typeof scoreFor>[4] = {},
  /** Override the hand's usual window — two-octave material needs a wider one. */
  range?: [number, number],
): Prompt {
  const window = range ?? (hand === 'left' ? LEFT_RANGE : RIGHT_RANGE)
  const fitted = options.bass === undefined ? fitOctave(steps, ...window) : steps
  return { id, steps: fitted, score: scoreFor(fitted, key, hand, id, options) }
}

/**
 * The window two octaves of scale has to live in.
 *
 * Wider than one hand's usual reading range for the obvious reason — the
 * material is two octaves — and it has to be, or the octave-fitting has nowhere
 * to move a key like F sharp to and leaves it four ledger lines up.
 */
const WIDE: [number, number] = [50, 86]

/** A pattern and its reverse, which is how scales and arpeggios are practised. */
const bothWays = (notes: number[]): number[][][] => [
  notes.map((n) => [n]),
  [...notes].reverse().map((n) => [n]),
]

// ---------------------------------------------------------------- scales ---

/**
 * Two octaves, in eighths.
 *
 * The step up from one octave is not the extra notes, it is the second thumb
 * crossing: one octave can be fudged by a hand that stretches, and two cannot.
 * Written in eighths because a two-octave scale played one note per beat is not
 * a scale, it is fifteen notes.
 */
export function twoOctaveScale(key: KeyMark): Prompt[] {
  const notes = scaleFrom(key, RIGHT_HOME, 15)
  return bothWays(notes).map((steps, i) =>
    prompt(steps, key, 'right', `two8ve-${i}`, { beatsPerStep: 0.5 }, WIDE),
  )
}

/**
 * The minor scales.
 *
 * Natural and harmonic on the same tonic, one after the other, because the
 * whole of what makes the harmonic minor sound the way it does is one note —
 * the raised seventh — and hearing them next to each other is the lesson.
 * Spelled with flats: these are lowered degrees of the major scale.
 */
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10, 12]
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11, 12]

export function minorScales(key: KeyMark): Prompt[] {
  const root = rootNear(tonicOf(key), RIGHT_HOME)
  const out: Prompt[] = []
  for (const [name, shape] of [
    ['natural', NATURAL_MINOR],
    ['harmonic', HARMONIC_MINOR],
  ] as const) {
    const notes = shape.map((s) => root + s)
    bothWays(notes).forEach((steps, i) => {
      out.push(prompt(steps, key, 'right', `min-${name}-${i}`, { spell: 'flat' }))
    })
  }
  return out
}

/**
 * The chromatic scale, spelled the way it is written.
 *
 * Sharps going up and flats coming down — not a stylistic preference but the
 * rule, because a raised note leads upwards and a lowered one leads down. It is
 * also the clearest possible demonstration that the spelling of a note is a
 * statement about where it is going, and reading it both ways is the exercise.
 */
export function chromaticScale(key: KeyMark): Prompt[] {
  const root = rootNear(tonicOf(key), RIGHT_HOME)
  const up = Array.from({ length: 13 }, (_, i) => root + i)
  return [
    prompt(line(0, up), key, 'right', 'chrom-up', { beatsPerStep: 0.5, spell: 'sharp' }),
    prompt(line(0, [...up].reverse()), key, 'right', 'chrom-down', {
      beatsPerStep: 0.5,
      spell: 'flat',
    }),
  ]
}

/**
 * Arpeggios on the primary chords.
 *
 * A scale asks the thumb to cross by one step; an arpeggio asks it to cross a
 * third, over a hand that is already stretched. Up and back in one gesture, on
 * the one, four, five and six, which between them are most of what a piece in
 * this key is built from.
 */
const ARPEGGIO_DEGREES = [
  { name: 'one', root: 0, shape: [0, 4, 7, 12] },
  { name: 'four', root: 5, shape: [0, 4, 7, 12] },
  { name: 'five', root: 7, shape: [0, 4, 7, 12] },
  { name: 'six', root: 9, shape: [0, 3, 7, 12] }, // the relative minor
]

export function arpeggios(key: KeyMark): Prompt[] {
  const tonic = rootNear(tonicOf(key), RIGHT_HOME)
  return ARPEGGIO_DEGREES.map((degree, i) => {
    // Up and back down, without repeating the top note.
    const shape = [...degree.shape, ...[...degree.shape].reverse().slice(1)]
    return prompt(line(tonic + degree.root, shape), key, 'right', `arp-${degree.name}-${i}`)
  })
}

/**
 * Contrary motion: both hands, moving apart.
 *
 * The oldest two-hand exercise there is, and the reason it is the first one:
 * the hands play the same scale degrees at the same time in opposite
 * directions, so there is exactly one thing to think about — the fingering is
 * mirrored, and every finger lands with its twin. Starting from a unison and
 * opening to two octaves.
 */
export function contraryMotion(key: KeyMark): Prompt[] {
  const up = scaleFrom(key, RIGHT_HOME, 8)
  const tonic = up[0]
  /*
   * The left hand starts an octave below and walks down — so the two octaves
   * below the tonic, taken in reverse.
   *
   * One octave's worth was not enough: the eighth note of a descent from the
   * tonic *is* the tonic an octave down, so a run that started there put both
   * hands on the same note, and the first "chord" of the exercise was one key.
   */
  const down = scaleFrom(key, tonic - 24, 8).reverse()
  const apart = up.map((high, i) => [down[i], high])
  return [
    prompt(apart, key, 'right', 'contrary-out', { bass: 1 }),
    prompt([...apart].reverse(), key, 'right', 'contrary-in', { bass: 1 }),
  ]
}

/**
 * The scale in broken thirds.
 *
 * Two lines played by one hand, alternating — the point at which a scale stops
 * being a run of adjacent notes and becomes a shape the eye has to take in
 * pairs. In eighths, because the pairing only shows up at speed.
 */
export function brokenThirds(key: KeyMark): Prompt[] {
  const notes = scaleFrom(key, RIGHT_HOME, 10)
  const up = notes.slice(0, 8).flatMap((_, i) => [notes[i], notes[i + 2]])
  return [
    prompt(line(0, up), key, 'right', 'thirds-up', { beatsPerStep: 0.5 }),
    prompt(line(0, [...up].reverse()), key, 'right', 'thirds-down', { beatsPerStep: 0.5 }),
  ]
}

// ----------------------------------------------------------------- blues ---

/** The shuffle figure: a root held under a fifth that climbs to the seventh. */
const SHUFFLE = [7, 9, 10, 9]

/**
 * The twelve bars, two at a time.
 *
 * Every prompt so far has been one chord. This is the form: the same figure
 * moving through the one, the four and the five in the order they actually come
 * in, so what is being practised is the change rather than the pattern. Two bars
 * at a time, which is how a twelve-bar is counted anyway.
 */
const TWELVE = [
  { name: 'one', roots: [0, 0] },
  { name: 'quick-four', roots: [-7, 0] },
  { name: 'the-four', roots: [-7, -7] },
  { name: 'back-home', roots: [0, 0] },
  { name: 'five-four', roots: [-5, -7] },
  { name: 'turnaround', roots: [0, -5] },
]

export function twelveBar(key: KeyMark): Prompt[] {
  const home = rootNear(tonicOf(key), LEFT_HOME)
  return TWELVE.map((phase, i) => {
    const steps = phase.roots.flatMap((offset) => {
      const root = home + offset
      return SHUFFLE.map((s) => [root, root + s])
    })
    return prompt(steps, key, 'left', `twelve-${phase.name}-${i}`, { spell: 'flat' })
  })
}

/**
 * The turnaround: the last two bars, where a blues gets back to the beginning.
 *
 * Two hands, because that is the only way this figure exists — a bass note
 * holding still underneath a line that walks down chromatically through it. The
 * left hand has almost nothing to do and the difficulty is entirely in doing
 * almost nothing while the right hand moves.
 */
const TURNAROUNDS: { name: string; bass: number[]; top: number[] }[] = [
  {
    // The descending one: the third falling by semitones onto the fifth.
    name: 'descending',
    bass: [0, 0, 0, 0, -5, -5, -5, 0],
    top: [16, 15, 14, 13, 11, 14, 17, 16],
  },
  {
    // And climbing back up to the seventh instead.
    name: 'rising',
    bass: [0, 0, 0, 0, -5, -5, -5, 0],
    top: [12, 13, 14, 15, 17, 14, 11, 12],
  },
]

export function turnarounds(key: KeyMark): Prompt[] {
  const bass = rootNear(tonicOf(key), LEFT_HOME)
  return TURNAROUNDS.map((shape, i) => {
    const steps = shape.bass.map((b, j) => [bass + b, bass + shape.top[j]])
    return prompt(steps, key, 'right', `turn-${shape.name}-${i}`, {
      bass: 1,
      spell: 'flat',
    })
  })
}

/** The riffs from the earlier level, doubled at the octave. */
const OCTAVE_RIFFS: { name: string; offsets: number[] }[] = [
  { name: 'boogie', offsets: [0, 4, 7, 9, 10, 9, 7, 4] },
  { name: 'answer', offsets: [12, 10, 7, 6, 5, 3, 0, 0] },
  { name: 'blue', offsets: [0, 3, 5, 6, 5, 3, 0, 0] },
]

/**
 * The same riffs in octaves.
 *
 * Nothing new to read and a great deal more to play: the hand is fixed in an
 * octave span and every note is two, so accuracy stops being negotiable. This
 * is the sound of most blues piano right hands.
 */
export function octaveRiffs(key: KeyMark): Prompt[] {
  const root = rootNear(tonicOf(key), RIGHT_HOME)
  return OCTAVE_RIFFS.map((riff, i) => {
    const steps = riff.offsets.map((o) => [root + o - 12, root + o])
    return prompt(steps, key, 'right', `oct-${riff.name}-${i}`, { spell: 'flat' })
  })
}

// ------------------------------------------------------------------ jazz ---

/**
 * Rootless voicings, the left hand's job given to the right.
 *
 * Four notes, no root, and the whole ii–V–I moves by almost nothing: two notes
 * hold, one drops a semitone, one moves a tone. Played as written they sound
 * like a record and look like almost no movement at all, which is the point —
 * the ear hears a progression and the hand barely travels.
 */
/*
 * Written as offsets from the *tonic*, not from each chord's own root.
 *
 * Building them from their roots and then adding the extensions is how a chord
 * chart describes them, and it is the wrong arithmetic here: the fifth chord's
 * root is a fifth up, so its voicing came out a fifth — and then, with the
 * thirteenth on top, an octave — above the second chord's, when the whole point
 * is that they occupy the same four notes of the keyboard and barely move.
 *
 * In C the three chords are F A C E, F A B E, and E G A D. Three notes hold from
 * the first to the second and only the C drops to a B.
 */
const ROOTLESS: { name: string; offsets: number[] }[] = [
  { name: 'ii', offsets: [5, 9, 12, 16] }, // Dm9 without its root: 3 5 7 9
  { name: 'V', offsets: [5, 9, 11, 16] }, // G13 without its root: 7 9 3 13
  { name: 'I', offsets: [4, 7, 9, 14] }, // C6/9 without its root: 3 5 6 9
]

export function rootlessVoicings(key: KeyMark): Prompt[] {
  const tonic = tonicOf(key)
  return [0, 5, 10].map((from, i) => {
    const root = rootNear((tonic + from) % 12, RIGHT_HOME)
    const steps = ROOTLESS.map((chord) => chord.offsets.map((s) => root + s))
    return prompt(steps, key, 'right', `rootless-${i}`, { beatsPerStep: 2 })
  })
}

/**
 * The bebop scales.
 *
 * An eight-note scale: the extra chromatic passing note is what makes the chord
 * tones land on the beats, which is the entire mechanism behind why bebop lines
 * sound like they fit. Descending, because that is the direction the passing
 * note was invented for.
 */
const BEBOP: { name: string; from: number; offsets: number[] }[] = [
  // Major, descending from the octave: the flat sixth is the passing note.
  { name: 'major', from: 0, offsets: [12, 11, 9, 8, 7, 5, 4, 2] },
  // Dominant, on the five: the natural seventh is the passing note.
  { name: 'dominant', from: 7, offsets: [12, 11, 10, 9, 7, 5, 4, 2] },
  // And the major one going up, where the passing note falls between five and six.
  { name: 'rising', from: 0, offsets: [0, 2, 4, 5, 7, 8, 9, 11] },
]

export function bebopScales(key: KeyMark): Prompt[] {
  const tonic = rootNear(tonicOf(key), RIGHT_HOME)
  return BEBOP.map((scale, i) =>
    prompt(line(tonic + scale.from, scale.offsets), key, 'right', `bebop-${scale.name}-${i}`, {
      beatsPerStep: 0.5,
      spell: 'flat',
    }),
  )
}

/**
 * Two–five–one with both hands: root below, voicing above.
 *
 * The left hand plays the root and the right plays the shell, which is the
 * ordinary division of labour and the first time in this course that the two
 * hands are doing genuinely different jobs at the same time. The bass moves by
 * fourths while the top two notes barely move at all.
 */
/*
 * Also from the tonic, and for a second reason beyond the arithmetic: the two
 * upper notes have to stay clear of where the hands divide.
 *
 * Offsets measured from each chord's own root put the fifth chord's third at B
 * below middle C, which the split then handed to the left hand — so the left
 * hand was asked for a root and a third a tenth apart while the right hand held
 * one note. In C the three are D3 · F4 C5, G2 · F4 B4, C3 · E4 B4.
 */
const TWO_HAND_251: number[][] = [
  [2, 17, 24], // ii7:   root, then its third and seventh
  [-5, 17, 23], // V7:   root a fourth below; the F holds, the C falls to B
  [0, 16, 23], // Imaj7: the B holds while the F resolves to E
]

export function twoHandTwoFiveOne(key: KeyMark): Prompt[] {
  const tonic = tonicOf(key)
  return [0, 5, 10].map((from, i) => {
    const root = rootNear((tonic + from) % 12, LEFT_HOME)
    const steps = TWO_HAND_251.map((chord) => chord.map((s) => root + s))
    return prompt(steps, key, 'right', `hands251-${i}`, { beatsPerStep: 2, bass: 1 })
  })
}

/**
 * The tritone substitution.
 *
 * The five chord replaced by the one a tritone away, which works because the two
 * share their third and seventh — the same two notes, swapped over. What it buys
 * is the bass: two, flat two, one, walking down by semitones, and the shell on
 * top barely moving while it happens. Reading it is how the trick stops being
 * mysterious.
 */
const TRITONE: { name: string; root: number; above: number }[] = [
  { name: 'ii', root: 2, above: 10 }, // Dm7:  D and its flat seventh, C
  { name: 'subV', root: 1, above: 10 }, // Db7: Db and its flat seventh, Cb (B)
  { name: 'I', root: 0, above: 11 }, // Cmaj7: C and its major seventh, B
]

export function tritoneSubs(key: KeyMark): Prompt[] {
  const tonic = tonicOf(key)
  return [0, 5, 10].map((from, i) => {
    const root = rootNear((tonic + from) % 12, LEFT_HOME)
    const steps = TRITONE.map((chord) => [root + chord.root, root + chord.root + chord.above])
    return prompt(steps, key, 'left', `tritone-${i}`, { beatsPerStep: 2, spell: 'flat' })
  })
}

/**
 * One–six–two–five: the turnaround that most standards are made of.
 *
 * Four chords in two bars, and the reason to read it rather than be told it is
 * that the top voice moves by a step or less every time. Once the hand knows
 * that, the progression plays itself in any key.
 */
/*
 * Thirds and sevenths alternating, which is what keeps the hand together.
 *
 * Taking the same interval on every chord looks tidier written down and is
 * unplayable: the fifth chord's third sits a tenth above its root, so a left
 * hand that has just played a comfortable seventh is asked to stretch. Alternate
 * them and every shell is between a third and a seventh wide, while the note on
 * top still moves by a step or a third each time.
 */
const ONE_SIX_TWO_FIVE: { root: number; above: number }[] = [
  { root: 0, above: 4 }, // Imaj7: root and third
  { root: -3, above: 10 }, // vi7:  root and seventh
  { root: 2, above: 3 }, // ii7:   root and third
  { root: -5, above: 10 }, // V7:   root and seventh
]

export function turnaroundChanges(key: KeyMark): Prompt[] {
  const tonic = tonicOf(key)
  return [0, 5, 10].map((from, i) => {
    const root = rootNear((tonic + from) % 12, LEFT_HOME)
    const steps = ONE_SIX_TWO_FIVE.map((chord) => [
      root + chord.root,
      root + chord.root + chord.above,
    ])
    // Half notes: four chords over two bars, which is how a turnaround falls.
    return prompt(steps, key, 'left', `onesixtwofive-${i}`, { beatsPerStep: 2 })
  })
}

/**
 * Two-bar licks over a two–five–one.
 *
 * Twice the length of the earlier ones, which is the difference between a
 * fragment and a phrase: these start on the two chord, turn at the five, and
 * land on a chord tone of the one. The last note is the whole point of the
 * first fifteen.
 */
const LONG_LICKS: { name: string; offsets: number[] }[] = [
  {
    // Up the ninth chord, down the bebop scale, chromatic onto the tonic.
    name: 'arrival',
    offsets: [2, 5, 9, 12, 14, 12, 9, 5, 11, 9, 7, 5, 4, 2, 1, 0],
  },
  {
    // An enclosure on every landing: above, below, then the note.
    name: 'enclosures',
    offsets: [9, 7, 5, 4, 5, 7, 9, 11, 12, 10, 8, 7, 5, 3, 2, 4],
  },
  {
    // The blues one: flat third against the two chord, resolving late.
    name: 'bluesy',
    offsets: [3, 5, 6, 7, 10, 9, 7, 5, 4, 3, 2, 0, 3, 4, 2, 0],
  },
]

export function longLicks(key: KeyMark): Prompt[] {
  const root = rootNear(tonicOf(key), RIGHT_HOME)
  return LONG_LICKS.map((lick, i) =>
    prompt(line(root, lick.offsets), key, 'right', `long-${lick.name}-${i}`, {
      beatsPerStep: 0.5,
      spell: 'flat',
    }),
  )
}
