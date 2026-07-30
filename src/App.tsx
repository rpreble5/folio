import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './state/store'
import { LIBRARY } from './core/library'
import { ACCEPTED_TYPES, importFile } from './io/import'
import { beatToSeconds, secondsToBeat } from './core/types'
import { layoutScore } from './render/layout'
import { ScoreView } from './render/ScoreView'
import { Library } from './ui/Library'
import { StudioPanel } from './ui/StudioPanel'
import { ReadView } from './ui/ReadView'
import { PracticeView } from './ui/PracticeView'
import { NotePopover } from './ui/NotePopover'
import { Transport } from './ui/Transport'
import { Pills } from './ui/controls'
import { player } from './audio/player'
import './styles/app.css'

const POPOVER_WIDTH = 268
const POPOVER_HEIGHT = 380
const EDGE = 14

export default function App() {
  const screen = useStore((s) => s.screen)
  const score = useStore((s) => s.score)
  const theme = useStore((s) => s.theme)
  const playing = useStore((s) => s.playing)
  const midi = useStore((s) => s.midi)
  const playheadBeat = useStore((s) => s.playheadBeat)
  const tempoScale = useStore((s) => s.tempoScale)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const cvd = useStore((s) => s.cvd)
  const studioTab = useStore((s) => s.studioTab)
  const toast = useStore((s) => s.toast)

  const setScreen = useStore((s) => s.setScreen)
  const setPlaying = useStore((s) => s.setPlaying)
  const setPlayhead = useStore((s) => s.setPlayhead)
  const selectNote = useStore((s) => s.selectNote)
  const loadScore = useStore((s) => s.loadScore)
  const showToast = useStore((s) => s.showToast)
  const setImportError = useStore((s) => s.setImportError)

  const stageRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [stageWidth, setStageWidth] = useState(900)
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null)

  // --- Measure the stage so layout wraps to the real width -----------------
  useLayoutEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width))
    observer.observe(element)
    setStageWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [screen])

  const layout = useMemo(
    () => layoutScore(score, theme, stageWidth),
    [score, theme, stageWidth],
  )

  // --- Playback ------------------------------------------------------------
  useEffect(() => {
    if (!playing) return

    let frame = 0
    let cancelled = false
    const startBeat = useStore.getState().playheadBeat
    // Resolved once — the tempo map does not change mid-run.
    const originSeconds = beatToSeconds(score, startBeat)

    void player.unlock().then(() => {
      if (cancelled) return

      player.play(score, startBeat, tempoScale, () => {
        setPlaying(false)
        setPlayhead(score.length)
      })

      const tick = () => {
        // elapsed() is wall clock; scaling by tempoScale converts back to score
        // time, since play() divided by the same factor when scheduling.
        const musicalSeconds = originSeconds + player.elapsed() * tempoScale
        setPlayhead(Math.min(secondsToBeat(score, musicalSeconds), score.length))
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      player.stop()
    }
    // playheadBeat is read once at start on purpose; including it would restart
    // playback every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, score, tempoScale])

  /**
   * What is lit: playback's own notes, or the ones under the player's hands.
   *
   * Worth having here and not only in the reading view — seeing your own playing
   * light up while you are choosing colours is the fastest way to find out that
   * two of them look alike.
   */
  const activeIds = useMemo(() => {
    if (midi.connected && !playing) return midi.lit
    if (!playing) return new Set<string>()
    const ids = new Set<string>()
    for (const note of score.notes) {
      if (note.onset <= playheadBeat && note.onset + note.duration > playheadBeat) {
        ids.add(note.id)
      }
    }
    return ids
  }, [playing, playheadBeat, score.notes, midi.connected, midi.lit])

  // --- Follow the playhead down the page ----------------------------------
  useEffect(() => {
    if (!playing || !stageRef.current) return
    const system = layout.systems.find(
      (s) => playheadBeat >= s.startBeat - 1e-6 && playheadBeat < s.endBeat - 1e-6,
    )
    if (!system) return
    const stage = stageRef.current
    const bottom = system.top + system.height
    if (bottom > stage.scrollTop + stage.clientHeight - 24 || system.top < stage.scrollTop) {
      stage.scrollTo({ top: Math.max(0, system.top - 40), behavior: 'smooth' })
    }
  }, [playing, playheadBeat, layout])

  // --- Keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT') return
      // Read view binds the same keys to its own handlers; without this both
      // fire and space toggles playback twice, which is a no-op that looks
      // like a dropped keypress.
      const active = useStore.getState().screen
      if (active === 'read' || active === 'practice') return

      if (e.code === 'Space') {
        e.preventDefault()
        if (playing) {
          player.stop()
          setPlaying(false)
        } else {
          setPlaying(true)
        }
      }
      if (e.key === 'Escape') {
        selectNote(null)
        setPopover(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, setPlaying, selectNote])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => showToast(null), 2400)
    return () => clearTimeout(timer)
  }, [toast, showToast])

  const handleSelectNote = (id: string | null, at?: { x: number; y: number }) => {
    selectNote(id)
    if (!id || !at) {
      setPopover(null)
      return
    }
    // Clamp into the viewport, and flip above the click when there is no room
    // below — otherwise the editor opens half off-screen for low notes.
    const x = Math.min(at.x + 18, window.innerWidth - POPOVER_WIDTH - EDGE)
    const fitsBelow = at.y + POPOVER_HEIGHT + EDGE < window.innerHeight
    const y = fitsBelow
      ? Math.max(EDGE, at.y - 40)
      : Math.max(EDGE, window.innerHeight - POPOVER_HEIGHT - EDGE)
    setPopover({ x: Math.max(EDGE, x), y })
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const imported = await importFile(file)
      if (imported.notes.length === 0) throw new Error('No playable notes in that file.')
      loadScore(imported)
      showToast(`Loaded ${imported.title}`)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read that file.')
      setScreen('library')
    }
  }

  if (screen === 'library') {
    return (
      <>
        <Library />
        {toast && <div className="toast">{toast}</div>}
      </>
    )
  }

  // Read view keeps the same score, theme and playhead — it is the same session
  // seen without the workbench around it, not a separate mode with its own state.
  if (screen === 'read') return <ReadView />
  if (screen === 'practice') return <PracticeView />

  // Two tabs are workbenches rather than rows of settings — the hue wheel and
  // the staff editor are both things you look *at* while dragging — so they
  // borrow height from the score, which stays visible either way.
  const lab = studioTab === 'colour' || studioTab === 'staff'

  return (
    <div className={lab ? 'app app--lab' : 'app'}>
      <header className="topbar">
        <button className="wordmark" onClick={() => setScreen('library')}>
          <span className="wordmark__dot" />
          Folio
        </button>

        <div className="topbar__title">
          <strong>{score.title}</strong>
          <span>{score.composer}</span>
        </div>

        <div className="topbar__spacer" />

        <Pills
          options={LIBRARY.map(({ score: piece }) => ({
            value: piece.id,
            label: piece.title,
          }))}
          value={score.id}
          onChange={(id) => {
            const entry = LIBRARY.find((e) => e.score.id === id)
            if (entry) loadScore(entry.score)
          }}
        />

        <button className="pill pill--solid" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <button className="pill pill--solid" onClick={() => setScreen('practice')}>
          Practise
        </button>

        <button className="pill pill--accent" onClick={() => setScreen('read')}>
          Read
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES}
          hidden
          onChange={(e) => void handleImport(e.target.files?.[0])}
        />
      </header>

      <div className="stage" ref={stageRef} onClick={() => handleSelectNote(null)}>
        <ScoreView
          score={score}
          theme={theme}
          layout={layout}
          playheadBeat={playheadBeat}
          playing={playing}
          activeIds={activeIds}
          selectedId={selectedNoteId}
          cvd={cvd}
          onSelectNote={handleSelectNote}
        />
      </div>

      <StudioPanel />
      <Transport />

      {popover && selectedNoteId && <NotePopover x={popover.x} y={popover.y} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
