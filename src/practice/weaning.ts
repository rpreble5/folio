/**
 * Label weaning: the letters leave as the reading arrives.
 *
 * Labels exist here to be learnt from and then left behind — that has been the
 * stated point of them since the first day. This is the leaving, and it is
 * driven by evidence rather than a timer: the practice record knows how often
 * each note has been read, how quickly, and how often it went wrong, so a
 * label fades when its note is being read fluently and returns when it stops
 * being. A timer weans everyone at the same speed, which is to say at the
 * wrong speed for everyone.
 *
 * Two stages, because "recedes without disappearing" is already this app's
 * label philosophy: a note read well fades to a whisper first, and only a note
 * read well *repeatedly* loses its letter altogether. Miss it, or stay away
 * two weeks, and the letter comes back — weaning that cannot regress is just
 * deletion on a delay.
 *
 * Implemented as ordinary theme rules, synthesised from the record and
 * prepended to the user's own — so the cascade the whole theme system is built
 * on does the work, and anything the user says explicitly still wins.
 */

import type { Rule, Theme } from '../core/theme'
import { octaveOf, pitchClass } from '../core/pitch'
import { today, type History, type Stat } from './history'

/** Read this many times before any fading starts. */
const FADE_SEEN = 3
/** And this many before the letter goes entirely. */
const WEAN_SEEN = 6

/** Faster than this, a note counts as read fluently. */
const FLUENT_MS = 2000
/** Miss rate above which a note is not weaning, whatever its speed. */
const MISS_CEILING = 0.2

/** Days of absence after which the letter returns. */
const FRESH_DAYS = 14

/** How much of a faded label survives. */
export const FADED_OPACITY = 0.4

export interface Weaning {
  rules: Rule[]
  /** Pitches whose labels are faded, and those whose labels are gone. */
  faded: number
  weaned: number
}

const NONE: Weaning = { rules: [], faded: 0, weaned: 0 }

/**
 * The theme as the reader should see it: the authored theme with the record's
 * wean rules underneath. Underneath, not on top — anything the person said
 * explicitly, down to a single recoloured note, still wins the cascade.
 *
 * The studio keeps editing the authored theme; only the rendered score wears
 * this one. Weaning is something the app observes, not something it writes
 * into a style the user might save and share.
 */
export function withWeaning(theme: Theme, history: History): Theme {
  if (!theme.encodings.labelWean) return theme
  const { rules } = weanRules(history)
  if (rules.length === 0) return theme
  return { ...theme, rules: [...rules, ...theme.rules] }
}

type Grade = 'full' | 'faded' | 'weaned'

function gradeOf(stat: Stat, day: number): Grade {
  if (day - stat.day > FRESH_DAYS) return 'full'
  const missRate = stat.missed / Math.max(1, stat.seen)
  if (missRate > MISS_CEILING || stat.ms > FLUENT_MS) return 'full'
  if (stat.seen >= WEAN_SEEN) return 'weaned'
  if (stat.seen >= FADE_SEEN) return 'faded'
  return 'full'
}

/**
 * The synthesised rules for the current record.
 *
 * Selectors are pitch class and octave, which is the finest grain the rule
 * system speaks — it cannot say "on the bass staff". So a pitch that appears
 * on both staves is judged by its *worse* staff: reading treble middle C
 * fluently does not silence the label on the bass middle C you keep missing.
 */
export function weanRules(history: History): Weaning {
  const day = today()
  const byMidi = new Map<number, Grade>()

  for (const [key, stat] of Object.entries(history.notes)) {
    const midi = Number(key.split(':')[1])
    if (!Number.isFinite(midi)) continue
    const grade = gradeOf(stat, day)
    const previous = byMidi.get(midi)
    // The weaker grade wins across staves: full < faded < weaned.
    const order: Grade[] = ['full', 'faded', 'weaned']
    if (previous === undefined || order.indexOf(grade) < order.indexOf(previous)) {
      byMidi.set(midi, grade)
    }
  }

  const rules: Rule[] = []
  let faded = 0
  let weaned = 0
  for (const [midi, grade] of byMidi) {
    if (grade === 'full') continue
    rules.push({
      id: `wean-${midi}`,
      selector: { kind: 'pitchClassOctave', pitchClass: pitchClass(midi), octave: octaveOf(midi) },
      style: grade === 'weaned' ? { label: 'none' } : { labelOpacity: FADED_OPACITY },
      enabled: true,
    })
    if (grade === 'weaned') weaned += 1
    else faded += 1
  }

  return rules.length ? { rules, faded, weaned } : NONE
}
