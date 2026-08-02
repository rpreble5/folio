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

export type Hand = 'left' | 'right'

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

/** Semitones above the tonic for each degree of a major scale. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11]

/** The tonic's pitch class, from the key's position on the circle of fifths. */
const tonicOf = (key: KeyMark) => (((key.fifths * 7) % 12) + 12) % 12

/**
 * The tonic *nearest* a home position, rather than the next one above it.
 *
 * Rounding always upwards costs up to eleven semitones, which is most of an
 * octave: the same riff written in C and in B would sit almost an octave apart,
 * and one of them would be off the end of the staff. Nearest keeps every key
 * within half an octave of where the hand already is.
 */
function rootNear(pitchClass: number, home: number): number {
  const up = home + ((((pitchClass - (home % 12)) % 12) + 12) % 12)
  return up - home <= 6 ? up : up - 12
}

/**
 * Shift a whole prompt by octaves until it sits inside a hand's range.
 *
 * Applied to the prompt rather than to each note, so the shape is never
 * distorted — a voicing that has to move moves in one piece. It only shifts
 * when the shift actually helps: material genuinely wider than the window is
 * left where it is rather than pushed off the other end.
 */
function fitOctave(steps: number[][], low: number, high: number): number[][] {
  const flat = steps.flat()
  if (flat.length === 0) return steps
  let shift = 0
  const min = () => Math.min(...flat) + shift
  const max = () => Math.max(...flat) + shift
  while (max() > high && min() - 12 >= low) shift -= 12
  while (min() < low && max() + 12 <= high) shift += 12
  return shift === 0 ? steps : steps.map((step) => step.map((m) => m + shift))
}

/** The comfortable reading range of each hand, for fitOctave. */
const LEFT_RANGE: [number, number] = [36, 64]
const RIGHT_RANGE: [number, number] = [55, 84]

/**
 * The scale as MIDI numbers, ascending from a starting octave.
 *
 * Working in scale degrees rather than semitones is what keeps generated phrases
 * inside the key without having to check each note afterwards — a step is one
 * index, a third is two, and both are automatically diatonic.
 */
function scaleFrom(key: KeyMark, lowest: number, count: number): number[] {
  const tonic = tonicOf(key)
  const out: number[] = []
  let degree = 0
  let octave = Math.floor(lowest / 12)

  while (out.length < count) {
    const midi = octave * 12 + tonic + MAJOR[degree % 7]
    if (midi >= lowest) out.push(midi)
    degree += 1
    if (degree % 7 === 0) octave += 1
  }
  return out
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

/** Middle C is 60. The five-finger positions each hand starts from. */
const RIGHT_HOME = 60
const LEFT_HOME = 48

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

export const LEVELS: Level[] = [
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
]

/** The groups present, in the order the course meets them. */
export const LEVEL_GROUPS: LevelGroup[] = LEVELS.reduce<LevelGroup[]>(
  (out, level) => (out.includes(level.group) ? out : [...out, level.group]),
  [],
)

export const levelById = (id: string): Level | undefined => LEVELS.find((l) => l.id === id)
