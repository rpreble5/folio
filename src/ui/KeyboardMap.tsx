/**
 * The fluency map: the reading record as a piano.
 *
 * The record page says it in sentences; this says it at a glance. Every key
 * the record knows about is painted by the same judgement that weans the
 * labels — lit in the reader's accent once a note is read fluently, half-lit
 * while it is getting there, faintly filled once merely met, and left as an
 * outline where the music has not been yet. Watching the lit region spread
 * along the keyboard is the whole progress system, drawn instead of counted.
 *
 * One strip per staff, because they are different skills with different
 * territories: the treble strip lights up around middle C long before the
 * bass strip does, and seeing that is more honest than a single merged row
 * pretending the note is simply "known".
 */

import { useMemo } from 'react'
import type { Theme } from '../core/theme'
import { pitchClass } from '../core/pitch'
import { noteKey, today, type History } from '../practice/history'
import { gradeOf, type Grade } from '../practice/weaning'

const BLACK = new Set([1, 3, 6, 8, 10])

/** White key geometry. Heights carry meaning; widths are just proportion. */
const W = 13
const H = 44
const BW = 7.5
const BH = 27

interface Strip {
  staff: number
  label: string
  low: number
  high: number
}

/**
 * The range a strip shows: the notes on record, padded a little and snapped
 * outward to white keys so the drawing never starts or ends on a black one —
 * and never narrower than an octave, because a five-key piano reads as a
 * mistake rather than a small map.
 */
function rangeOf(midis: number[]): { low: number; high: number } {
  let low = Math.min(...midis) - 2
  let high = Math.max(...midis) + 2
  while (high - low < 12) {
    low -= 1
    high += 1
  }
  while (BLACK.has(pitchClass(low))) low -= 1
  while (BLACK.has(pitchClass(high))) high += 1
  return { low: Math.max(21, low), high: Math.min(108, high) }
}

export function KeyboardMap({ history, surface }: { history: History; surface: Theme['surface'] }) {
  const day = today()

  const strips = useMemo(() => {
    const out: Strip[] = []
    for (const { staff, label } of [
      { staff: 1, label: 'Treble' },
      { staff: 2, label: 'Bass' },
    ]) {
      const midis = Object.keys(history.notes)
        .filter((key) => Number(key.split(':')[0]) === staff)
        .map((key) => Number(key.split(':')[1]))
        .filter(Number.isFinite)
      if (midis.length === 0) continue
      const { low, high } = rangeOf(midis)
      out.push({ staff, label, low, high })
    }
    return out
  }, [history, day])

  if (strips.length === 0) return null

  const grade = (staff: number, midi: number): Grade | 'unseen' => {
    const stat = history.notes[noteKey(staff, midi)]
    return stat ? gradeOf(stat, day) : 'unseen'
  }

  const fillFor = (g: Grade | 'unseen', black: boolean) => {
    switch (g) {
      case 'weaned':
        return { fill: surface.accent, fillOpacity: 1 }
      case 'faded':
        return { fill: surface.accent, fillOpacity: 0.55 }
      case 'full':
        return { fill: surface.muted, fillOpacity: black ? 0.45 : 0.3 }
      default:
        // Unmet territory: white keys are an outline of nothing, black keys
        // need a little ink or the keyboard loses its shape entirely.
        return black ? { fill: surface.grid, fillOpacity: 0.6 } : { fill: 'none' as const }
    }
  }

  return (
    <div className="record__map">
      {strips.map((strip) => {
        const whites: number[] = []
        for (let m = strip.low; m <= strip.high; m += 1) {
          if (!BLACK.has(pitchClass(m))) whites.push(m)
        }
        const whitesBefore = (midi: number) =>
          whites.filter((w) => w < midi).length
        const width = whites.length * W
        const markC4 = strip.low <= 60 && strip.high >= 60

        return (
          <div className="record__strip" key={strip.staff}>
            <span className="record__maplabel" style={{ color: surface.muted }}>
              {strip.label}
            </span>
            <svg
              viewBox={`0 0 ${width} ${H + (markC4 ? 8 : 2)}`}
              role="img"
              aria-label={`${strip.label} fluency map`}
            >
              {whites.map((midi, i) => (
                <rect
                  key={midi}
                  x={i * W + 0.5}
                  y={0.5}
                  width={W - 1.5}
                  height={H - 1}
                  rx={1.5}
                  stroke={surface.grid}
                  strokeWidth={1}
                  {...fillFor(grade(strip.staff, midi), false)}
                />
              ))}
              {Array.from({ length: strip.high - strip.low + 1 }, (_, i) => strip.low + i)
                .filter((midi) => BLACK.has(pitchClass(midi)))
                .map((midi) => (
                  <rect
                    key={midi}
                    x={whitesBefore(midi) * W - BW / 2}
                    y={0.5}
                    width={BW}
                    height={BH}
                    rx={1}
                    stroke={surface.grid}
                    strokeWidth={0.8}
                    {...fillFor(grade(strip.staff, midi), true)}
                  />
                ))}
              {/* Middle C, so the strip is a place and not just a pattern. */}
              {markC4 && (
                <circle
                  cx={whitesBefore(60) * W + (W - 1) / 2 + 0.5}
                  cy={H + 4}
                  r={1.8}
                  fill={surface.muted}
                />
              )}
            </svg>
          </div>
        )
      })}
      <p className="record__legend" style={{ color: surface.muted }}>
        lit — read fluently · half-lit — getting there · faint — met · empty — not yet
      </p>
    </div>
  )
}
