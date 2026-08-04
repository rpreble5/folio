/**
 * What the app remembers about your playing.
 *
 * Everything needed to answer "what should I practise?" was already being
 * measured — how long each prompt took, which notes were in it, how many wrong
 * notes there were — and then thrown away the moment a run ended. The summary
 * screen could tell you that F sharp was your slowest note once, and then never
 * again. This is where it goes instead.
 *
 * Two ledgers, because two things are worth remembering and they answer
 * different questions:
 *
 *   - **Notes**, keyed by staff and pitch. The right handle for generated
 *     material, where the prompts are different every time but the notes in them
 *     are not. It is also what makes a brand-new prompt guessable: a phrase made
 *     of notes you are slow on is probably going to be slow.
 *   - **Items**, keyed by level and prompt. The right handle for fixed material,
 *     where "the third walking line" is a thing you can be specifically bad at
 *     and no amount of per-note averaging will say so.
 *
 * Local only, like progress. A practice record is a diary, and a diary that
 * needs an account is one people do not keep.
 *
 * Storage is bounded and forgetful on purpose: a running average rather than
 * every sample, and the least recently seen entries evicted when it gets large.
 * Nobody needs the note-by-note archive of a year ago, and an app that grows
 * without limit in localStorage eventually breaks in a way that is very hard to
 * explain to the person it happens to.
 */

const KEY = 'folio.history.v1'

/** How many entries each ledger keeps before the stalest are dropped. */
const LIMIT = 400

export interface Stat {
  /** Times this has been asked. */
  seen: number
  /** Times it was answered with at least one wrong note along the way. */
  missed: number
  /**
   * Typical milliseconds to answer, weighted toward recent attempts.
   *
   * A running average rather than a list of samples: the question it has to
   * answer is "is this slow *now*", and an average over everything since the
   * first week says no long after it has stopped being true.
   */
  ms: number
  /** Day number when last asked, for staleness. */
  day: number
}

export interface History {
  notes: Record<string, Stat>
  items: Record<string, Stat>
}

const EMPTY: History = { notes: {}, items: {} }

/** Whole days since the epoch. Coarse on purpose — practice is a daily habit. */
export const today = (): number => Math.floor(Date.now() / 86_400_000)

/** A note's identity: which staff it was read on, and which key it was. */
export const noteKey = (staff: number, midi: number): string => `${staff}:${midi}`

/** A prompt's identity within its level. */
export const itemKey = (levelId: string, promptId: string): string => `${levelId}/${promptId}`

/**
 * How much a new reading counts against the old one.
 *
 * A third: enough that a bad day shows, not so much that it erases what came
 * before. Three attempts and the old value is down to about a third.
 */
const ALPHA = 0.34

function fold(previous: Stat | undefined, ms: number, missed: boolean, day: number): Stat {
  if (!previous) return { seen: 1, missed: missed ? 1 : 0, ms, day }
  return {
    seen: previous.seen + 1,
    missed: previous.missed + (missed ? 1 : 0),
    ms: Math.round(previous.ms * (1 - ALPHA) + ms * ALPHA),
    day,
  }
}

/** Drop the least recently seen entries once a ledger gets long. */
function trim(ledger: Record<string, Stat>): Record<string, Stat> {
  const keys = Object.keys(ledger)
  if (keys.length <= LIMIT) return ledger
  const keep = keys
    .sort((a, b) => ledger[b].day - ledger[a].day || ledger[b].seen - ledger[a].seen)
    .slice(0, LIMIT)
  return Object.fromEntries(keep.map((k) => [k, ledger[k]]))
}

export function loadHistory(): History {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return EMPTY
    const { notes, items } = parsed as History
    return {
      notes: notes && typeof notes === 'object' ? notes : {},
      items: items && typeof items === 'object' ? items : {},
    }
  } catch {
    // A corrupt record should cost someone their statistics, not the app.
    return EMPTY
  }
}

export function saveHistory(history: History): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(history))
  } catch {
    // Private browsing, or a full quota. Practising still works.
  }
}

export interface Reading {
  levelId: string
  promptId: string
  /** Every note in the prompt, with the staff it was written on. */
  notes: { staff: number; midi: number }[]
  ms: number
  /** Wrong notes played before it came out right. */
  wrong: number
}

/**
 * Fold one answered prompt into the record.
 *
 * The whole prompt's time is credited to every note in it, which is not
 * strictly fair — one note of a chord was the slow one and the others were
 * along for the ride. Over a run the guilty note rises anyway, because it is
 * the one that keeps turning up in slow prompts while the innocent ones appear
 * in fast ones too.
 */
export function record(history: History, reading: Reading): History {
  const day = today()
  const missed = reading.wrong > 0
  const notes = { ...history.notes }
  for (const note of reading.notes) {
    const key = noteKey(note.staff, note.midi)
    notes[key] = fold(notes[key], reading.ms, missed, day)
  }
  const items = { ...history.items }
  const key = itemKey(reading.levelId, reading.promptId)
  items[key] = fold(items[key], reading.ms, missed, day)

  const next: History = { notes: trim(notes), items: trim(items) }
  saveHistory(next)
  return next
}

/**
 * How badly something wants practising, from 1 (fine) to MAX (needs work).
 *
 * Three signals, deliberately bounded:
 *
 *   - **Missing it** matters most, and is the clearest evidence of not knowing
 *     something rather than being tired.
 *   - **Being slow** matters, but a slow right answer is still a right answer,
 *     so it is worth less than a wrong one.
 *   - **Not having seen it lately** matters, because that is how passed
 *     material comes back before it has been forgotten entirely.
 *
 * The ceiling is the important part. Left unbounded, the thing you are worst at
 * would crowd out everything else and the drill would become a wall of the one
 * note you cannot read — which is how people stop opening a practice app. Four
 * to one is a strong bias that still lets everything through.
 */
export const MAX_WEIGHT = 4

/** Milliseconds a comfortable answer takes. Slower than this starts to count. */
const COMFORTABLE = 1800

/** Days after which something counts as fully stale. */
const STALE = 14

export function weigh(stat: Stat | undefined, day: number): number {
  // Never seen: middling, so new material is neither starved nor drilled.
  if (!stat || stat.seen === 0) return 1.5

  const missRate = stat.missed / stat.seen
  const slow = Math.min(1, Math.max(0, (stat.ms - COMFORTABLE) / COMFORTABLE))
  const stale = Math.min(1, Math.max(0, (day - stat.day) / STALE))

  return Math.min(MAX_WEIGHT, 1 + 2 * missRate + slow + stale)
}

/**
 * What a prompt is worth practising, whether or not it has been seen before.
 *
 * Its own record if it has one, and otherwise the worst of the notes in it.
 * That second clause is what stops a fresh prompt from being a blank: a phrase
 * you have never played but which is made of the two notes you always miss is
 * not an unknown quantity.
 *
 * The *worst* note rather than the average, because a phrase is only as easy as
 * its hardest note — averaging lets seven comfortable notes hide the one that
 * will actually stop the reader.
 */
export function weighPrompt(
  history: History,
  levelId: string,
  promptId: string,
  notes: { staff: number; midi: number }[],
  day: number,
): number {
  const own = history.items[itemKey(levelId, promptId)]
  if (own && own.seen > 0) return weigh(own, day)
  if (notes.length === 0) return 1.5
  return Math.max(...notes.map((n) => weigh(history.notes[noteKey(n.staff, n.midi)], day)))
}

/** The slowest notes on record, worst first. For the summary. */
export function slowestNotes(history: History, count: number): { midi: number; ms: number }[] {
  return Object.entries(history.notes)
    .filter(([, stat]) => stat.seen >= 2)
    .map(([key, stat]) => ({ midi: Number(key.split(':')[1]), ms: stat.ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, count)
}
