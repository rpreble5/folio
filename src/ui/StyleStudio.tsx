import { useState } from 'react'
import { useStore } from '../state/store'
import { PRESETS } from '../core/presets'
import { PALETTES, SHAPE_SETS, getPalette } from '../core/palettes'
import { describeSelector, type LabelKind } from '../core/theme'
import { CVD_MODES } from '../render/cvd'
import { Field, Section, Segmented, ShapePreview, Slider, Toggle } from './controls'
import { NoteInspector } from './NoteInspector'

const LABEL_OPTIONS: { value: LabelKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'letter', label: 'A B C' },
  { value: 'solfege', label: 'Do Re' },
  { value: 'degree', label: '1 2 3' },
  { value: 'finger', label: 'Finger' },
]

export function StyleStudio() {
  const theme = useStore((s) => s.theme)
  const basePresetId = useStore((s) => s.basePresetId)
  const dirty = useStore((s) => s.dirty)
  const customThemes = useStore((s) => s.customThemes)
  const cvd = useStore((s) => s.cvd)
  const selectedNoteId = useStore((s) => s.selectedNoteId)

  const applyPreset = useStore((s) => s.applyPreset)
  const applyTheme = useStore((s) => s.applyTheme)
  const patchLayout = useStore((s) => s.patchLayout)
  const patchEncodings = useStore((s) => s.patchEncodings)
  const setSurfaceMode = useStore((s) => s.setSurfaceMode)
  const setCvd = useStore((s) => s.setCvd)
  const removeRule = useStore((s) => s.removeRule)
  const clearRules = useStore((s) => s.clearRules)
  const saveCurrentTheme = useStore((s) => s.saveCurrentTheme)
  const deleteCustomTheme = useStore((s) => s.deleteCustomTheme)
  const setStudioOpen = useStore((s) => s.setStudioOpen)

  const [name, setName] = useState('')
  const palette = getPalette(theme.encodings.palette)

  return (
    <aside className="studio" aria-label="Style studio">
      <div className="studio__header">
        <h2>Style Studio</h2>
        {dirty && <span className="badge badge--dim">Modified</span>}
        <button
          className="btn btn--ghost btn--icon"
          onClick={() => setStudioOpen(false)}
          title="Hide the studio"
        >
          ✕
        </button>
      </div>

      {selectedNoteId && <NoteInspector />}

      <Section title="Start from">
        <div className="presets">
          {PRESETS.map((preset) => {
            const presetPalette = getPalette(preset.encodings.palette)
            return (
              <button
                key={preset.id}
                className="preset"
                aria-pressed={basePresetId === preset.id}
                onClick={() => applyPreset(preset.id)}
                title={preset.description}
              >
                {/* Backing the strip with the preset's own page colour lets a
                    monochrome style like Ink preview as ink-on-paper rather
                    than as an invisible dark bar on a dark card. */}
                <div
                  className="preset__swatches"
                  style={{ background: preset.surface.background }}
                >
                  {sampleColors(presetPalette.colors, preset.surface.text).map((color, i) => (
                    <i key={i} style={{ background: color }} />
                  ))}
                </div>
                <div className="preset__name">{preset.name}</div>
                {preset.accessible && <span className="badge">{preset.accessible}</span>}
              </button>
            )
          })}
        </div>
        <div className="field__hint">{describePreset(basePresetId)}</div>
      </Section>

      {customThemes.length > 0 && (
        <Section title="Your styles">
          {customThemes.map((custom) => (
            <div className="rule" key={custom.id}>
              <span
                className="rule__swatch"
                style={{ background: getPalette(custom.encodings.palette).colors[0] }}
              />
              <button
                className="rule__label"
                style={{ textAlign: 'left' }}
                onClick={() => applyTheme(custom)}
              >
                {custom.name}
              </button>
              <button
                className="rule__remove"
                onClick={() => deleteCustomTheme(custom.id)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </Section>
      )}

      <Section title="Colour">
        <Field label="Colour by" hint={palette.note}>
          <select
            value={theme.encodings.palette}
            onChange={(e) => patchEncodings({ palette: e.target.value })}
          >
            {PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.cvdSafe ? ' — colour-blind safe' : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="swatch-row">
          {palette.colors.map((color, i) => (
            <button
              key={i}
              style={{
                background: color === '@ink' ? theme.surface.text : color,
                gridColumn: palette.colors.length < 12 ? 'span 3' : undefined,
              }}
              title={swatchTitle(palette.domain, i)}
              disabled
            />
          ))}
        </div>

        {!palette.cvdSafe && (
          <div className="field__hint">
            Twelve hues cannot all stay distinct for a colour-blind reader. Pair this with a shape
            or label channel below, or check it with the simulator.
          </div>
        )}
      </Section>

      <Section title="Shape & label">
        <Field
          label="Shape by"
          hint={SHAPE_SETS.find((s) => s.id === theme.encodings.shapeSet)?.note}
        >
          <select
            value={theme.encodings.shapeSet}
            onChange={(e) => patchEncodings({ shapeSet: e.target.value })}
          >
            {SHAPE_SETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
            {SHAPE_SETS.find((s) => s.id === theme.encodings.shapeSet)?.shapes.slice(0, 8).map(
              (shape, i) => (
                <ShapePreview key={i} shape={shape} color="var(--text-dim)" size={15} />
              ),
            )}
          </div>
        </Field>

        <Field label="Inside each note">
          <Segmented
            options={LABEL_OPTIONS}
            value={theme.encodings.label}
            onChange={(label) => patchEncodings({ label })}
          />
        </Field>

        <Toggle
          label="Ring notes outside the key"
          checked={theme.encodings.outlineChromatics}
          onChange={(outlineChromatics) => patchEncodings({ outlineChromatics })}
        />
        <Toggle
          label="Louder notes are larger"
          checked={theme.encodings.sizeByVelocity}
          onChange={(sizeByVelocity) => patchEncodings({ sizeByVelocity })}
        />
      </Section>

      <Section title="Layout">
        <Field label="Notation">
          <Segmented
            options={[
              { value: 'roll', label: 'Roll' },
              { value: 'staff', label: 'Staff' },
            ]}
            value={theme.layout.mode}
            onChange={(mode) =>
              patchLayout({
                mode,
                // A staff is diatonic by definition; a roll on a diatonic axis
                // would silently hide every accidental's height.
                pitchAxis: mode === 'staff' ? 'diatonic' : 'keyboard',
                showStaffLines: mode === 'staff',
                showLedgerLines: mode === 'staff',
                showKeyboard: mode === 'roll',
                showBlackKeyRows: mode === 'roll',
              })
            }
          />
        </Field>

        {theme.layout.mode === 'roll' && (
          <Field
            label="Pitch axis"
            hint={
              theme.layout.pitchAxis === 'keyboard'
                ? 'Spaced like real piano keys, so the picture matches where your hands go.'
                : 'Every semitone gets equal height. Evener, but no longer shaped like the instrument.'
            }
          >
            <Segmented
              options={[
                { value: 'keyboard', label: 'Keyboard' },
                { value: 'chromatic', label: 'Even' },
              ]}
              value={theme.layout.pitchAxis === 'diatonic' ? 'keyboard' : theme.layout.pitchAxis}
              onChange={(pitchAxis) => patchLayout({ pitchAxis })}
            />
          </Field>
        )}

        <Field label="Note height" value={`${theme.layout.laneHeight}px`}>
          <Slider
            min={7}
            max={26}
            value={theme.layout.laneHeight}
            onChange={(laneHeight) => patchLayout({ laneHeight })}
          />
        </Field>

        <Field label="Time spacing" value={`${theme.layout.beatWidth}px / beat`}>
          <Slider
            min={30}
            max={190}
            step={2}
            value={theme.layout.beatWidth}
            onChange={(beatWidth) => patchLayout({ beatWidth })}
          />
        </Field>

        <Field label="Space between lines" value={`${theme.layout.systemGap}px`}>
          <Slider
            min={16}
            max={110}
            value={theme.layout.systemGap}
            onChange={(systemGap) => patchLayout({ systemGap })}
          />
        </Field>

        <Toggle
          label="Beat gridlines"
          checked={theme.layout.showGrid}
          onChange={(showGrid) => patchLayout({ showGrid })}
        />
        <Toggle
          label="Barlines"
          checked={theme.layout.showBarlines}
          onChange={(showBarlines) => patchLayout({ showBarlines })}
        />
        <Toggle
          label="Bar numbers"
          checked={theme.layout.showMeasureNumbers}
          onChange={(showMeasureNumbers) => patchLayout({ showMeasureNumbers })}
        />
        {theme.layout.mode === 'roll' && (
          <>
            <Toggle
              label="Keyboard down the side"
              checked={theme.layout.showKeyboard}
              onChange={(showKeyboard) => patchLayout({ showKeyboard })}
            />
            <Toggle
              label="Shade the black-key rows"
              checked={theme.layout.showBlackKeyRows}
              onChange={(showBlackKeyRows) => patchLayout({ showBlackKeyRows })}
            />
          </>
        )}

        <Field label="Page">
          <Segmented
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'paper', label: 'Paper' },
            ]}
            value={theme.surface.background === '#0d0f14' ? 'dark' : 'paper'}
            onChange={setSurfaceMode}
          />
        </Field>
      </Section>

      <Section title="Check your colours">
        <Field
          label="Simulate colour vision"
          hint={CVD_MODES.find((m) => m.id === cvd)?.note}
        >
          <select value={cvd} onChange={(e) => setCvd(e.target.value as typeof cvd)}>
            {CVD_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
        </Field>
        {cvd !== 'none' && (
          <div className="field__hint">
            If two notes you need to tell apart now look the same, add a shape or a label rather
            than hunting for a different hue.
          </div>
        )}
      </Section>

      <Section title="Your overrides">
        {theme.rules.length === 0 ? (
          <div className="empty">
            Click any note in the score to change just that note — or every one like it.
          </div>
        ) : (
          <>
            {theme.rules.map((rule) => (
              <div className="rule" key={rule.id}>
                <span
                  className="rule__swatch"
                  style={{ background: rule.style.fill ?? 'transparent' }}
                />
                <span className="rule__label">{describeSelector(rule.selector)}</span>
                <span className="rule__detail">{summariseStyle(rule.style)}</span>
                <button
                  className="rule__remove"
                  onClick={() => removeRule(rule.id)}
                  title="Remove this override"
                >
                  ✕
                </button>
              </div>
            ))}
            <button className="btn" style={{ marginTop: 6 }} onClick={clearRules}>
              Clear all overrides
            </button>
          </>
        )}
      </Section>

      <Section title="Save this style">
        <Field label="Name">
          <input
            type="text"
            value={name}
            placeholder="e.g. My reading style"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                saveCurrentTheme(name.trim())
                setName('')
              }
            }}
          />
        </Field>
        <button
          className="btn btn--primary"
          disabled={!name.trim()}
          style={{ width: '100%', justifyContent: 'center', opacity: name.trim() ? 1 : 0.5 }}
          onClick={() => {
            if (!name.trim()) return
            saveCurrentTheme(name.trim())
            setName('')
          }}
        >
          Save
        </button>
      </Section>
    </aside>
  )
}

/** Pick a spread across the palette so two-colour sets still fill the strip. */
function sampleColors(colors: string[], ink: string): string[] {
  const resolved = colors.map((c) => (c === '@ink' ? ink : c))
  if (resolved.length <= 4) return resolved
  return [0, 2, 4, 7, 9, 11].map((i) => resolved[i % resolved.length])
}

function swatchTitle(domain: string, index: number): string {
  const pitches = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
  const degrees = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7']
  if (domain === 'pitchClass') return pitches[index] ?? ''
  if (domain === 'scaleDegree') return `Degree ${degrees[index] ?? ''}`
  if (domain === 'hand') return index === 0 ? 'Right hand' : 'Left hand'
  if (domain === 'octave') return `Octave ${index}`
  return ''
}

function summariseStyle(style: { fill?: string; shape?: string; label?: string }): string {
  const parts: string[] = []
  if (style.fill) parts.push('colour')
  if (style.shape) parts.push(style.shape)
  if (style.label) parts.push('label')
  return parts.join(' · ')
}

function describePreset(id: string): string {
  return PRESETS.find((p) => p.id === id)?.description ?? 'A style of your own.'
}
