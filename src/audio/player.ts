/**
 * Playback.
 *
 * Sound is not a nice-to-have here. A reader meeting an unfamiliar notation has
 * no way to check their reading against anything — hearing the piece while
 * watching it move is what turns an arbitrary set of colours into a learnable
 * mapping. So the prototype needs audio even though it is a visual tool.
 *
 * Synthesised rather than sampled: no network fetch, no licensing, instant
 * start. It will never be mistaken for a piano, but it is pitched, percussive,
 * and decays like one, which is all the visual sync needs.
 */

import type { Score } from '../core/types'
import { beatToSeconds } from '../core/types'

const midiToFrequency = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

interface Voice {
  oscillators: OscillatorNode[]
  gain: GainNode
}

export class Player {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private voices: Voice[] = []
  private startedAt = 0
  private startBeat = 0
  private endTimer: number | null = null

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.55
      this.master.connect(this.ctx.destination)
    }
    return this.ctx
  }

  /** Browsers require a user gesture before audio starts; call this from a click. */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') await ctx.resume()
  }

  private strike(midi: number, at: number, duration: number, velocity: number): void {
    const ctx = this.ctx!
    const frequency = midiToFrequency(midi)
    // Longer notes ring longer, but cap it so held chords do not pile up into mud.
    const ring = Math.min(duration + 0.45, 3.2)

    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    // Brighter attack on louder notes, closing as the note decays — the cheapest
    // trick that reads as "struck string" rather than "beep".
    filter.frequency.setValueAtTime(Math.min(9000, frequency * 8 + velocity * 2200), at)
    filter.frequency.exponentialRampToValueAtTime(Math.max(320, frequency * 2), at + ring)
    filter.Q.value = 0.6

    const peak = 0.16 + velocity * 0.16
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.006)
    gain.gain.exponentialRampToValueAtTime(peak * 0.28, at + 0.18)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ring)

    const oscillators: OscillatorNode[] = []
    const partials: [OscillatorType, number, number][] = [
      ['triangle', 1, 1],
      ['sine', 2, 0.34],
      ['sine', 3.01, 0.12],
    ]

    for (const [type, ratio, level] of partials) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = frequency * ratio
      const partialGain = ctx.createGain()
      partialGain.gain.value = level
      osc.connect(partialGain).connect(filter)
      osc.start(at)
      osc.stop(at + ring + 0.05)
      oscillators.push(osc)
    }

    filter.connect(gain).connect(this.master!)
    this.voices.push({ oscillators, gain })
  }

  /** Play from a beat position. Returns immediately; `onEnd` fires at the tail. */
  play(score: Score, fromBeat: number, tempoScale: number, onEnd: () => void): void {
    this.stop()
    const ctx = this.ensureContext()
    void ctx.resume()

    const originSeconds = beatToSeconds(score, fromBeat) / tempoScale
    // A small lead-in so the first note is not clipped by scheduling latency.
    const lead = 0.08
    this.startedAt = ctx.currentTime + lead
    this.startBeat = fromBeat

    let last = 0
    for (const note of score.notes) {
      if (note.onset + note.duration <= fromBeat) continue
      const onsetSeconds = beatToSeconds(score, note.onset) / tempoScale - originSeconds
      const durationSeconds =
        (beatToSeconds(score, note.onset + note.duration) / tempoScale - originSeconds) -
        onsetSeconds
      if (onsetSeconds < 0) continue
      this.strike(note.midi, this.startedAt + onsetSeconds, durationSeconds, note.velocity)
      last = Math.max(last, onsetSeconds + durationSeconds)
    }

    this.endTimer = window.setTimeout(onEnd, (lead + last) * 1000 + 120)
  }

  /** One-off note, for previewing a colour change on a specific pitch. */
  preview(midi: number): void {
    const ctx = this.ensureContext()
    void ctx.resume()
    this.strike(midi, ctx.currentTime + 0.01, 0.4, 0.7)
  }

  stop(): void {
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const voice of this.voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now)
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now)
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
        for (const osc of voice.oscillators) osc.stop(now + 0.07)
      } catch {
        // A voice that already finished throws on stop(); nothing to clean up.
      }
    }
    this.voices = []
  }

  /** Seconds of wall-clock elapsed since play() started. */
  elapsed(): number {
    if (!this.ctx) return 0
    return Math.max(0, this.ctx.currentTime - this.startedAt)
  }

  get originBeat(): number {
    return this.startBeat
  }
}

export const player = new Player()
