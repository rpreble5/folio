/**
 * How fast the play-through plays.
 *
 * Kept out of the view so it survives leaving practice and coming back: a tempo
 * is a standing preference, like the number of systems on a reading page, not
 * something to be set again every session.
 *
 * It is stored as a real tempo in beats per minute rather than as a multiplier,
 * because that is the number a musician already has an opinion about. "×1.2"
 * requires knowing what it is 1.2 of.
 */

const KEY = 'folio.tempo.v1'

/**
 * The tempi on a metronome, not a slider from 60 to 200.
 *
 * Maelzel's sequence: fine steps where the ear can tell them apart and coarser
 * ones higher up, which is why a mechanical metronome has these exact numbers
 * on it and not a linear scale. It also means every stop is a tempo someone
 * could name, so a marking read from a score can actually be dialled in.
 */
export const TEMPI = [
  60, 63, 66, 69, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116,
  120, 126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200,
]

/**
 * Moderate rather than slow.
 *
 * The play-through is a demonstration, and a demonstration taken too slowly
 * stops being the phrase and becomes a list of the notes in it — the shape a
 * riff has is partly a matter of speed.
 */
export const DEFAULT_TEMPO = 104

/** The nearest tempo a metronome would offer. */
export function nearestTempo(bpm: number): number {
  return TEMPI.reduce((best, v) => (Math.abs(v - bpm) < Math.abs(best - bpm) ? v : best), TEMPI[0])
}

/** One notch up or down, stopping at the ends rather than wrapping. */
export function stepTempo(bpm: number, direction: 1 | -1): number {
  const index = TEMPI.indexOf(nearestTempo(bpm))
  return TEMPI[Math.min(TEMPI.length - 1, Math.max(0, index + direction))]
}

export function loadTempo(): number {
  try {
    const raw = localStorage.getItem(KEY)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) && value > 0 ? nearestTempo(value) : DEFAULT_TEMPO
  } catch {
    return DEFAULT_TEMPO
  }
}

export function saveTempo(bpm: number): void {
  try {
    localStorage.setItem(KEY, String(bpm))
  } catch {
    // Private browsing. The tempo still works for this session.
  }
}
