/**
 * A short course, in order.
 *
 * One chain, each level unlocking the next. Levels carry a group — Reading,
 * Scales, Blues, Jazz — but that is a filing label for the list and nothing
 * more: there is still one order and one unlock rule, because the whole value of
 * gating is being told *this next*, and two orders cannot both be next.
 *
 * Two kinds of material, and the difference matters:
 *
 *   - **Warm-ups are fixed.** The same notes in the same order every time. You
 *     are not reading them by the third day, and that is the point — a warm-up is
 *     for getting the hands moving, and one that changes underneath you is a
 *     test rather than a warm-up.
 *   - **Everything else is generated** from a seed, so it is different each
 *     attempt but reproducible when something goes wrong.
 *
 * Levels are ordered by what they ask of the reader, not by how the music
 * sounds: hand position first, then steps, then leaps, then chords. Reading a
 * third is genuinely harder than reading a second, and reading a chord is harder
 * than either, because the eye has to take three heights at once.
 */

import type { KeyMark } from '../core/types'
import type { Prompt } from './drills'
import { scoreFor } from './drills'
import {
  fitOctave,
  LEFT_HOME,
  LEFT_RANGE,
  RIGHT_HOME,
  RIGHT_RANGE,
  rootNear,
  scaleFrom,
  tonicOf,
  type Hand,
} from './tonality'
import {
  arpeggios,
  bebopScales,
  brokenThirds,
  chromaticScale,
  contraryMotion,
  longLicks,
  minorScales,
  octaveRiffs,
  rootlessVoicings,
  turnaroundChanges,
  turnarounds,
  tritoneSubs,
  twelveBar,
  twoHandTwoFiveOne,
  twoOctaveScale,
} from './material'

export type { Hand } from './tonality'

/**
 * What a level is *about*, used to sort the list into tabs.
 *
 * Not a second curriculum. The course is still one chain in one order with one
 * unlock rule; a group is a filing label, so that a list too long to see at once
 * can be looked at a section at a time. Anything else — separate progress per
 * group, courses unlocking courses — would make the order mean two things.
 */
export type LevelGroup = 'Reading' | 'Scales' | 'Blues' | 'Jazz'

export interface Level {
  id: string
  name: string
  group: LevelGroup
  /** One line, shown on the card. What this level asks of you. */
  goal: string
  make(key: KeyMark, seed: number): Prompt[]
  /**
   * Play each prompt through once before the attempt.
   *
   * On for anything with a shape to it — a scale, a riff — and off for reading
   * drills. Hearing a phrase before reading it is how anyone learns one, but
   * hearing a single note before identifying it is just giving the answer away.
   */
  demo?: boolean
  /**
   * Fraction of prompts that must be right first time to pass.
   *
   * Not 100%: a bar that demands perfection is a bar people stop attempting, and
   * the aim is fluency rather than a clean sheet. Warm-ups sit lower still,
   * because fumbling one is not a reading failure.
   */
  pass: number
}

/** Deterministic, so a level plays the same way twice when it needs to. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}


const build = (steps: number[][], key: KeyMark, hand: Hand, id: string): Prompt => ({
  id,
  steps,
  score: scoreFor(steps, key, hand, id),
})

/**
 * The five-finger pattern, up and down.
 *
 * The oldest exercise there is, and still the right first one: five notes under
 * five fingers with no thumb crossing, so the hand never has to move.
 */
function fiveFinger(key: KeyMark, hand: Hand, lowest: number): Prompt[] {
  const notes = scaleFrom(key, lowest, 5)
  const up = notes
  const down = [...notes].reverse()

  return [
    build([[up[0]], [up[1]], [up[2]], [up[3]]], key, hand, 'w0'),
    build([[up[4]], [down[1]], [down[2]], [down[3]]], key, hand, 'w1'),
    build([[up[0]], [up[2]], [up[4]], [up[2]]], key, hand, 'w2'),
    build([[up[4]], [up[3]], [up[2]], [up[1]]], key, hand, 'w3'),
  ]
}

/** A phrase that moves by a fixed set of intervals, in scale degrees. */
function phrases(
  key: KeyMark,
  hand: Hand,
  lowest: number,
  span: number,
  intervals: number[],
  length: number,
  count: number,
  seed: number,
): Prompt[] {
  const rand = random(seed)
  const notes = scaleFrom(key, lowest, span)
  const out: Prompt[] = []

  for (let i = 0; i < count; i += 1) {
    // Start somewhere the whole phrase can fit without running off either end.
    const reach = intervals.reduce((m, v) => Math.max(m, Math.abs(v)), 0) * (length - 1)
    let index = Math.floor(rand() * Math.max(1, notes.length - reach))
    const steps: number[][] = [[notes[index]]]

    for (let n = 1; n < length; n += 1) {
      const move = intervals[Math.floor(rand() * intervals.length)]
      const direction = rand() < 0.5 ? -1 : 1
      let next = index + move * direction
      // Turn back rather than clamp: a phrase that runs into the ceiling and
      // stays there repeats a note, which reads as a mistake in the material.
      if (next < 0 || next >= notes.length) next = index - move * direction
      index = Math.max(0, Math.min(notes.length - 1, next))
      steps.push([notes[index]])
    }

    out.push(build(steps, key, hand, `p${i}`))
  }
  return out
}

/** Root-position triads built by stacking scale degrees. */
function triads(key: KeyMark, hand: Hand, lowest: number, count: number, seed: number): Prompt[] {
  const rand = random(seed)
  const notes = scaleFrom(key, lowest, 12)
  return Array.from({ length: count }, (_, i) => {
    const root = Math.floor(rand() * (notes.length - 5))
    return build([[notes[root], notes[root + 2], notes[root + 4]]], key, hand, `t${i}`)
  })
}

/** Phrases where the first and last steps are chords and the middle is melody. */
function chordPhrases(key: KeyMark, hand: Hand, lowest: number, count: number, seed: number): Prompt[] {
  const rand = random(seed)
  const notes = scaleFrom(key, lowest, 10)
  return Array.from({ length: count }, (_, i) => {
    const root = Math.floor(rand() * (notes.length - 6))
    const chord = [notes[root], notes[root + 2], notes[root + 4]]
    const a = notes[root + 1 + Math.floor(rand() * 3)]
    const b = notes[root + 1 + Math.floor(rand() * 3)]
    return build([chord, [a], [b]], key, hand, `c${i}`)
  })
}

/** Alternate hands prompt by prompt, so both stay in play. */
function alternating(make: (hand: Hand, seed: number) => Prompt[], seed: number): Prompt[] {
  const right = make('right', seed)
  const left = make('left', seed + 101)
  const out: Prompt[] = []
  for (let i = 0; i < Math.max(right.length, left.length); i += 1) {
    if (right[i]) out.push({ ...right[i], id: `r${i}` })
    if (left[i]) out.push({ ...left[i], id: `l${i}` })
  }
  return out
}

/**
 * The blues scale, in semitones from the tonic.
 *
 * Minor third, fourth, flat fifth, fifth, flat seventh. The flat fifth is the
 * blue note itself, and it is the reason this material is written with flats:
 * these are heard as lowered degrees, not raised ones, and spelling them as
 * sharps would put every one of them on the wrong line.
 */
const BLUES = [0, 3, 5, 6, 7, 10]

/** A run through the blues scale, one octave, ascending. */
function bluesScale(key: KeyMark, lowest: number): number[] {
  const tonic = tonicOf(key)
  const root = lowest + (((tonic - (lowest % 12)) % 12) + 12) % 12
  return [...BLUES.map((s) => root + s), root + 12]
}

/**
 * A major scale, one octave.
 *
 * Written as one prompt of eight notes rather than eight prompts of one: a
 * scale is a shape, and the thing worth practising is playing it as one gesture.
 */
function majorScale(key: KeyMark, lowest: number): number[] {
  return scaleFrom(key, lowest, 8)
}

/** The same run, up then down, as two prompts. Repetition is the point. */
function runs(
  notes: number[],
  key: KeyMark,
  hand: Hand,
  prefix: string,
  spell: 'sharp' | 'flat' | undefined,
  times: number,
): Prompt[] {
  const up = notes.map((n) => [n])
  const down = [...notes].reverse().map((n) => [n])
  const out: Prompt[] = []
  for (let i = 0; i < times; i += 1) {
    const steps = i % 2 === 0 ? up : down
    const id = `${prefix}${i}`
    out.push({ id, steps, score: scoreFor(steps, key, hand, id, { spell }) })
  }
  return out
}

/**
 * Riffs worth knowing, as semitone offsets from the tonic.
 *
 * Real patterns rather than generated ones. A riff is a thing people play, and
 * an invented sequence of blue notes is an exercise pretending to be one.
 */
const RIFFS: { name: string; hand: Hand; offsets: number[] }[] = [
  {
    // The boogie-woogie bass: root, third, fifth, sixth, flat seventh, and back
    // down. The pattern under most of the twentieth century.
    name: 'boogie',
    hand: 'left',
    offsets: [0, 4, 7, 9, 10, 9, 7, 4],
  },
  {
    // A descending lick out of the blues scale, the way a phrase answers itself.
    name: 'answer',
    hand: 'right',
    offsets: [12, 10, 7, 6, 5, 3, 0],
  },
  {
    // Around the blue note and back — the flat fifth leaned on, then released.
    name: 'blue',
    hand: 'right',
    offsets: [0, 3, 5, 6, 5, 3],
  },
]

function riffs(key: KeyMark, lowest: number): Prompt[] {
  const tonic = tonicOf(key)
  return RIFFS.map((riff, i) => {
    const home = riff.hand === 'left' ? LEFT_HOME : lowest
    const root = home + ((((tonic - (home % 12)) % 12) + 12) % 12)
    const steps = riff.offsets.map((o) => [root + o])
    const id = `riff-${riff.name}-${i}`
    return { id, steps, score: scoreFor(steps, key, riff.hand, id, { spell: 'flat' }) }
  })
}


/**
 * Walking bass: quarter notes that connect one chord to the next.
 *
 * The thing to learn here is not the notes but the *last* note of each bar. A
 * walking line is chord tones for three beats and then a note chosen to lean
 * into whatever comes next — B pulls up to C, A flat pulls down to G — and that
 * pull is what makes a line walk rather than sit. Each of these is two bars so
 * the arrival is inside the prompt, where it can be heard.
 */
const WALKS: { name: string; offsets: number[] }[] = [
  // C E G E | F A C B — over to the four, and the B leans home again.
  { name: 'to-the-four', offsets: [0, 4, 7, 4, 5, 9, 12, 11] },
  // C E G A flat | G B D C — the flat sixth drops a semitone onto the five.
  { name: 'to-the-five', offsets: [0, 4, 7, 8, 7, 11, 14, 12] },
  // B flat A A flat G | F E E flat C — the chromatic walk down to the tonic.
  { name: 'coming-home', offsets: [10, 9, 8, 7, 5, 4, 3, 0] },
]

function walkingBass(key: KeyMark): Prompt[] {
  const root = rootNear(tonicOf(key), LEFT_HOME)
  return WALKS.map((walk, i) => {
    const steps = fitOctave(walk.offsets.map((o) => [root + o]), ...LEFT_RANGE)
    const id = `walk-${walk.name}-${i}`
    return { id, steps, score: scoreFor(steps, key, 'left', id, { spell: 'flat' }) }
  })
}

/**
 * The shuffle: a root held under a fifth that keeps climbing.
 *
 * Two notes at a time, which is the step up from everything before it — the hand
 * holds one note while the other moves, and the eye has to read a pair as a pair
 * rather than as two notes it happens to be playing together. The shape is one
 * bar long and the whole of boogie is built from it.
 *
 * Written on the one, the four and the five, at the pitches they are actually
 * played at: the four and the five sit *below* the one, not above, or the left
 * hand ends up climbing into the middle of the keyboard by the third bar.
 */
const SHUFFLE = [7, 9, 10, 9]

function shuffles(key: KeyMark): Prompt[] {
  const home = rootNear(tonicOf(key), LEFT_HOME)
  const degrees: { name: string; root: number }[] = [
    { name: 'one', root: home },
    { name: 'four', root: home - 7 },
    { name: 'five', root: home - 5 },
  ]
  return degrees.map((degree, i) => {
    // Two bars of it: one is a fragment, two is a groove.
    const steps = fitOctave(
      [...SHUFFLE, ...SHUFFLE].map((o) => [degree.root, degree.root + o]),
      ...LEFT_RANGE,
    )
    const id = `shuffle-${degree.name}-${i}`
    return { id, steps, score: scoreFor(steps, key, 'left', id, { spell: 'flat' }) }
  })
}

/**
 * Comping shells: the third and the seventh, and nothing else.
 *
 * The two notes that say which chord it is. Everything else in a dominant
 * seventh is either the root — which the bass has — or colour, so a right hand
 * comping the blues plays these and leaves the rest alone.
 *
 * They are also the neatest possible lesson in voice leading: the whole move
 * from the one to the four is both notes down a semitone, and from the one to
 * the five is both notes up a semitone. Read as a pair, it is a wiggle.
 */
function comping(key: KeyMark): Prompt[] {
  const root = rootNear(tonicOf(key), RIGHT_HOME)
  const one = [root + 4, root + 10] // third and flat seventh
  const four = [root + 3, root + 9] // both a semitone down
  const five = [root + 5, root + 11] // both a semitone up

  // Twelve bars in miniature: one, one, four, one | five, four, one, one.
  const shapes = [
    { name: 'changes', chords: [one, one, four, one, five, four, one, one] },
    { name: 'quick-four', chords: [one, four, one, one, four, four, one, five] },
  ]
  return shapes.map((shape, i) => {
    const steps = fitOctave(shape.chords, ...RIGHT_RANGE)
    const id = `comp-${shape.name}-${i}`
    return { id, steps, score: scoreFor(steps, key, 'right', id, { spell: 'flat' }) }
  })
}

/**
 * Two–five–one, as a left hand actually plays it.
 *
 * Root in the bass and one note above it: the seventh of the minor chord, the
 * third of the dominant, the seventh of the tonic. Held as half notes, because
 * the point is the voice leading and not the rhythm — C down to B, and then B
 * staying exactly where it is while the chord changes underneath it. Hearing
 * one note hold still through three chords is the whole idea.
 */
const SHELLS: { degree: number; above: number }[] = [
  { degree: 2, above: 10 }, // ii7: root and its flat seventh
  { degree: 7, above: 4 }, // V7: root and its third
  { degree: 0, above: 11 }, // Imaj7: root and its major seventh
]

/**
 * The same three chords, round the cycle of fourths.
 *
 * Which is how this is practised and why: the shape is identical every time and
 * only the pitches move, so what is being learnt is the shape rather than three
 * unrelated chords. Written under the piece's own key signature with accidentals
 * where they are needed, which is also what a jazz book does — the exercise is
 * not in three keys, it is one exercise starting from three places.
 */
function twoFiveOne(key: KeyMark): Prompt[] {
  const tonic = tonicOf(key)
  return [0, 5, 10].map((from, i) => {
    const root = rootNear((tonic + from) % 12, LEFT_HOME)
    const steps = fitOctave(
      SHELLS.map((shell) => [root + shell.degree, root + shell.degree + shell.above]),
      ...LEFT_RANGE,
    )
    const id = `shells-${i}`
    // Half notes: two chords a bar, and the third alone with a rest after it.
    return { id, steps, score: scoreFor(steps, key, 'left', id, { beatsPerStep: 2 }) }
  })
}

/**
 * Licks: eighth notes, which is where blues stops being an exercise.
 *
 * Everything up to here has been one note per beat, and a line that moves twice
 * as fast is a different reading problem — the eye stops taking notes one at a
 * time and starts taking the beamed group as a shape. That is the whole reason
 * eighths are beamed, and it is worth meeting deliberately.
 */
const LICKS: { name: string; offsets: number[] }[] = [
  // Up the chord and down through the flat sixth onto the fifth.
  { name: 'turn', offsets: [2, 5, 9, 12, 11, 7, 8, 7] },
  // The descent, chromatic through the blue note.
  { name: 'descent', offsets: [12, 11, 9, 7, 6, 5, 4, 2] },
  // Around the third and onto it from below — an enclosure.
  { name: 'enclosure', offsets: [7, 9, 8, 7, 5, 4, 3, 4] },
]

function licks(key: KeyMark): Prompt[] {
  const root = rootNear(tonicOf(key), RIGHT_HOME)
  return LICKS.map((lick, i) => {
    const steps = lick.offsets.map((o) => [root + o])
    const id = `lick-${lick.name}-${i}`
    return {
      id,
      steps,
      score: scoreFor(steps, key, 'right', id, { spell: 'flat', beatsPerStep: 0.5 }),
    }
  })
}

/**
 * The levels, written in the order they were thought of within each section.
 *
 * Not the order they are played in — see LEVELS below, which groups them. The
 * two are kept apart so that adding a level means writing it next to its
 * relatives rather than counting to the right index in a list of thirty.
 */
const COURSE: Level[] = [
  {
    id: 'warm-right',
    group: 'Reading',
    name: 'Warm up · right hand',
    goal: 'Five notes under five fingers. No thumb crossing, no hand movement.',
    make: (key) => fiveFinger(key, 'right', RIGHT_HOME),
    pass: 0.7,
  },
  {
    id: 'warm-left',
    group: 'Reading',
    name: 'Warm up · left hand',
    goal: 'The same pattern an octave and a half below, read on the bass staff.',
    make: (key) => fiveFinger(key, 'left', LEFT_HOME),
    pass: 0.7,
  },
  {
    id: 'steps-right',
    group: 'Reading',
    name: 'Steps',
    goal: 'Short phrases that move one note at a time. The easiest interval to read.',
    make: (key, seed) => phrases(key, 'right', RIGHT_HOME, 8, [1], 3, 8, seed),
    pass: 0.75,
  },
  {
    id: 'steps-both',
    group: 'Reading',
    name: 'Steps · both hands',
    goal: 'The same, alternating hands, so the bass staff stops being unfamiliar.',
    make: (key, seed) =>
      alternating(
        (hand, s) => phrases(key, hand, hand === 'left' ? LEFT_HOME : RIGHT_HOME, 8, [1], 3, 4, s),
        seed,
      ),
    pass: 0.75,
  },
  {
    id: 'skips',
    group: 'Reading',
    name: 'Skips',
    goal: 'Phrases that leap a third. Line to line, or space to space.',
    make: (key, seed) => phrases(key, 'right', RIGHT_HOME, 8, [2], 3, 8, seed),
    pass: 0.75,
  },
  {
    id: 'mixed',
    group: 'Reading',
    name: 'Steps & skips',
    goal: 'Four notes mixing both, over a wider range. Reading rather than guessing.',
    make: (key, seed) => phrases(key, 'right', RIGHT_HOME - 7, 12, [1, 2], 4, 10, seed),
    pass: 0.75,
  },
  {
    id: 'triads',
    group: 'Reading',
    name: 'Triads',
    goal: 'Three notes at once. The eye has to take all three heights together.',
    make: (key, seed) => triads(key, 'right', RIGHT_HOME, 8, seed),
    pass: 0.7,
  },
  {
    id: 'chord-phrases',
    group: 'Reading',
    name: 'Chords in phrases',
    goal: 'A chord, then a melody out of it. Both kinds of reading in one bar.',
    make: (key, seed) => chordPhrases(key, 'right', RIGHT_HOME, 8, seed),
    pass: 0.7,
  },
  {
    id: 'scale-right',
    group: 'Scales',
    name: 'Scale · right hand',
    goal: 'A whole octave as one gesture, up and then down. Listen first.',
    make: (key) => runs(majorScale(key, RIGHT_HOME), key, 'right', 's', undefined, 4),
    demo: true,
    // Eight notes in a row is a long way to go without a slip, and the aim is
    // the shape rather than a clean sheet. Half of them is a real pass.
    pass: 0.5,
  },
  {
    id: 'scale-left',
    group: 'Scales',
    name: 'Scale · left hand',
    goal: 'The same octave in the bass, where the fingering runs the other way.',
    make: (key) => runs(majorScale(key, LEFT_HOME), key, 'left', 'sl', undefined, 4),
    demo: true,
    pass: 0.5,
  },
  {
    id: 'blues-scale',
    group: 'Blues',
    name: 'The blues scale',
    goal: 'Six notes and a flat fifth. Written with flats, because that is what they are.',
    make: (key) => runs(bluesScale(key, RIGHT_HOME), key, 'right', 'b', 'flat', 4),
    demo: true,
    pass: 0.5,
  },
  {
    id: 'blues-riffs',
    group: 'Blues',
    name: 'Blues riffs',
    goal: 'A boogie bass, an answering lick, and a lean on the blue note.',
    make: (key) => riffs(key, RIGHT_HOME),
    demo: true,
    pass: 0.5,
  },
  {
    id: 'blues-walk',
    group: 'Blues',
    name: 'Walking bass',
    goal: 'Chord tones for three beats, then a note that leans into the next bar.',
    make: (key) => walkingBass(key),
    demo: true,
    pass: 0.5,
  },
  {
    id: 'blues-shuffle',
    group: 'Blues',
    name: 'Shuffle · double stops',
    goal: 'Two notes at a time: a root held while the top climbs. On the one, four and five.',
    make: (key) => shuffles(key),
    demo: true,
    pass: 0.5,
  },
  {
    id: 'blues-comp',
    group: 'Blues',
    name: 'Comping shells',
    goal: 'Third and seventh only. Twelve bars, where every change is a semitone.',
    make: (key) => comping(key),
    demo: true,
    pass: 0.5,
  },
  {
    id: 'jazz-shells',
    group: 'Jazz',
    name: 'Two · five · one',
    goal: 'Left-hand shells round the cycle. Listen for the note that never moves.',
    make: (key) => twoFiveOne(key),
    demo: true,
    pass: 0.5,
  },
  {
    id: 'jazz-licks',
    group: 'Jazz',
    name: 'Licks · eighth notes',
    goal: 'Twice as fast, and beamed — read the group as a shape, not note by note.',
    make: (key) => licks(key),
    demo: true,
    // Eighths are a real step up, and the first few attempts will be untidy.
    pass: 0.4,
  },

  /*
   * Past here the material is real repertoire rather than exercises: a
   * turnaround, a rootless voicing, a bebop scale. The pass marks come down as
   * it gets harder — a bar that demands perfection is a bar people stop
   * attempting, and these are worth attempting badly.
   */
  {
    id: 'scale-two-octaves',
    group: 'Scales',
    name: 'Two octaves',
    goal: 'In eighths, so the second thumb crossing has to actually work.',
    make: twoOctaveScale,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'scale-minor',
    group: 'Scales',
    name: 'Minor scales',
    goal: 'Natural and harmonic on the same tonic. One note apart, and you can hear it.',
    make: minorScales,
    demo: true,
    pass: 0.5,
  },
  {
    id: 'scale-chromatic',
    group: 'Scales',
    name: 'Chromatic',
    goal: 'Sharps going up, flats coming down — a spelling says where a note is going.',
    make: chromaticScale,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'scale-arpeggios',
    group: 'Scales',
    name: 'Arpeggios',
    goal: 'The thumb crosses a third instead of a step, on the one, four, five and six.',
    make: arpeggios,
    demo: true,
    pass: 0.5,
  },
  {
    id: 'scale-thirds',
    group: 'Scales',
    name: 'Broken thirds',
    goal: 'Two lines in one hand. The eye has to take them in pairs.',
    make: brokenThirds,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'scale-contrary',
    group: 'Scales',
    name: 'Contrary motion',
    goal: 'Both hands at once, mirrored — every finger lands with its twin.',
    make: contraryMotion,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'blues-twelve',
    group: 'Blues',
    name: 'Twelve bars',
    goal: 'The shuffle through the whole form, two bars at a time. Practising the change.',
    make: twelveBar,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'blues-octaves',
    group: 'Blues',
    name: 'Riffs in octaves',
    goal: 'Nothing new to read, a great deal more to play. The sound of the right hand.',
    make: octaveRiffs,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'blues-turnaround',
    group: 'Blues',
    name: 'Turnarounds',
    goal: 'Both hands: a bass note holding still under a line walking down through it.',
    make: turnarounds,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'jazz-bebop',
    group: 'Jazz',
    name: 'Bebop scales',
    goal: 'Eight notes, so the chord tones land on the beats. That is the whole trick.',
    make: bebopScales,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'jazz-rootless',
    group: 'Jazz',
    name: 'Rootless voicings',
    goal: 'Four notes, no root. Two hold, one drops a semitone — and it is a two five one.',
    make: rootlessVoicings,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'jazz-tritone',
    group: 'Jazz',
    name: 'Tritone substitution',
    goal: 'The five chord swapped for the one a tritone away. Listen to the bass walk down.',
    make: tritoneSubs,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'jazz-turnaround',
    group: 'Jazz',
    name: 'One · six · two · five',
    goal: 'The turnaround most standards are made of. The top voice never moves far.',
    make: turnaroundChanges,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'jazz-hands',
    group: 'Jazz',
    name: 'Two five one · both hands',
    goal: 'Root below, voicing above. The two hands doing different jobs at once.',
    make: twoHandTwoFiveOne,
    demo: true,
    pass: 0.4,
  },
  {
    id: 'jazz-long-licks',
    group: 'Jazz',
    name: 'Licks · two bars',
    goal: 'A phrase rather than a fragment: starts on the two, turns at the five, lands.',
    make: longLicks,
    demo: true,
    pass: 0.35,
  },
]

/** The groups present, in the order the course meets them. */
export const LEVEL_GROUPS: LevelGroup[] = ['Reading', 'Scales', 'Blues', 'Jazz']

/**
 * The course in order, with each section kept whole.
 *
 * Grouping by section rather than trusting the array to be written in the right
 * order means a tab always shows a run of consecutive numbers: the levels in it
 * are levels 9 to 16, not 9, 10 and then 18 to 23. It also makes the two facts a
 * level carries — where it sits and what it is about — stop being able to
 * disagree, which they did the moment fifteen new levels were appended to the
 * end of a list that was already grouped.
 *
 * The sort is stable, so within a section the written order is the played order.
 */
export const LEVELS: Level[] = [...COURSE].sort(
  (a, b) => LEVEL_GROUPS.indexOf(a.group) - LEVEL_GROUPS.indexOf(b.group),
)

export const levelById = (id: string): Level | undefined => LEVELS.find((l) => l.id === id)
