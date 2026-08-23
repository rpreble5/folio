import { create } from 'zustand'
import type { Score } from '../core/types'
import type { LabelKind, Rule, Selector, StyleDecl, Theme } from '../core/theme'
import { cloneTheme, makeSurface, newRuleId } from '../core/theme'
import { lightnessOf } from '../core/oklch'
import { PRESETS, getPreset } from '../core/presets'
import { LIBRARY } from '../core/library'
import type { CvdMode } from '../render/cvd'
import type { MidiDevice } from '../io/midi'
import { createSession } from '../practice/session'
import { loadHistory, record, type History, type Reading } from '../practice/history'

// v2: colour became a {source, order, tone, rotate} config and the chromatic
// ring became the outline channel, so v1 themes no longer load.
const STORAGE_KEY = 'folio.customThemes.v2'

/**
 * Backfill anything a saved theme predates.
 *
 * New channels keep arriving, and a theme saved last week has no opinion about
 * them. Left undefined they do not fall back — an absent labelOn stops every
 * label rendering — so a style someone built and named would quietly break. The
 * alternative, bumping the storage key, deletes their work to avoid the
 * problem. Filling the gaps from the defaults keeps everything they chose and
 * gives the rest the value a new theme would have.
 */
function fillGaps(theme: Theme): Theme {
  const base = getPreset('chromatic-roll')
  const layout = { ...base.layout, ...theme.layout }
  return {
    ...theme,
    // Copied rather than shared: these nest one level deeper than the spread
    // reaches, and a preset is a template, not a thing a loaded theme may edit.
    layout: {
      ...layout,
      lines: { ...base.layout.lines, ...theme.layout?.lines },
      staff: {
        lines: { ...theme.layout?.staff?.lines },
        spaces: { ...theme.layout?.staff?.spaces },
      },
    },
    encodings: {
      ...base.encodings,
      ...theme.encodings,
      // Same one-level-deep problem: a saved theme's colour config is a whole
      // object, so it replaces the defaults rather than merging with them and
      // arrives missing whichever axes were added since.
      color: { ...base.encodings.color, ...theme.encodings?.color },
      // labelTint used to carry its direction in its sign. A stored negative
      // means "darker", so it becomes a magnitude and an explicit direction —
      // flipping the number alone would have quietly inverted saved styles.
      labelTint: Math.abs(theme.encodings?.labelTint ?? base.encodings.labelTint),
      labelTintDir:
        theme.encodings?.labelTintDir ??
        ((theme.encodings?.labelTint ?? 0) < 0 ? 'darker' : base.encodings.labelTintDir),
      trail: { ...base.encodings.trail, ...theme.encodings?.trail },
      texture: { ...base.encodings.texture, ...theme.encodings?.texture },
    },
    surface: { ...base.surface, ...theme.surface },
    rules: theme.rules ?? [],
  }
}

function loadCustomThemes(): Theme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(fillGaps) : []
  } catch {
    // A corrupt entry should cost the user their saved styles, not the app.
    return []
  }
}

function persistCustomThemes(themes: Theme[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(themes))
  } catch {
    // Private browsing or a full quota. Saving is a convenience, not a contract.
  }
}

export type Screen = 'library' | 'score' | 'read' | 'practice'
export type StudioTab =
  | 'styles'
  | 'colour'
  | 'emphasis'
  | 'marks'
  | 'labels'
  | 'staff'
  | 'notation'
  | 'page'

interface State {
  screen: Screen
  score: Score
  theme: Theme
  /** Which preset the current theme started from, for the "modified" badge. */
  basePresetId: string
  dirty: boolean
  customThemes: Theme[]

  selectedNoteId: string | null
  studioOpen: boolean
  /** Lifted so the shell can give Colour a taller panel. */
  studioTab: StudioTab
  cvd: CvdMode
  /**
   * How many systems the Read view fits on screen at once.
   *
   * Kept here rather than inside the view so it survives leaving and coming
   * back — it is a reading preference, not view state, and someone who wants
   * two lines wants two lines every time.
   */
  readSystems: number

  playing: boolean
  playheadBeat: number
  tempoScale: number

  /**
   * The practice record, held here rather than in the practice view because
   * label weaning reads it everywhere a label is drawn — the score screen and
   * the reading view included, which is where the labels actually live.
   */
  history: History

  importError: string | null
  toast: string | null

  /**
   * The connected keyboard, and what it is doing.
   *
   * Held in the store rather than in the reading view because a connection
   * outlives the screen that started it — walking back to the library to pick a
   * different piece should not drop the keyboard.
   */
  midi: MidiState

  setScreen: (screen: Screen) => void
  loadScore: (score: Score) => void
  applyPreset: (id: string) => void
  applyTheme: (theme: Theme) => void

  patchLayout: (patch: Partial<Theme['layout']>) => void
  patchEncodings: (patch: Partial<Theme['encodings']>) => void
  setSurfaceMode: (mode: 'dark' | 'paper') => void
  /** Any colour can be a page; the rest of the surface derives from it. */
  setPage: (background: string) => void
  setLabel: (label: LabelKind) => void

  addRule: (selector: Selector, style: StyleDecl) => void
  updateRule: (id: string, style: StyleDecl) => void
  removeRule: (id: string) => void
  clearRules: () => void

  selectNote: (id: string | null) => void
  setStudioOpen: (open: boolean) => void
  setStudioTab: (tab: StudioTab) => void
  setReadSystems: (count: number) => void
  setCvd: (mode: CvdMode) => void

  setPlaying: (playing: boolean) => void
  setPlayhead: (beat: number) => void
  setTempoScale: (scale: number) => void

  /** Fold one answered prompt into the practice record. */
  recordReading: (reading: Reading) => void
  clearPracticeHistory: () => void

  saveCurrentTheme: (name: string) => void
  deleteCustomTheme: (id: string) => void

  setImportError: (message: string | null) => void
  showToast: (message: string | null) => void

  connectMidi: () => Promise<void>
  connectBluetooth: () => Promise<void>
  disconnectMidi: () => void
  /** Held keys, matched note ids and follower position, from one key press. */
  setMidiHeld: (held: Set<number>, lit: Set<string>) => void
  setMidiStatus: (patch: Partial<MidiState>) => void
  setFollowing: (following: boolean) => void
}

export interface MidiState {
  /** Null until a connection has been attempted. */
  connected: boolean
  connecting: boolean
  devices: MidiDevice[]
  error: string | null
  /** Keys currently down, as MIDI numbers. */
  held: Set<number>
  /** Score notes those keys account for, for the highlight. */
  lit: Set<string>
  /** Whether the follower drives the reading position. */
  following: boolean
  /** Rolling agreement with the score, 0 to 1. */
  confidence: number
  wrong: number
  /**
   * The last key pressed and how many have arrived, regardless of the score.
   *
   * Diagnostic. A connection can succeed, find a device, and still deliver
   * nothing — a MIDI cable in the wrong socket, an instrument with its
   * transmit channel off — and every other signal in this app depends on a
   * note *matching* something, so none of them can tell that apart from
   * playing the wrong notes.
   */
  lastNote: number | null
  noteCount: number
}

const NO_MIDI: MidiState = {
  connected: false,
  connecting: false,
  devices: [],
  error: null,
  held: new Set(),
  lit: new Set(),
  following: true,
  confidence: 0,
  wrong: 0,
  lastNote: null,
  noteCount: 0,
}

const DARK: Theme['surface'] = PRESETS[0].surface
const PAPER: Theme['surface'] = getPreset('ink').surface

export const useStore = create<State>((set, get) => ({
  screen: 'library',
  score: LIBRARY[0].score,
  theme: cloneTheme(PRESETS[0]),
  basePresetId: PRESETS[0].id,
  dirty: false,
  customThemes: loadCustomThemes(),

  selectedNoteId: null,
  studioOpen: true,
  studioTab: 'styles',
  cvd: 'none',
  readSystems: 2,

  playing: false,
  playheadBeat: 0,
  tempoScale: 1,

  history: loadHistory(),

  importError: null,
  toast: null,
  midi: NO_MIDI,

  setScreen: (screen) => set({ screen }),

  loadScore: (score) =>
    set({ score, screen: 'score', playheadBeat: 0, playing: false, selectedNoteId: null }),

  applyPreset: (id) => {
    const preset = getPreset(id)
    set({
      theme: cloneTheme(preset),
      basePresetId: preset.id,
      dirty: false,
      selectedNoteId: null,
    })
  },

  applyTheme: (theme) =>
    set({ theme: cloneTheme(theme), basePresetId: theme.id, dirty: false, selectedNoteId: null }),

  patchLayout: (patch) =>
    set((s) => ({
      theme: { ...s.theme, layout: { ...s.theme.layout, ...patch } },
      dirty: true,
    })),

  patchEncodings: (patch) =>
    set((s) => ({
      theme: { ...s.theme, encodings: { ...s.theme.encodings, ...patch } },
      dirty: true,
    })),

  setSurfaceMode: (mode) =>
    set((s) => ({
      theme: { ...s.theme, surface: { ...(mode === 'dark' ? DARK : PAPER) } },
      dirty: true,
    })),

  setPage: (background) =>
    set((s) => {
      /*
       * Ink follows the page across the midline.
       *
       * Achromatic anchors are chosen, not derived — the engraved preset picks
       * black ink because its page is paper. The choice goes stale at exactly
       * one moment: when the page crosses from light to dark or back. Left
       * alone, a dark page under the engraved preset showed near-black heads on
       * near-black paper — invisible music. So the anchors flip with the page,
       * and only when it actually crosses; recolouring within the same side
       * would overwrite a deliberate choice for no legibility gain.
       */
      const wasDark = lightnessOf(s.theme.surface.background) < 0.5
      const isDark = lightnessOf(background) < 0.5
      let encodings = s.theme.encodings
      const anchors = encodings.color?.achromatic
      if (wasDark !== isDark && anchors?.some((a) => a !== 'none')) {
        encodings = {
          ...encodings,
          color: {
            ...encodings.color,
            achromatic: anchors.map((a) =>
              a === 'dark' ? 'light' : a === 'light' ? 'dark' : 'none',
            ),
          },
        }
      }
      return { theme: { ...s.theme, surface: makeSurface(background), encodings }, dirty: true }
    }),

  setLabel: (label) =>
    set((s) => ({
      theme: { ...s.theme, encodings: { ...s.theme.encodings, label } },
      dirty: true,
    })),

  addRule: (selector, style) =>
    set((s) => {
      const rule: Rule = { id: newRuleId(), selector, style, enabled: true }
      // Replace rather than stack when the same target is re-styled, so the rule
      // list stays a readable summary instead of an append-only log.
      const rules = s.theme.rules.filter(
        (r) => JSON.stringify(r.selector) !== JSON.stringify(selector),
      )
      return { theme: { ...s.theme, rules: [...rules, rule] }, dirty: true }
    }),

  updateRule: (id, style) =>
    set((s) => ({
      theme: {
        ...s.theme,
        rules: s.theme.rules.map((r) => (r.id === id ? { ...r, style: { ...r.style, ...style } } : r)),
      },
      dirty: true,
    })),

  removeRule: (id) =>
    set((s) => ({
      theme: { ...s.theme, rules: s.theme.rules.filter((r) => r.id !== id) },
      dirty: true,
    })),

  clearRules: () => set((s) => ({ theme: { ...s.theme, rules: [] }, dirty: true })),

  selectNote: (id) => set({ selectedNoteId: id }),
  setStudioOpen: (studioOpen) => set({ studioOpen }),
  setStudioTab: (studioTab) => set({ studioTab }),
  setReadSystems: (readSystems) => set({ readSystems }),
  setCvd: (cvd) => set({ cvd }),

  setPlaying: (playing) => set({ playing }),
  setPlayhead: (playheadBeat) => set({ playheadBeat }),
  setTempoScale: (tempoScale) => set({ tempoScale }),

  recordReading: (reading) => set((s) => ({ history: record(s.history, reading) })),
  clearPracticeHistory: () => {
    try {
      localStorage.removeItem('folio.history.v1')
    } catch {
      // Private browsing. The in-memory record still clears.
    }
    set({ history: { notes: {}, items: {} } })
  },

  saveCurrentTheme: (name) => {
    const { theme, customThemes } = get()
    const saved = cloneTheme(theme, {
      id: `custom-${Date.now().toString(36)}`,
      name,
      description: 'Your saved style.',
    })
    const next = [...customThemes, saved]
    persistCustomThemes(next)
    set({ customThemes: next, theme: saved, basePresetId: saved.id, dirty: false, toast: `Saved “${name}”` })
  },

  deleteCustomTheme: (id) => {
    const next = get().customThemes.filter((t) => t.id !== id)
    persistCustomThemes(next)
    set({ customThemes: next })
  },

  setImportError: (importError) => set({ importError }),
  showToast: (toast) => set({ toast }),

  connectMidi: async () => {
    set({ midi: { ...get().midi, connecting: true, error: null } })
    session.setScore(get().score)
    await session.connect()
    set({ midi: { ...get().midi, connecting: false } })
  },

  connectBluetooth: async () => {
    set({ midi: { ...get().midi, connecting: true, error: null } })
    session.setScore(get().score)
    await session.connectBluetooth()
    set({ midi: { ...get().midi, connecting: false } })
  },

  disconnectMidi: () => {
    session.disconnect()
  },

  setMidiHeld: (held, lit) => set({ midi: { ...get().midi, held, lit } }),

  setMidiStatus: (patch) => set({ midi: { ...get().midi, ...patch } }),

  setFollowing: (following) => set({ midi: { ...get().midi, following } }),
}))

/**
 * The one live session.
 *
 * A module singleton rather than store state: it owns a device handle and a
 * mutable follower, neither of which anything renders, and putting them in the
 * store would mean a re-render per key press for data nobody reads.
 *
 * Its handlers write back into the store, which is why it is created after it —
 * `useStore` has to exist before anything can call `setState` on it.
 */
export const session = createSession({
  onStatus: (patch) =>
    useStore.setState((s) => ({ midi: { ...s.midi, ...patch } })),

  onNotes: (held, lit) =>
    useStore.setState((s) => ({ midi: { ...s.midi, held, lit } })),

  onRaw: (note, on) => {
    if (!on) return
    useStore.setState((s) => ({
      midi: { ...s.midi, lastNote: note, noteCount: s.midi.noteCount + 1 },
    }))
  },

  onPosition: (beat, snapshot) =>
    useStore.setState((s) => {
      const midi = { ...s.midi, confidence: snapshot.confidence, wrong: snapshot.wrong }
      // Following is what moves the reading position; with it off the keyboard
      // still lights notes up, which is worth having on its own.
      if (!s.midi.following) return { midi }
      return { midi, playheadBeat: beat }
    }),
})

// Loading a piece has to rebuild the follower, or the keyboard would still be
// matching against the score before it.
useStore.subscribe((state, previous) => {
  if (state.score !== previous.score) session.setScore(state.score)
})
