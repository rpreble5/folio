/**
 * Read view: the stage the Studio has been building for.
 *
 * Everything the Studio needs — tabs, tiles, a note popover, a title bar — is
 * scaffolding around the thing being made, and none of it belongs in front of
 * someone playing. So this is the score and nothing else, edge to edge, in the
 * page colour they chose. The controls exist but stay out of the way until a
 * hand moves.
 *
 * Two decisions carry most of the weight.
 *
 * **Size comes from how much you want to see, not from a zoom level.** You say
 * how many systems should be on screen; the view works out the scale that makes
 * exactly that many fill the height. Two is the default because it is the
 * smallest number that always shows you what is coming next.
 *
 * **It advances by system, never by pixel.** A continuously scrolling score is
 * unreadable — the eye is trying to hold a fixed point while the page slides
 * under it. Here the music stays perfectly still until the playhead leaves the
 * top system, and then the whole thing steps up by exactly one, so the system
 * you were reading is gone and a new one has appeared below the one you are now
 * on. That is the same move a Bluetooth keyboard will eventually drive: not a
 * page turn that has to be timed, but the next line materialising while you are
 * still reading the current one.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { session, useStore } from '../state/store'
import { exitFullscreen, keepAwake } from './screen'
import { layoutScore } from '../render/layout'
import { ScoreView } from '../render/ScoreView'
import { player } from '../audio/player'
import { beatsPerMeasure, timeSignatureAt } from '../core/types'

/** How many systems can be asked for at once. */
const MIN_SYSTEMS = 1
const MAX_SYSTEMS = 5

/** Controls fade out this long after the last movement. */
const IDLE_MS = 2600

export function ReadView() {
  const score = useStore((s) => s.score)
  const theme = useStore((s) => s.theme)
  const playing = useStore((s) => s.playing)
  const playheadBeat = useStore((s) => s.playheadBeat)
  const cvd = useStore((s) => s.cvd)
  const setScreen = useStore((s) => s.setScreen)
  const setPlaying = useStore((s) => s.setPlaying)
  const setPlayhead = useStore((s) => s.setPlayhead)
  const systemsShown = useStore((s) => s.readSystems)
  const setSystemsShown = useStore((s) => s.setReadSystems)
  const midi = useStore((s) => s.midi)
  const connectMidi = useStore((s) => s.connectMidi)
  const disconnectMidi = useStore((s) => s.disconnectMidi)

  const [viewport, setViewport] = useState({ width: 1200, height: 800 })
  const [awake, setAwake] = useState(true)
  const idleTimer = useRef<number | null>(null)

  useLayoutEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  /**
   * Two passes, because the two dimensions want different things.
   *
   * A system's height does not depend on how wide the page is — it comes from
   * the pitch range and the note height — so one layout at any width tells us
   * what a row costs. From that we get the scale that puts `systemsShown` rows
   * in the viewport, and from the scale we get the width the score should be
   * laid out at so that scaling it back up lands exactly on the screen.
   *
   * Doing it the other way round — laying out at the screen width and then
   * scaling — can only ever shrink, so the reader would be stuck at whatever
   * size the editing view happened to produce.
   */
  const { layout, scale } = useMemo(() => {
    const probe = layoutScore(score, theme, viewport.width)
    const rowHeight = probe.systemInnerHeight + theme.layout.systemGap
    /*
     * Fit into the height above the control bar, not the whole window.
     *
     * The systems used to be scaled to fill the full height, which put the
     * last line's tail underneath the capsule — and the capsule reappears on
     * any movement, which is precisely when someone is reading that line.
     * Ninety-two pixels is the capsule, the hint under it, and their margins.
     */
    const RESERVE = 92
    const wanted =
      Math.max(200, viewport.height - RESERVE) / (systemsShown * Math.max(1, rowHeight))
    // Below 1 the score is being shrunk to fit, which is legitimate on a short
    // window; above about 4 the notes are so large that a system holds almost
    // nothing, and the layout width would collapse.
    const s = Math.max(0.35, Math.min(4, wanted))
    return { layout: layoutScore(score, theme, viewport.width / s), scale: s }
  }, [score, theme, viewport, systemsShown])

  const count = layout.systems.length

  /** Which system the playhead is in. */
  const current = useMemo(() => {
    const found = layout.systems.findIndex(
      (s) => playheadBeat >= s.startBeat - 1e-6 && playheadBeat < s.endBeat - 1e-6,
    )
    return found === -1 ? Math.max(0, count - 1) : found
  }, [layout.systems, playheadBeat, count])

  /**
   * Fixed slots, refilled from underneath — the reason nothing on this screen
   * ever moves.
   *
   * The obvious build is a canvas that scrolls up a system at a time, and it is
   * wrong in a way that only shows up while actually reading: the moment you
   * reach the end of a line and need to jump to the start of the next one, that
   * next line is exactly what has just moved. The reader is asked to re-find
   * their place at the one instant they can least afford to.
   *
   * So the systems do not move at all. There are N frames at fixed heights, and
   * slot i always holds the system with index ≡ i (mod N) drawn from the window
   * [current, current + N − 1]. Work through what that means for two slots: on
   * system 0 they hold 0 and 1; on system 1 they hold 2 and 1 — the top slot has
   * quietly become the system *after* next while you were reading the bottom
   * one; on system 2 they hold 2 and 3. Exactly one slot changes per step, and
   * it is never the one being read. The line you are about to need has been
   * sitting there since before you needed it.
   *
   * This is also the shape live input wants: nothing here is timed, so a
   * Bluetooth keyboard reporting "they are in bar 9 now" needs only to move
   * `current`, and the right line is already on screen.
   */
  const slots = useMemo(() => {
    const rowHeight = layout.systemInnerHeight + theme.layout.systemGap
    return Array.from({ length: systemsShown }, (_, slot) => {
      // The one index in the window that belongs in this slot.
      const offset = (((slot - current) % systemsShown) + systemsShown) % systemsShown
      return { system: current + offset, y: slot * rowHeight + theme.layout.systemGap / 2 }
    }).filter((s) => s.system < count)
  }, [current, systemsShown, count, layout.systemInnerHeight, theme.layout.systemGap])

  const step = (delta: number) => {
    const next = Math.max(0, Math.min(current + delta, count - 1))
    const system = layout.systems[next]
    if (!system) return
    setPlayhead(system.startBeat)
    // The follower has to come along, or the next note played would drag the
    // page straight back to where the reader just moved it from.
    session.seek(system.startBeat)
  }

  const wake = () => {
    setAwake(true)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setAwake(false), IDLE_MS)
  }

  useEffect(() => {
    wake()
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Leave fullscreen on the way out.
   *
   * *Entering* it happens in the button that navigates here, not in an effect:
   * Android refuses a fullscreen request that is not attached to a real gesture,
   * and an effect running after navigation is not one. Asking here meant the
   * request was denied every time and the rejection was swallowed — the view has
   * never actually been fullscreen on a phone.
   */
  useEffect(() => exitFullscreen, [])

  /**
   * And keep the screen on.
   *
   * A piece takes minutes and a phone locks in less. Fullscreen without this is
   * a beautiful view that goes black halfway through a piece.
   */
  useEffect(keepAwake, [])

  const toggle = () => {
    if (playing) {
      player.stop()
      setPlaying(false)
    } else {
      if (playheadBeat >= score.length - 1e-6) setPlayhead(0)
      setPlaying(true)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      wake()
      switch (e.key) {
        case 'Escape':
          if (playing) {
            player.stop()
            setPlaying(false)
          }
          setScreen('score')
          break
        case ' ':
          e.preventDefault()
          toggle()
          break
        case 'ArrowDown':
        case 'PageDown':
          e.preventDefault()
          step(1)
          break
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault()
          step(-1)
          break
        case 'Home':
          e.preventDefault()
          setPlayhead(0)
          break
        case '+':
        case '=':
          setSystemsShown(Math.min(MAX_SYSTEMS, systemsShown + 1))
          break
        case '-':
          setSystemsShown(Math.max(MIN_SYSTEMS, systemsShown - 1))
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, current, systemsShown, layout, score])

  /**
   * What is lit: the notes sounding under playback, or the notes under the
   * player's hands. Never both — playback and a keyboard are two ways of
   * answering the same question, and showing both at once would make it
   * impossible to tell which one you were watching.
   */
  const activeIds = useMemo(() => {
    if (midi.connected && !playing) return midi.lit
    if (!playing) return new Set<string>()
    const ids = new Set<string>()
    for (const note of score.notes) {
      if (note.onset <= playheadBeat && note.onset + note.duration > playheadBeat) ids.add(note.id)
    }
    return ids
  }, [playing, playheadBeat, score.notes, midi.connected, midi.lit])

  const barLength = beatsPerMeasure(timeSignatureAt(score, playheadBeat))
  const bar = Math.min(
    Math.max(1, Math.ceil(score.length / barLength)),
    Math.floor(playheadBeat / barLength) + 1,
  )
  const totalBars = Math.max(1, Math.ceil(score.length / barLength))

  const rowHeight = layout.systemInnerHeight + theme.layout.systemGap
  const frameHeight = systemsShown * rowHeight

  /**
   * A mark down the edge of the line being played.
   *
   * Motion is normally what tells a reader where they are, and this view has
   * deliberately removed all of it — so something has to say which of the
   * frames is live. A rule at the edge does it without touching the music:
   * dimming the other lines would work too, and would cost exactly the
   * lookahead the second frame exists to provide.
   */
  const marker = {
    top: ((current % systemsShown) * rowHeight + theme.layout.systemGap / 2) * scale,
    height: layout.systemInnerHeight * scale,
  }

  return (
    <div
      className={`read${awake ? '' : ' read--quiet'}`}
      style={{ background: theme.surface.background }}
      onMouseMove={wake}
      onPointerDown={wake}
    >
      <div className="read__page" style={{ transform: `scale(${scale})`, width: layout.width }}>
        <ScoreView
          score={score}
          theme={theme}
          layout={layout}
          playheadBeat={playheadBeat}
          playing={playing}
          activeIds={activeIds}
          selectedId={null}
          cvd={cvd}
          onSelectNote={() => {}}
          slots={slots}
          height={frameHeight}
        />
      </div>

      <div
        className="read__here"
        style={{
          top: marker.top,
          height: marker.height,
          background: theme.surface.text,
        }}
        aria-hidden="true"
      />

      {/* One capsule, bottom centre, over the page's own colour rather than the
          app's dark chrome — the reader is looking at a page, not at software. */}
      <div className="read__bar" style={{ color: theme.surface.text }}>
        <button className="read__btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="10" height="12" viewBox="0 0 11 13" fill="currentColor">
              <rect width="3.6" height="13" rx="1.1" />
              <rect x="7.4" width="3.6" height="13" rx="1.1" />
            </svg>
          ) : (
            <svg width="11" height="12" viewBox="0 0 12 13" fill="currentColor">
              <path d="M1.2 1.05a.9.9 0 0 1 1.37-.77l8.2 5.2a.9.9 0 0 1 0 1.53l-8.2 5.2a.9.9 0 0 1-1.37-.76Z" />
            </svg>
          )}
        </button>

        <span className="read__where">
          bar {bar} <i>/</i> {totalBars}
        </span>

        <span className="read__sep" />

        <button
          className="read__btn read__btn--text"
          onClick={() => setSystemsShown(Math.max(MIN_SYSTEMS, systemsShown - 1))}
          disabled={systemsShown <= MIN_SYSTEMS}
          aria-label="Show fewer lines, larger"
        >
          −
        </button>
        <span className="read__where">
          {systemsShown} line{systemsShown === 1 ? '' : 's'}
        </span>
        <button
          className="read__btn read__btn--text"
          onClick={() => setSystemsShown(Math.min(MAX_SYSTEMS, systemsShown + 1))}
          disabled={systemsShown >= MAX_SYSTEMS}
          aria-label="Show more lines, smaller"
        >
          +
        </button>

        <span className="read__sep" />

        {/* One button, three states. A device that is connected says so by
            naming itself, because "connected" is not the reassurance a player
            wants — the name of their own keyboard is. */}
        <button
          className={`read__btn read__btn--text${midi.connected ? ' read__btn--live' : ''}`}
          onClick={() => (midi.connected ? disconnectMidi() : void connectMidi())}
          disabled={midi.connecting}
          title={midi.error ?? undefined}
        >
          {midi.connecting
            ? 'Connecting…'
            : midi.connected
              ? (midi.devices[0]?.name ?? 'Listening')
              : 'Keyboard'}
        </button>

        <span className="read__sep" />

        <button className="read__btn read__btn--text" onClick={() => setScreen('score')}>
          Done
        </button>
      </div>

      {/* Shown once and then only when the controls are woken, because a hint
          that never goes away is an advertisement. */}
      <div className="read__hint" style={{ color: theme.surface.muted }}>
        {midi.error ?? 'space to play · ↑ ↓ to move · esc to leave'}
      </div>
    </div>
  )
}
