import { create } from 'zustand'
import type { Score } from '../core/types'
import type { LabelKind, Rule, Selector, StyleDecl, Theme } from '../core/theme'
import { cloneTheme, newRuleId } from '../core/theme'
import { PRESETS, getPreset } from '../core/presets'
import { LIBRARY } from '../core/library'
import type { CvdMode } from '../render/cvd'

// v2: colour became a {source, order, tone, rotate} config and the chromatic
// ring became the outline channel, so v1 themes no longer load.
const STORAGE_KEY = 'folio.customThemes.v2'

function loadCustomThemes(): Theme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
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

export type Screen = 'library' | 'score'

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
  cvd: CvdMode

  playing: boolean
  playheadBeat: number
  tempoScale: number

  importError: string | null
  toast: string | null

  setScreen: (screen: Screen) => void
  loadScore: (score: Score) => void
  applyPreset: (id: string) => void
  applyTheme: (theme: Theme) => void

  patchLayout: (patch: Partial<Theme['layout']>) => void
  patchEncodings: (patch: Partial<Theme['encodings']>) => void
  setSurfaceMode: (mode: 'dark' | 'paper') => void
  setLabel: (label: LabelKind) => void

  addRule: (selector: Selector, style: StyleDecl) => void
  updateRule: (id: string, style: StyleDecl) => void
  removeRule: (id: string) => void
  clearRules: () => void

  selectNote: (id: string | null) => void
  setStudioOpen: (open: boolean) => void
  setCvd: (mode: CvdMode) => void

  setPlaying: (playing: boolean) => void
  setPlayhead: (beat: number) => void
  setTempoScale: (scale: number) => void

  saveCurrentTheme: (name: string) => void
  deleteCustomTheme: (id: string) => void

  setImportError: (message: string | null) => void
  showToast: (message: string | null) => void
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
  cvd: 'none',

  playing: false,
  playheadBeat: 0,
  tempoScale: 1,

  importError: null,
  toast: null,

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
  setCvd: (cvd) => set({ cvd }),

  setPlaying: (playing) => set({ playing }),
  setPlayhead: (playheadBeat) => set({ playheadBeat }),
  setTempoScale: (tempoScale) => set({ tempoScale }),

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
}))
