import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './state/store'
import { LIBRARY } from './core/library'
import { ACCEPTED_TYPES, importFile } from './io/import'
import { beatToSeconds, secondsToBeat } from './core/types'
import { layoutScore } from './render/layout'
import { ScoreView } from './render/ScoreView'
import { Library } from './ui/Library'
import { StyleStudio } from './ui/StyleStudio'
import { Transport } from './ui/Transport'
import { player } from './audio/player'
import './styles/app.css'

export default function App() {
  const screen = useStore((s) => s.screen)
  const score = useStore((s) => s.score)
  const theme = useStore((s) => s.theme)
  const studioOpen = useStore((s) => s.studioOpen)
  const playing = useStore((s) => s.playing)
  const playheadBeat = useStore((s) => s.playheadBeat)
  const tempoScale = useStore((s) => s.tempoScale)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const cvd = useStore((s) => s.cvd)
  const toast = useStore((s) => s.toast)

  const setScreen = useStore((s) => s.setScreen)
  const setStudioOpen = useStore((s) => s.setStudioOpen)
  const setPlaying = useStore((s) => s.setPlaying)
  const setPlayhead = useStore((s) => s.setPlayhead)
  const selectNote = useStore((s) => s.selectNote)
  const loadScore = useStore((s) => s.loadScore)
  const showToast = useStore((s) => s.showToast)
  const setImportError = useStore((s) => s.setImportError)

  const canvasRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(900)

  // --- Measure the canvas so layout can wrap to the real viewport ----------
  useLayoutEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setCanvasWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [screen])

  const layout = useMemo(
    () => layoutScore(score, theme, canvasWidth),
    [score, theme, canvasWidth],
  )

  // --- Playback ------------------------------------------------------------
  useEffect(() => {
    if (!playing) return

    let frame = 0
    let cancelled = false
    const startBeat = useStore.getState().playheadBeat
    // Musical position of the start point, resolved once — the tempo map does
    // not change mid-run, so there is no reason to re-walk it every frame.
    const originSeconds = beatToSeconds(score, startBeat)

    void player.unlock().then(() => {
      if (cancelled) return

      player.play(score, startBeat, tempoScale, () => {
        setPlaying(false)
        setPlayhead(score.length)
      })

      const tick = () => {
        // player.elapsed() is wall clock; multiplying by tempoScale converts it
        // back to score time, since play() divided by the same factor.
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
    // playheadBeat is read once at start on purpose — including it would restart
    // playback on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, score, tempoScale])

  // --- Which notes are sounding right now ---------------------------------
  const activeIds = useMemo(() => {
    if (!playing) return new Set<string>()
    const ids = new Set<string>()
    for (const note of score.notes) {
      if (note.onset <= playheadBeat && note.onset + note.duration > playheadBeat) {
        ids.add(note.id)
      }
    }
    return ids
  }, [playing, playheadBeat, score.notes])

  // --- Follow the playhead down the page ----------------------------------
  useEffect(() => {
    if (!playing || !canvasRef.current) return
    const system = layout.systems.find(
      (s) => playheadBeat >= s.startBeat - 1e-6 && playheadBeat < s.endBeat - 1e-6,
    )
    if (!system) return
    const canvas = canvasRef.current
    const top = system.top
    const bottom = top + system.height
    const viewTop = canvas.scrollTop
    const viewBottom = viewTop + canvas.clientHeight - 120
    if (bottom > viewBottom || top < viewTop) {
      canvas.scrollTo({ top: Math.max(0, top - 80), behavior: 'smooth' })
    }
  }, [playing, playheadBeat, layout])

  // --- Keyboard shortcuts --------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return

      if (e.code === 'Space') {
        e.preventDefault()
        if (playing) {
          player.stop()
          setPlaying(false)
        } else {
          setPlaying(true)
        }
      }
      if (e.key === 'Escape') selectNote(null)
      if (e.key === 's' || e.key === 'S') setStudioOpen(!studioOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, studioOpen, setPlaying, setStudioOpen, selectNote])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => showToast(null), 2200)
    return () => clearTimeout(timer)
  }, [toast, showToast])

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
      <div className="app">
        <Library />
        {toast && <div className="toast">{toast}</div>}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="wordmark btn btn--ghost" onClick={() => setScreen('library')}>
          <span className="wordmark__dot" />
          Folio
        </button>

        <div className="topbar__title">
          <strong>{score.title}</strong>
          <span>{score.composer}</span>
        </div>

        <div className="topbar__spacer" />

        <div className="seg">
          {LIBRARY.slice(0, 4).map(({ score: piece }) => (
            <button
              key={piece.id}
              aria-pressed={score.id === piece.id}
              onClick={() => loadScore(piece)}
            >
              {piece.title}
            </button>
          ))}
        </div>

        <button className="btn" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES}
          hidden
          onChange={(e) => void handleImport(e.target.files?.[0])}
        />

        {!studioOpen && (
          <button className="btn btn--primary" onClick={() => setStudioOpen(true)}>
            Style
          </button>
        )}
      </header>

      <div className="stage">
        <div className="canvas" ref={canvasRef}>
          <div className="canvas__inner">
            <ScoreView
              score={score}
              theme={theme}
              layout={layout}
              playheadBeat={playheadBeat}
              playing={playing}
              activeIds={activeIds}
              selectedId={selectedNoteId}
              cvd={cvd}
              onSelectNote={selectNote}
            />
          </div>
        </div>

        {studioOpen && <StyleStudio />}
      </div>

      <Transport />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
