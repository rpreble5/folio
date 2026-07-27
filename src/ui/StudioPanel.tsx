/**
 * The Style Studio panel.
 *
 * Three tabs, laid out as columns rather than a stack. The panel is wide and
 * short, which is the shape that rewards a few broad tabs: each group sits
 * beside the others with real space between, instead of piling up in a column
 * that has to scroll.
 *
 * The score above never moves while you work here, so every change lands in
 * your peripheral vision at the moment you make it.
 */

import { useState } from 'react'
import { useStore } from '../state/store'
import { PAGES, PRESETS, TRAIL_PRESETS } from '../core/presets'
import { NoteGlyph } from '../render/NoteGlyph'
import { cyclesAcross } from '../render/textures'
import {
  COLOR_SOURCES,
  HUE_ORDERS,
  SHAPE_SETS,
  TONES,
  ACCIDENTAL_SHADES,
  LIGHTNESS_SOURCES,
  buildPalette,
  hasHueShift,
  noteHue,
  slotCount,
  slotNames,
  type ColorConfig,
} from '../core/palettes'
import { HueWheel } from './HueWheel'
import {
  ANCHOR_OPTIONS,
  DASH_KINDS,
  NO_TEXTURE,
  OUTLINE_TARGETS,
  TEXTURE_KINDS,
  describeSelector,
  makeSurface,
  type LabelKind,
  type LineRole,
  type LineStyle,
  type OutlineWhat,
  type TextureConfig,
  type TrailConfig,
} from '../core/theme'
import { CVD_MODES, type CvdMode } from '../render/cvd'
import { Field, Group, Pills, ShapeMark, Slider, Switch, Tile } from './controls'

type Tab = 'styles' | 'colour' | 'marks' | 'page'

// Colour started inside Marks and outgrew it once order, tone and rotation
// became separate axes. Four tabs, each still one concern.
const TABS: { id: Tab; label: string }[] = [
  { id: 'styles', label: 'Styles' },
  { id: 'colour', label: 'Colour' },
  { id: 'marks', label: 'Marks' },
  { id: 'page', label: 'Page' },
]

const LABEL_OPTIONS: { value: LabelKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'letter', label: 'A B C' },
  { value: 'solfege', label: 'Do Re' },
  { value: 'degree', label: '1 2 3' },
  { value: 'finger', label: 'Finger' },
]

export function StudioPanel() {
  const tab = useStore((s) => s.studioTab)
  const setTab = useStore((s) => s.setStudioTab)
  const dirty = useStore((s) => s.dirty)
  const ruleCount = useStore((s) => s.theme.rules.length)

  return (
    <section className="panel" aria-label="Style studio">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div className="tabs__spacer" />
        {(dirty || ruleCount > 0) && (
          <span className="field__value">
            {ruleCount > 0
              ? `${ruleCount} override${ruleCount === 1 ? '' : 's'}`
              : 'Modified'}
          </span>
        )}
      </div>

      {/* Keyed so switching tabs replays the entrance transition. */}
      <div className="panel__body" role="tabpanel" key={tab}>
        {tab === 'styles' && <StylesTab />}
        {tab === 'colour' && <ColourTab />}
        {tab === 'marks' && <MarksTab />}
        {tab === 'page' && <PageTab />}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

function StylesTab() {
  const theme = useStore((s) => s.theme)
  const basePresetId = useStore((s) => s.basePresetId)
  const customThemes = useStore((s) => s.customThemes)
  const cvd = useStore((s) => s.cvd)
  const applyPreset = useStore((s) => s.applyPreset)
  const applyTheme = useStore((s) => s.applyTheme)
  const deleteCustomTheme = useStore((s) => s.deleteCustomTheme)
  const saveCurrentTheme = useStore((s) => s.saveCurrentTheme)
  const removeRule = useStore((s) => s.removeRule)
  const clearRules = useStore((s) => s.clearRules)
  const setCvd = useStore((s) => s.setCvd)
  const [name, setName] = useState('')

  const save = () => {
    if (!name.trim()) return
    saveCurrentTheme(name.trim())
    setName('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <Group label="Start from">
        <div className="tiles">
          {PRESETS.map((preset) => {
            const palette = buildPalette(preset.encodings.color)
            return (
              <Tile
                key={preset.id}
                className="preset-tile"
                selected={basePresetId === preset.id}
                onClick={() => applyPreset(preset.id)}
                title={preset.description}
              >
                <Strip colors={palette.colors} surface={preset.surface} />
                <div className="tile__name">{preset.name}</div>
                {preset.accessible && <div className="tile__badge">{preset.accessible}</div>}
              </Tile>
            )
          })}
        </div>
      </Group>

      <div className="columns columns--3">
        <Group label="Check your colours">
          <Pills
            options={CVD_MODES.map((m) => ({ value: m.id, label: m.label }))}
            value={cvd}
            onChange={(mode) => setCvd(mode as CvdMode)}
          />
          <p className="note-text">
            {cvd === 'none'
              ? 'Simulate colour vision deficiency to see whether your palette still reads. Around one man in twelve has some form of it.'
              : 'If two notes you need to tell apart now look alike, add a shape or a label rather than hunting for another hue.'}
          </p>
        </Group>

        <Group label="Your overrides">
          {theme.rules.length === 0 ? (
            <p className="empty">
              Click any note in the score to change just that note — or every one like it.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {theme.rules.slice(0, 4).map((rule) => (
                <div key={rule.id} className="switch-row" style={{ cursor: 'default' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    {rule.style.fill && (
                      <i
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 4,
                          background: rule.style.fill,
                          display: 'block',
                        }}
                      />
                    )}
                    {describeSelector(rule.selector)}
                  </span>
                  <button
                    className="icon-btn"
                    onClick={() => removeRule(rule.id)}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {theme.rules.length > 4 && (
                <span className="field__value">+{theme.rules.length - 4} more</span>
              )}
              <button className="pill pill--solid" onClick={clearRules}>
                Clear all
              </button>
            </div>
          )}
        </Group>

        <Group label="Your styles">
          {customThemes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {customThemes.map((custom) => (
                <div key={custom.id} className="switch-row" style={{ cursor: 'default' }}>
                  <button
                    onClick={() => applyTheme(custom)}
                    style={{ flex: 1, textAlign: 'left', color: 'inherit' }}
                  >
                    {custom.name}
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => deleteCustomTheme(custom.id)}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <Field>
            <input
              className="text-input"
              type="text"
              value={name}
              placeholder="Name this style"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </Field>
          <button className="pill pill--solid" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </Group>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ColourTab() {
  const theme = useStore((s) => s.theme)
  const patchEncodings = useStore((s) => s.patchEncodings)
  const color = theme.encodings.color
  const palette = buildPalette(color)
  const source = COLOR_SOURCES.find((s) => s.id === color.source)
  const patchColor = (patch: Partial<ColorConfig>) =>
    patchEncodings({ color: { ...color, ...patch } })

  const names = slotNames(color.basis)
  const tunable = source?.tunable ?? false

  // Letter basis puts sharps on their natural's hue, which is the opposite of
  // what the Keys order does, so that pairing is withheld rather than offered
  // and then quietly ignored.
  const orders = HUE_ORDERS.filter((o) => color.basis !== 'letter' || o.id !== 'keys')

  const setShift = (slot: number, degrees: number) => {
    const next = Array.from({ length: slotCount(color.basis) }, (_, i) =>
      i === slot ? degrees : color.hueShift?.[i] ?? 0,
    )
    patchColor({ hueShift: next })
  }

  return (
    <div className="colour-lab">
      <Group label="Colour by">
          <div className="tiles">
            {COLOR_SOURCES.map((s) => (
              <Tile
                key={s.id}
                className="palette-tile"
                selected={color.source === s.id}
                onClick={() => patchColor({ source: s.id })}
                title={s.note}
              >
                {/* Each thumbnail previews that source under the current order
                    and tone, so switching source is not a jump. */}
                <Strip
                  colors={buildPalette({ ...color, source: s.id }).colors}
                  surface={theme.surface}
                />
                <div className="tile__name">{s.name}</div>
            </Tile>
          ))}
        </div>
      </Group>

      {tunable && (
        <Group label="Scheme">
              <Field name="A colour for every">
                <Pills
                  options={[
                    { value: 'pitchClass', label: 'Semitone' },
                    { value: 'letter', label: 'Letter name' },
                  ]}
                  value={color.basis}
                  onChange={(basis) =>
                    // Shift counts differ between bases, so old nudges would
                    // land on the wrong notes. Cleared rather than reinterpreted.
                    patchColor({
                      basis,
                      hueShift: undefined,
                      order: basis === 'letter' && color.order === 'keys' ? 'fifths' : color.order,
                    })
                  }
                />
              </Field>

              {color.basis === 'letter' && (
                <Field name="Sharps & flats">
                  <Pills
                    options={ACCIDENTAL_SHADES.map((a) => ({ value: a.id, label: a.label }))}
                    value={color.accidentalShade}
                    onChange={(accidentalShade) => patchColor({ accidentalShade })}
                  />
                </Field>
              )}

              <Field name="Order">
                <Pills
                  options={orders.map((o) => ({ value: o.id, label: o.name }))}
                  value={color.order}
                  onChange={(order) => patchColor({ order })}
                />
              </Field>

              <Field name="Tone">
                <Pills
                  options={TONES.map((t) => ({ value: t.id, label: t.name }))}
                  value={color.tone}
                  onChange={(tone) => patchColor({ tone })}
                />
              </Field>

        {/* Hue and brightness are not read the same way: colours differing in
            hue but not brightness resolve slowly, because the fast achromatic
            part of vision cannot see the difference. A palette with perfectly
            even lightness looks immaculate and gives that channel nothing. */}
        <Field name="Brightness follows">
          <Pills
            options={LIGHTNESS_SOURCES.map((l) => ({ value: l.id, label: l.label }))}
            value={color.lightnessBy}
            onChange={(lightnessBy) => patchColor({ lightnessBy })}
          />
        </Field>

        {color.lightnessBy !== 'none' && (
          <Field
            name="Brightness spread"
            value={`${Math.round(color.lightnessSpread * 100)}%`}
          >
            <Slider
              label="Brightness spread"
              min={0.04}
              max={0.34}
              step={0.02}
              value={color.lightnessSpread}
              onChange={(lightnessSpread) => patchColor({ lightnessSpread })}
            />
          </Field>
        )}

        <Field name="Rotate all" value={`${color.rotate}°`}>
            <Slider
              label="Rotate hue"
              min={0}
              max={345}
              step={15}
              value={color.rotate}
              onChange={(rotate) => patchColor({ rotate })}
            />
          </Field>
        </Group>
      )}

      {tunable ? (
        <>
          <div className="colour-lab__wheel">
            <HueWheel
              config={color}
              colors={palette.colors}
              names={names}
              surface={theme.surface}
              onShift={setShift}
              onRotate={(rotate) => patchColor({ rotate })}
            />
          </div>

          <div className="colour-lab__list">
            <div className="group__label">
              {color.basis === 'letter' ? 'Seven letters' : 'Twelve semitones'}
            </div>
            <div className="note-rows">
              {names.map((name, slot) => {
                const shift = Math.round(color.hueShift?.[slot] ?? 0)
                return (
                  <div className="note-row" key={name}>
                    <i style={{ background: palette.colors[slot] }} />
                    {color.basis === 'letter' && palette.altColors && (
                      <i
                        className="note-row__alt"
                        style={{ background: palette.altColors[slot] }}
                        title={`${name}♯ / ${name}♭`}
                      />
                    )}
                    <span className="note-row__name">{name}</span>
                    <span className="note-row__hue">{Math.round(noteHue(color, slot))}°</span>
                    <button
                      className="note-row__reset"
                      disabled={shift === 0}
                      title={shift === 0 ? 'Not moved' : `Moved ${shift > 0 ? '+' : ''}${shift}°`}
                      onClick={() => setShift(slot, 0)}
                    >
                      {shift === 0 ? '·' : `${shift > 0 ? '+' : ''}${shift}°`}
                    </button>
                  </div>
                )
              })}
            </div>
            {hasHueShift(color) && (
              <button
                className="pill pill--solid"
                onClick={() => patchColor({ hueShift: undefined })}
              >
                Reset all {countShifted(color)}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="colour-lab__wheel">
          <Strip colors={palette.colors} surface={theme.surface} tall />
          <p className="note-text" style={{ marginTop: 16 }}>
            {source?.note} Order, tone and the wheel apply to pitch colours only.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function MarksTab() {
  const theme = useStore((s) => s.theme)
  const layout = useStore((s) => s.theme.layout)
  const patchEncodings = useStore((s) => s.patchEncodings)
  const { shapeSet: shapeSetId, trail, texture } = theme.encodings
  const shapeSet = SHAPE_SETS.find((s) => s.id === shapeSetId)

  const patchTrail = (patch: Partial<TrailConfig>) =>
    patchEncodings({ trail: { ...trail, ...patch } })
  const patchTexture = (patch: Partial<TextureConfig>) =>
    patchEncodings({ texture: { ...texture, ...patch } })

  // Texture stops reading as texture below roughly three cycles across a mark.
  // Worth saying out loud rather than letting it be discovered as "looks bad".
  const noteHeight = layout.laneHeight * (layout.mode === 'staff' ? 1.85 : 0.86)
  const cycles = cyclesAcross(texture, noteHeight)
  const tooFine = texture.kind !== 'none' && cycles < 2.2

  return (
    <div className="columns columns--4">
      <Group label="Shape">
        <div className="tiles">
          {SHAPE_SETS.map((set) => (
            <Tile
              key={set.id}
              selected={shapeSetId === set.id}
              onClick={() => patchEncodings({ shapeSet: set.id })}
              title={set.note}
            >
              <div className="tile__shapes">
                {set.shapes.slice(0, 4).map((shape, i) => (
                  <ShapeMark key={i} shape={shape} size={14} />
                ))}
              </div>
              <div className="tile__name">{set.name}</div>
            </Tile>
          ))}
        </div>
        <p className="note-text">{shapeSet?.note}</p>
      </Group>

      {/* The trail carries duration. Head and trail are drawn as overlapping
          shapes in one colour, so the melt works for any head — there is no
          joint to compute, only a union. */}
      <Group label="Trail">
        <div className="tiles">
          {TRAIL_PRESETS.map((t) => (
            <Tile
              key={t.id}
              selected={sameTrail(trail, t.trail)}
              onClick={() => patchTrail(t.trail)}
              title={t.name}
            >
              <TrailMark trail={t.trail} />
              <div className="tile__name">{t.name}</div>
            </Tile>
          ))}
        </div>

        <div className="slider-pair">
        <Field name="Thickness" value={`${Math.round(trail.thickness * 100)}%`}>
          <Slider
            label="Trail thickness"
            min={0}
            max={1}
            step={0.02}
            value={trail.thickness}
            onChange={(thickness) => patchTrail({ thickness })}
          />
        </Field>
        <Field name="Taper" value={`${Math.round(trail.taper * 100)}%`}>
          <Slider
            label="Trail taper"
            min={0}
            max={1}
            step={0.02}
            value={trail.taper}
            onChange={(taper) => patchTrail({ taper })}
          />
        </Field>
        <Field name="Melt into note" value={`${Math.round(trail.melt * 100)}%`}>
          <Slider
            label="Trail melt"
            min={0}
            max={1}
            step={0.02}
            value={trail.melt}
            onChange={(melt) => patchTrail({ melt })}
          />
        </Field>
        <Field name="Strength" value={`${Math.round(trail.opacity * 100)}%`}>
          <Slider
            label="Trail strength"
            min={0}
            max={1}
            step={0.05}
            value={trail.opacity}
            onChange={(opacity) => patchTrail({ opacity })}
          />
        </Field>
        </div>
      </Group>

      <Group label="Fill & texture">
        <Field name="Draw hollow">
          <Pills
            options={OUTLINE_TARGETS.map((t) => ({ value: t.id, label: t.label }))}
            value={theme.encodings.outlineWhat}
            onChange={(outlineWhat: OutlineWhat) => patchEncodings({ outlineWhat })}
          />
        </Field>
        {theme.encodings.outlineWhat !== 'none' && (
          <Field name="Hollow style">
            <Pills
              options={[
                { value: 'hollow', label: 'Outline' },
                { value: 'tinted', label: 'Tinted' },
              ]}
              value={theme.encodings.outlineStyle}
              onChange={(outlineStyle) => patchEncodings({ outlineStyle })}
            />
          </Field>
        )}

        <Field name="Texture">
          <Pills
            options={TEXTURE_KINDS.map((t) => ({ value: t.id, label: t.label }))}
            value={texture.kind}
            onChange={(kind) => patchTexture({ kind })}
          />
        </Field>

        {texture.kind !== 'none' && (
          <>
            <Field name="Scale" value={`${texture.scale.toFixed(2)}×`}>
              <Slider
                label="Texture scale"
                min={0.2}
                max={2.5}
                step={0.05}
                value={texture.scale}
                onChange={(scale) => patchTexture({ scale })}
              />
            </Field>
            <Field name="Strength" value={`${Math.round(texture.strength * 100)}%`}>
              <Slider
                label="Texture strength"
                min={0.05}
                max={0.8}
                step={0.05}
                value={texture.strength}
                onChange={(strength) => patchTexture({ strength })}
              />
            </Field>
            <Field name="Ink">
              <Pills
                options={[
                  { value: 'dark', label: 'Darken' },
                  { value: 'light', label: 'Lighten' },
                ]}
                value={texture.ink}
                onChange={(ink) => patchTexture({ ink })}
              />
            </Field>
            <Switch
              label="Grain builds along the trail"
              checked={theme.encodings.trailGrain}
              onChange={(trailGrain) => patchEncodings({ trailGrain })}
            />
            {tooFine && (
              <p className="note-text warn">
                At this note height the texture fits about {cycles.toFixed(1)} tiles across, so
                it will read as noise rather than as texture. Make the notes taller or the
                scale smaller.
              </p>
            )}
          </>
        )}
      </Group>

      <Group label="Text">
        <Field name="Inside each note">
          <Pills
            options={LABEL_OPTIONS}
            value={theme.encodings.label}
            onChange={(label) => patchEncodings({ label })}
          />
        </Field>
        <Field name="Size" value={`${Math.round(theme.encodings.labelScale * 100)}%`}>
          <Slider
            label="Label size"
            min={0.7}
            max={1.4}
            step={0.05}
            value={theme.encodings.labelScale}
            onChange={(labelScale) => patchEncodings({ labelScale })}
          />
        </Field>
        <Switch
          label="Louder notes are larger"
          checked={theme.encodings.sizeByVelocity}
          onChange={(sizeByVelocity) => patchEncodings({ sizeByVelocity })}
        />
      </Group>
    </div>
  )
}

const sameTrail = (a: TrailConfig, b: TrailConfig): boolean =>
  Math.abs(a.thickness - b.thickness) < 0.02 &&
  Math.abs(a.taper - b.taper) < 0.02 &&
  Math.abs(a.melt - b.melt) < 0.02 &&
  Math.abs(a.opacity - b.opacity) < 0.03

/** A miniature note-and-trail, so a trail preset previews its own silhouette. */
function TrailMark({ trail }: { trail: TrailConfig }) {
  const w = 54
  const h = 16
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <NoteGlyph
        x={1}
        y={1}
        width={w - 2}
        height={h - 2}
        shape="circle"
        fill="currentColor"
        stroke="none"
        strokeWidth={0}
        opacity={1}
        cornerRadius={3}
        active={false}
        selected={false}
        accent="none"
        filled
        hollowTint={0}
        trail={trail}
        texture={NO_TEXTURE}
        trailGrain={false}
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------

function PageTab() {
  const theme = useStore((s) => s.theme)
  const patchLayout = useStore((s) => s.patchLayout)
  const setPage = useStore((s) => s.setPage)
  const { layout } = theme
  const isRoll = layout.mode === 'roll'

  const patchLine = (role: LineRole, patch: Partial<LineStyle>) =>
    patchLayout({ lines: { ...layout.lines, [role]: { ...layout.lines[role], ...patch } } })

  // Only the lines this notation actually draws, so the editor never offers a
  // control with nothing behind it.
  const roles: { role: LineRole; label: string }[] = isRoll
    ? [
        { role: 'beat', label: 'Beat lines' },
        { role: 'bar', label: 'Barlines' },
        { role: 'anchor', label: 'Anchor lines' },
      ]
    : [
        { role: 'staff', label: 'Staff lines' },
        { role: 'bar', label: 'Barlines' },
        { role: 'ledger', label: 'Ledger lines' },
      ]

  return (
    <div className="columns columns--3">
      <Group label="Form">
        <Field name="Notation">
          <Pills
            fill
            options={[
              { value: 'roll', label: 'Roll' },
              { value: 'staff', label: 'Staff' },
            ]}
            value={layout.mode}
            onChange={(mode) =>
              patchLayout({
                // A staff is diatonic by definition, and a roll on a diatonic
                // axis would hide every accidental's height.
                mode,
                pitchAxis: mode === 'staff' ? 'diatonic' : 'keyboard',
                showKeyboard: mode === 'roll',
                showBlackKeyRows: mode === 'roll',
                lines:
                  mode === 'staff'
                    ? { ...layout.lines, staff: { ...layout.lines.staff, show: true },
                        ledger: { ...layout.lines.ledger, show: true },
                        beat: { ...layout.lines.beat, show: false } }
                    : { ...layout.lines, staff: { ...layout.lines.staff, show: false },
                        ledger: { ...layout.lines.ledger, show: false },
                        beat: { ...layout.lines.beat, show: true } },
              })
            }
          />
        </Field>

        {isRoll && (
          <Field name="Pitch axis">
            <Pills
              fill
              options={[
                { value: 'keyboard', label: 'Keyboard' },
                { value: 'chromatic', label: 'Even' },
              ]}
              value={layout.pitchAxis === 'diatonic' ? 'keyboard' : layout.pitchAxis}
              onChange={(pitchAxis) => patchLayout({ pitchAxis })}
            />
          </Field>
        )}

        <Field name="Note height" value={`${layout.laneHeight}`}>
          <Slider
            label="Note height"
            min={7}
            max={26}
            value={layout.laneHeight}
            onChange={(laneHeight) => patchLayout({ laneHeight })}
          />
        </Field>
        <Field
          name="Bars per line"
          value={layout.barsPerSystem > 0 ? `${layout.barsPerSystem}` : 'Auto'}
        >
          <Slider
            label="Bars per line"
            min={0}
            max={12}
            value={layout.barsPerSystem}
            onChange={(barsPerSystem) => patchLayout({ barsPerSystem })}
          />
        </Field>
        <Field name="Between lines" value={`${layout.systemGap}`}>
          <Slider
            label="Space between lines"
            min={16}
            max={110}
            value={layout.systemGap}
            onChange={(systemGap) => patchLayout({ systemGap })}
          />
        </Field>
      </Group>

      <Group label="Lines">
        {isRoll && (
          <Field name="Anchor on">
            {/* Judging a mark against a line is far more precise than judging it
                in empty space, so a roll with no horizontal reference makes
                pitch needlessly hard to read. */}
            <Pills
              options={ANCHOR_OPTIONS.map((a) => ({ value: a.id, label: a.label }))}
              value={layout.anchorOn}
              onChange={(anchorOn) => patchLayout({ anchorOn })}
            />
          </Field>
        )}

        {roles.map(({ role, label }) => {
          const style = layout.lines[role]
          return (
            <div className="line-editor" key={role}>
              <Switch
                label={label}
                checked={style.show}
                onChange={(show) => patchLine(role, { show })}
              />
              {style.show && (
                <div className="line-editor__body">
                  <Pills
                    options={DASH_KINDS.map((d) => ({ value: d.id, label: d.label }))}
                    value={style.dash}
                    onChange={(dash) => patchLine(role, { dash })}
                  />
                  <div className="line-editor__sliders">
                    <Field name="Weight" value={style.width.toFixed(1)}>
                      <Slider
                        label={`${label} weight`}
                        min={0.5}
                        max={5}
                        step={0.25}
                        value={style.width}
                        onChange={(width) => patchLine(role, { width })}
                      />
                    </Field>
                    <Field name="Strength" value={`${Math.round(style.opacity * 100)}%`}>
                      <Slider
                        label={`${label} strength`}
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={style.opacity}
                        onChange={(opacity) => patchLine(role, { opacity })}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </Group>

      <Group label="Page">
        <div className="tiles">
          {PAGES.map((page) => (
            <Tile
              key={page.id}
              className="page-tile"
              selected={theme.surface.background.toLowerCase() === page.color.toLowerCase()}
              onClick={() => setPage(page.color)}
              title={page.name}
            >
              {/* The rest of the surface is derived from the page colour, so the
                  swatch previews its own grid and text too. */}
              <span className="page-tile__swatch" style={{ background: page.color }}>
                <i style={{ background: makeSurface(page.color).gridStrong }} />
                <i style={{ background: makeSurface(page.color).text }} />
              </span>
              <span className="tile__name">{page.name}</span>
            </Tile>
          ))}
        </div>

        {/* Page grain wants a coarser scale than the notes, or the two compete
            for the same channel and the page wins by sheer area. */}
        <Field name="Page texture">
          <Pills
            options={TEXTURE_KINDS.map((t) => ({ value: t.id, label: t.label }))}
            value={layout.pageTexture.kind}
            onChange={(kind) =>
              patchLayout({ pageTexture: { ...layout.pageTexture, kind } })
            }
          />
        </Field>
        {layout.pageTexture.kind !== 'none' && (
          <Field
            name="Grain strength"
            value={`${Math.round(layout.pageTexture.strength * 100)}%`}
          >
            <Slider
              label="Page texture strength"
              min={0.02}
              max={0.3}
              step={0.02}
              value={layout.pageTexture.strength}
              onChange={(strength) =>
                patchLayout({ pageTexture: { ...layout.pageTexture, strength } })
              }
            />
          </Field>
        )}

        <Switch
          label="Bar numbers"
          checked={layout.showMeasureNumbers}
          onChange={(showMeasureNumbers) => patchLayout({ showMeasureNumbers })}
        />
        {isRoll && (
          <>
            <Switch
              label="Keyboard down the side"
              checked={layout.showKeyboard}
              onChange={(showKeyboard) => patchLayout({ showKeyboard })}
            />
            <Switch
              label="Shade black-key rows"
              checked={layout.showBlackKeyRows}
              onChange={(showBlackKeyRows) => patchLayout({ showBlackKeyRows })}
            />
          </>
        )}
      </Group>
    </div>
  )
}

const countShifted = (color: ColorConfig): number =>
  (color.hueShift ?? []).filter((d) => Math.round(d) !== 0).length

/** Every colour in the palette, in order, on the score's own page colour. */
function Strip({
  colors,
  surface,
  tall = false,
}: {
  colors: string[]
  surface: { background: string; text: string }
  tall?: boolean
}) {
  return (
    <div
      className={`tile__swatches tile__swatches--strip${tall ? ' tile__swatches--tall' : ''}`}
      style={{ background: surface.background }}
    >
      {colors.map((color, i) => (
        <i key={i} style={{ background: color === '@ink' ? surface.text : color }} />
      ))}
    </div>
  )
}
