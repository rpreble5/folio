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

import { useMemo, useState } from 'react'
import { useStore, type StudioTab } from '../state/store'
import { PAGES, PRESETS, TRAIL_PRESETS } from '../core/presets'
import { NoteGlyph } from '../render/NoteGlyph'
import { cyclesAcross } from '../render/textures'
import {
  COLOR_SOURCES,
  HUE_ORDERS,
  SHAPE_SETS,
  TONES,
  ACCIDENTAL_SHADES,
  CHROMA_SOURCES,
  LIGHTNESS_SOURCES,
  buildPalette,
  hasHueShift,
  noteHue,
  slotCount,
  slotNames,
  type Achromatic,
  type ColorConfig,
} from '../core/palettes'
import { HueWheel } from './HueWheel'
import {
  StaffItemEditor,
  StaffPicker,
  lineSwatches,
  selectionName,
  type Selection,
} from './StaffEditor'
import {
  ANCHOR_OPTIONS,
  DASH_KINDS,
  LABEL_FONTS,
  LABEL_INKS,
  LABEL_TARGETS,
  NO_TEXTURE,
  OUTLINE_TARGETS,
  TEXTURE_KINDS,
  contrastRatio,
  describeSelector,
  makeSurface,
  worstLabelContrast,
  type LabelInk,
  type LabelKind,
  type LabelOn,
  type LineRole,
  type LineStyle,
  type OutlineWhat,
  type TextureConfig,
  type TrailConfig,
} from '../core/theme'
import { keyAt } from '../core/types'
import { CVD_MODES, type CvdMode } from '../render/cvd'
import { Field, Group, Pills, Range, ShapeMark, Swatches, Switch, Tile } from './controls'

type Tab = StudioTab

/**
 * Seven tabs, which is more than the three this started with and deliberately so.
 *
 * The panel is a fixed strip under the score — wide and only a few hundred
 * pixels tall — so a tab that outgrows it does not get taller, it gets a
 * scrollbar, and a control that has to be scrolled to is a control nobody
 * finds. Labels alone had grown to three times the panel's height. Splitting
 * costs a click; scrolling costs the discovery.
 *
 * The split is by *question*, not by object: Emphasis is everything that
 * decides which notes come forward and which recede, whichever visual property
 * does it.
 */
const TABS: { id: Tab; label: string }[] = [
  { id: 'styles', label: 'Styles' },
  { id: 'colour', label: 'Colour' },
  { id: 'emphasis', label: 'Emphasis' },
  { id: 'marks', label: 'Marks' },
  { id: 'labels', label: 'Labels' },
  { id: 'staff', label: 'Staff' },
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
        {tab === 'emphasis' && <EmphasisTab />}
        {tab === 'marks' && <MarksTab />}
        {tab === 'labels' && <LabelsTab />}
        {tab === 'staff' && <StaffTab />}
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
    <div className="columns columns--styles">
      {/* Four columns rather a preset row above a group row: stacking made
          Styles the one tab whose height was the sum of two things instead of
          the tallest of several, which is what pushed it past the panel. */}
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

  // Cycled from the swatch rather than picked from a menu. Twelve slots times
  // three states is thirty-six controls laid out as a list, and one click on
  // the colour you are looking at is both smaller and more direct.
  const NEXT_ANCHOR: Record<Achromatic, Achromatic> = {
    none: 'light',
    light: 'dark',
    dark: 'none',
  }
  const cycleAnchor = (slot: number) => {
    const next = Array.from({ length: slotCount(color.basis) }, (_, i) =>
      i === slot ? NEXT_ANCHOR[color.achromatic?.[i] ?? 'none'] : color.achromatic?.[i] ?? 'none',
    )
    patchColor({ achromatic: next.every((a) => a === 'none') ? undefined : next })
  }
  const anchorCount = (color.achromatic ?? []).filter((a) => a !== 'none').length
  // An anchor is only an anchor if it can be seen. Black on a dark page is the
  // obvious trap, and it is invisible in the score while looking fine in this
  // list, where the panel is a different colour from the page.
  const lostAnchors = names
    .map((name, i) => ({ name, kind: color.achromatic?.[i] ?? 'none' }))
    .filter(
      (a) =>
        a.kind !== 'none' &&
        contrastRatio(palette.colors[names.indexOf(a.name)], theme.surface.background) < 1.6,
    )

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

        {/* Two things that apply to the whole palette at once, so they read as
            a pair. Saturation is the chroma axis pulled back out of `tone`,
            which bundles it with lightness into six named points — wanting
            Bright-but-calmer should not mean hunting for a nearby preset. */}
        <div className="slider-pair">
          <Range
        name="Saturation"
        display={`${Math.round(color.saturation * 100)}%`}
        min={0}
        max={1.8}
        step={0.05}
        value={color.saturation}
        onChange={(saturation) => patchColor({ saturation })}
      />
          <Range
        name="Rotate all"
        display={`${color.rotate}°`}
        min={0}
        max={345}
        step={15}
        value={color.rotate}
        onChange={(rotate) => patchColor({ rotate })}
      />
        </div>
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
                const anchor = color.achromatic?.[slot] ?? 'none'
                return (
                  <div className="note-row" key={name}>
                    <button
                      className="note-row__swatch"
                      style={{ background: palette.colors[slot] }}
                      title={
                        anchor === 'none'
                          ? `${name} takes a hue — click for white`
                          : anchor === 'light'
                            ? `${name} is white — click for black`
                            : `${name} is black — click to give it a hue back`
                      }
                      onClick={() => cycleAnchor(slot)}
                    />
                    {color.basis === 'letter' && palette.altColors && (
                      <i
                        className="note-row__alt"
                        style={{ background: palette.altColors[slot] }}
                        title={`${name}♯ / ${name}♭`}
                      />
                    )}
                    <span className="note-row__name">{name}</span>
                    <span className="note-row__hue">
                      {anchor === 'none' ? `${Math.round(noteHue(color, slot))}°` : anchor === 'light' ? 'white' : 'black'}
                    </span>
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
            {/* Twelve hues is more than anyone reliably tells apart at a
                glance, and an achromatic note is the one mark that survives
                every kind of colour blindness intact. Click a swatch to make
                that pitch white or black — it leaves the hue problem entirely
                and becomes a landmark in the middle of the colour. */}
            <p className={`note-text${lostAnchors.length ? ' warn' : ''}`}>
              {lostAnchors.length
                ? `${lostAnchors.map((a) => a.name).join(', ')} ${lostAnchors.length === 1 ? 'is' : 'are'} nearly the page's own colour — click again for the other one.`
                : anchorCount === 0
                  ? 'Click a swatch to drop that note out of colour — white, then black.'
                  : `${anchorCount} anchored. An achromatic note is the one mark that survives every kind of colour blindness.`}
            </p>
            {(hasHueShift(color) || anchorCount > 0) && (
              <button
                className="pill pill--solid"
                onClick={() => patchColor({ hueShift: undefined, achromatic: undefined })}
              >
                Reset {countShifted(color) + anchorCount} change
                {countShifted(color) + anchorCount === 1 ? '' : 's'}
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
    <div className="columns columns--3">
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
        <Range
        name="Thickness"
        display={`${Math.round(trail.thickness * 100)}%`}
        min={0}
        max={1}
        step={0.02}
        value={trail.thickness}
        onChange={(thickness) => patchTrail({ thickness })}
      />
        <Range
        name="Taper"
        display={`${Math.round(trail.taper * 100)}%`}
        min={0}
        max={1}
        step={0.02}
        value={trail.taper}
        onChange={(taper) => patchTrail({ taper })}
      />
        <Range
        name="Melt into note"
        display={`${Math.round(trail.melt * 100)}%`}
        min={0}
        max={1}
        step={0.02}
        value={trail.melt}
        onChange={(melt) => patchTrail({ melt })}
      />
        <Range
        name="Strength"
        display={`${Math.round(trail.opacity * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        value={trail.opacity}
        onChange={(opacity) => patchTrail({ opacity })}
      />
        </div>
      </Group>

      <Group label="Texture">
        <Field>
          <Pills
            options={TEXTURE_KINDS.map((t) => ({ value: t.id, label: t.label }))}
            value={texture.kind}
            onChange={(kind) => patchTexture({ kind })}
          />
        </Field>

        {texture.kind !== 'none' && (
          <>
            <Range
        name="Scale"
        display={`${texture.scale.toFixed(2)}×`}
        min={0.2}
        max={2.5}
        step={0.05}
        value={texture.scale}
        onChange={(scale) => patchTexture({ scale })}
      />
            <Range
        name="Strength"
        display={`${Math.round(texture.strength * 100)}%`}
        min={0.05}
        max={0.8}
        step={0.05}
        value={texture.strength}
        onChange={(strength) => patchTexture({ strength })}
      />
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

    </div>
  )
}


const sameTrail = (a: TrailConfig, b: TrailConfig): boolean =>
  Math.abs(a.thickness - b.thickness) < 0.02 &&
  Math.abs(a.taper - b.taper) < 0.02 &&
  Math.abs(a.melt - b.melt) < 0.02 &&
  Math.abs(a.opacity - b.opacity) < 0.03

/**
 * The colour that scored worst, shown beside its number.
 *
 * A bare ratio says something is wrong without saying where to look. The swatch
 * points at the note colour to blame, which is usually the one nobody thought
 * to check.
 */
function ContrastDot({ fill }: { fill: string }) {
  return (
    <i
      aria-hidden="true"
      style={{
        width: 9,
        height: 9,
        borderRadius: 3,
        background: fill,
        display: 'inline-block',
        marginRight: 6,
        verticalAlign: 'baseline',
      }}
    />
  )
}

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

/**
 * Everything that decides which notes come forward and which sit back.
 *
 * Grouped by the question rather than by the property, so brightness, chroma,
 * hollowness and size sit together even though they are four unrelated bits of
 * drawing code. Somebody wanting the left hand to recede does not know or care
 * which of them will do it, and having them side by side is what makes the
 * choice between them visible.
 */
function EmphasisTab() {
  const theme = useStore((s) => s.theme)
  const patchEncodings = useStore((s) => s.patchEncodings)
  const color = theme.encodings.color
  const patchColor = (patch: Partial<ColorConfig>) =>
    patchEncodings({ color: { ...color, ...patch } })

  const lightSource = LIGHTNESS_SOURCES.find((l) => l.id === color.lightnessBy)
  const chromaSource = CHROMA_SOURCES.find((c) => c.id === color.chromaBy)

  return (
    <div className="columns columns--3">
      {/* Hue and brightness are not read the same way: colours differing in hue
          but not brightness resolve slowly, because the fast achromatic part of
          vision cannot see the difference. A palette with perfectly even
          lightness looks immaculate and gives that channel nothing. */}
      <Group label="Brightness">
        <Field name="Follows">
          <Pills
            options={LIGHTNESS_SOURCES.map((l) => ({ value: l.id, label: l.label }))}
            value={color.lightnessBy}
            onChange={(lightnessBy) => patchColor({ lightnessBy })}
          />
        </Field>
        {color.lightnessBy !== 'none' && (
          <Range
        name="Spread"
        display={`${Math.round(color.lightnessSpread * 100)}%`}
        min={0.04}
        max={0.34}
        step={0.02}
        value={color.lightnessSpread}
        onChange={(lightnessSpread) => patchColor({ lightnessSpread })}
      />
        )}
        <p className="note-text">{lightSource?.note}</p>
      </Group>

      {/* Saturation is the weakest of the three colour channels — chroma
          differences resolve slowly and disappear under colour vision
          deficiency — so it is offered as figure and ground rather than as a
          way to tell notes apart. Greying what is outside the key leaves every
          note its own hue and simply moves it behind the rest. */}
      <Group label="Saturation">
        <Field name="Follows">
          <Pills
            options={CHROMA_SOURCES.map((c) => ({ value: c.id, label: c.label }))}
            value={color.chromaBy}
            onChange={(chromaBy) => patchColor({ chromaBy })}
          />
        </Field>
        {/* Labelled by how far it drops, not by what is left, so dragging right
            and the number going up agree with each other. */}
        {color.chromaBy !== 'none' && (
          <Range
        name="Drop by"
        display={`${Math.round(color.chromaSpread * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        value={color.chromaSpread}
        onChange={(chromaSpread) => patchColor({ chromaSpread })}
      />
        )}
        <p className="note-text">
          {chromaSource?.note}
          {color.chromaBy !== 'none' &&
            ' Reinforce it with brightness or shape — chroma alone is a slow read, and none of it survives colour blindness.'}
        </p>
      </Group>

      <Group label="Weight">
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
        <Switch
          label="Louder notes are larger"
          checked={theme.encodings.sizeByVelocity}
          onChange={(sizeByVelocity) => patchEncodings({ sizeByVelocity })}
        />
      </Group>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Labels, on their own tab.
 *
 * They earned it: eleven controls, which is three times what any of its
 * neighbours carries. Sharing a column with Shape and Trail meant the last of
 * them sat below a scrollbar.
 */
function LabelsTab() {
  const theme = useStore((s) => s.theme)
  const score = useStore((s) => s.score)
  const layout = useStore((s) => s.theme.layout)
  const patchEncodings = useStore((s) => s.patchEncodings)
  const noteHeight = layout.laneHeight * (layout.mode === 'staff' ? 1.85 : 0.86)
  const { encodings } = theme

  const worstLabel = useMemo(
    () => (score ? worstLabelContrast(score.notes, theme, (n) => keyAt(score, n.onset)) : null),
    [score, theme],
  )

  if (encodings.label === 'none') {
    return (
      <div className="columns columns--4">
        {/* Labels are the way *off* labels as much as onto them, so the empty
            state says what they are for rather than just offering the switch. */}
        <Group label="Labels">
          <Field name="Show">
            <Pills
              options={LABEL_OPTIONS}
              value={encodings.label}
              onChange={(label) => patchEncodings({ label })}
            />
          </Field>
          <p className="note-text">
            Text is the slowest channel on the page — a letter has to be looked at, where a
            colour does not. Turn labels on to learn the colours, then narrow which notes
            carry one until none do.
          </p>
        </Group>
      </div>
    )
  }

  return (
    <div className="columns columns--4">
      <Group label="What they say">
        <Field name="Show">
          <Pills
            options={LABEL_OPTIONS}
            value={encodings.label}
            onChange={(label) => patchEncodings({ label })}
          />
        </Field>
        <Field name="On which notes">
          <Pills
            options={LABEL_TARGETS.map((t) => ({ value: t.id, label: t.label }))}
            value={encodings.labelOn}
            onChange={(labelOn: LabelOn) => patchEncodings({ labelOn })}
          />
        </Field>
        <Field name="Case">
          <Pills
            options={[
              { value: 'as-is', label: 'As is' },
              { value: 'upper', label: 'UPPER' },
              { value: 'lower', label: 'lower' },
            ]}
            value={encodings.labelCase}
            onChange={(labelCase) => patchEncodings({ labelCase })}
          />
        </Field>
      </Group>

      <Group label="Colour">
        <Field name="Ink">
          <Pills
            options={LABEL_INKS.map((i) => ({ value: i.id, label: i.label }))}
            value={encodings.labelInk}
            onChange={(labelInk: LabelInk) => patchEncodings({ labelInk })}
          />
        </Field>
        {encodings.labelInk === 'tint' && (
          <Range
            name="Shade"
            display={
              encodings.labelTint === 0
                ? 'same as note'
                : `${Math.round(Math.abs(encodings.labelTint) * 100)}% ${
                    encodings.labelTint < 0 ? 'darker' : 'lighter'
                  }`
            }
            min={-0.55}
            max={0.55}
            step={0.01}
            value={encodings.labelTint}
            onChange={(labelTint) => patchEncodings({ labelTint })}
          />
        )}
        <Range
        name="Fade"
        display={`${Math.round(encodings.labelOpacity * 100)}%`}
        min={0.1}
        max={1}
        step={0.05}
        value={encodings.labelOpacity}
        onChange={(labelOpacity) => patchEncodings({ labelOpacity })}
      />
        {/* Directly under the controls that cause it. Measured over the notes
            actually on the page, so it counts the colours this piece uses and
            any overrides applied to it — sweeping the palette instead warned
            about notes that were not there and missed ones that were. */}
        {worstLabel && (
          <p className={`note-text${worstLabel.ratio < 3 ? ' warn' : ''}`}>
            <ContrastDot fill={worstLabel.fill} />
            Weakest label {worstLabel.ratio.toFixed(1)}:1
            {worstLabel.ratio < 3
              ? ' — under the 3:1 floor. Push the shade further, or fade it less.'
              : worstLabel.ratio < 4.5
                ? ' — readable, not at small sizes.'
                : ' — comfortable.'}
          </p>
        )}
      </Group>

      <Group label="Type">
        <Field name="Typeface">
          <Pills
            options={LABEL_FONTS.map((f) => ({ value: f.id, label: f.label }))}
            value={encodings.labelFont}
            onChange={(labelFont) => patchEncodings({ labelFont })}
          />
        </Field>
        <Field name="Place">
          <Pills
            options={[
              { value: 'inside', label: 'Inside' },
              { value: 'above', label: 'Above' },
              { value: 'below', label: 'Below' },
            ]}
            value={encodings.labelPlace}
            onChange={(labelPlace) => patchEncodings({ labelPlace })}
          />
        </Field>
        {encodings.labelPlace === 'inside' && noteHeight < 13 && (
          <p className="note-text warn">
            At this note height a label inside will be cramped. Try Above, or raise the note
            height on the Page tab.
          </p>
        )}
      </Group>

      <Group label="Size">
        <div className="slider-pair">
          <Range
        name="Size"
        display={`${Math.round(encodings.labelScale * 100)}%`}
        min={0.6}
        max={1.6}
        step={0.05}
        value={encodings.labelScale}
        onChange={(labelScale) => patchEncodings({ labelScale })}
      />
          <Range
        name="Weight"
        display={`${encodings.labelWeight}`}
        min={300}
        max={800}
        step={50}
        value={encodings.labelWeight}
        onChange={(labelWeight) => patchEncodings({ labelWeight })}
      />
          <Range
        name="Tracking"
        display={`${encodings.labelTracking.toFixed(1)}`}
        min={-0.5}
        max={2}
        step={0.1}
        value={encodings.labelTracking}
        onChange={(labelTracking) => patchEncodings({ labelTracking })}
      />
        </div>
      </Group>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * The staff and the lines under the music.
 *
 * Split off the Page tab because the staff editor is eighteen editable things
 * behind one click target, and page colour, size and grain had nothing to do
 * with any of them beyond both being "not the notes".
 */
function StaffTab() {
  const theme = useStore((s) => s.theme)
  const patchLayout = useStore((s) => s.patchLayout)
  const { layout } = theme
  const isRoll = layout.mode === 'roll'
  const [selected, setSelected] = useState<Selection>({ kind: 'line', index: 5 })

  const patchLine = (role: LineRole, patch: Partial<LineStyle>) =>
    patchLayout({ lines: { ...layout.lines, [role]: { ...layout.lines[role], ...patch } } })

  const swatches = lineSwatches(theme.surface, buildPalette(theme.encodings.color).colors)

  // Only the lines this notation actually draws, so the editor never offers a
  // control with nothing behind it. The staff's own lines are edited through
  // the picker rather than as a role, so they are not repeated here.
  const roles: { role: LineRole; label: string }[] = isRoll
    ? [
        { role: 'beat', label: 'Beat lines' },
        { role: 'bar', label: 'Barlines' },
        { role: 'anchor', label: 'Anchor lines' },
      ]
    : [
        { role: 'bar', label: 'Barlines' },
        { role: 'ledger', label: 'Ledger lines' },
      ]

  const lineGroup = ({ role, label }: { role: LineRole; label: string }) => {
    const style = layout.lines[role]
    return (
      <Group label={label} key={role}>
        <Switch label="Draw" checked={style.show} onChange={(show) => patchLine(role, { show })} />
        {style.show && (
          <>
            <Swatches
              value={style.color}
              options={swatches}
              onChange={(color) => patchLine(role, { color })}
            />
            <Pills
              options={DASH_KINDS.map((d) => ({ value: d.id, label: d.label }))}
              value={style.dash}
              onChange={(dash) => patchLine(role, { dash })}
            />
            <Range
              name="Weight"
              display={style.width.toFixed(1)}
              min={0.5}
              max={5}
              step={0.25}
              value={style.width}
              onChange={(width) => patchLine(role, { width })}
            />
            <Range
              name="Strength"
              display={`${Math.round(style.opacity * 100)}%`}
              min={0.1}
              max={1}
              step={0.05}
              value={style.opacity}
              onChange={(opacity) => patchLine(role, { opacity })}
            />
          </>
        )}
      </Group>
    )
  }

  if (isRoll) {
    return (
      <div className="columns columns--4">
        <Group label="Reference">
          {/* Judging a mark against a line is far more precise than judging it in
              empty space, so a roll with no horizontal reference makes pitch
              needlessly hard to read. */}
          <Field name="Anchor on">
            <Pills
              options={ANCHOR_OPTIONS.map((a) => ({ value: a.id, label: a.label }))}
              value={layout.anchorOn}
              onChange={(anchorOn) => patchLayout({ anchorOn })}
            />
          </Field>
        </Group>
        {roles.map(lineGroup)}
      </div>
    )
  }

  const base = layout.lines.staff

  return (
    <div className="columns columns--staff">
      <Group label="Staff">
        <StaffPicker
          staff={layout.staff}
          base={base}
          surface={theme.surface}
          selected={selected}
          onSelect={setSelected}
        />
      </Group>

      {/* The base every line starts from. Without it the only way to make the
          whole staff heavier or a different colour was to edit ten lines one at
          a time — the cascade existed in the data and not in the interface. */}
      <Group label="All lines">
        <Switch
          label="Draw the staff"
          checked={base.show}
          onChange={(show) => patchLine('staff', { show })}
        />
        {base.show && (
          <>
            <Swatches
              value={base.color}
              options={swatches}
              onChange={(color) => patchLine('staff', { color })}
            />
            <Pills
              options={DASH_KINDS.map((d) => ({ value: d.id, label: d.label }))}
              value={base.dash}
              onChange={(dash) => patchLine('staff', { dash })}
            />
            <Range
              name="Weight"
              display={base.width.toFixed(1)}
              min={0.5}
              max={5}
              step={0.25}
              value={base.width}
              onChange={(width) => patchLine('staff', { width })}
            />
            <Range
              name="Strength"
              display={`${Math.round(base.opacity * 100)}%`}
              min={0.1}
              max={1}
              step={0.05}
              value={base.opacity}
              onChange={(opacity) => patchLine('staff', { opacity })}
            />
          </>
        )}
      </Group>

      <Group label={selectionName(selected)}>
        <StaffItemEditor
          staff={layout.staff}
          base={base}
          swatches={swatches}
          selected={selected}
          onChange={(staff) => patchLayout({ staff })}
        />
      </Group>

      {roles.map(lineGroup)}
    </div>
  )
}

// ---------------------------------------------------------------------------

function PageTab() {
  const theme = useStore((s) => s.theme)
  const patchLayout = useStore((s) => s.patchLayout)
  const setPage = useStore((s) => s.setPage)
  const { layout } = theme
  const isRoll = layout.mode === 'roll'

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

        {/* Three numbers that are read together — bars per line sets the scale
            everything else is measured against — so they share a grid rather
            than running the column past the panel's height. */}
        <div className="slider-pair">
          <Range
        name="Note height"
        display={`${layout.laneHeight}`}
        min={7}
        max={26}
        value={layout.laneHeight}
        onChange={(laneHeight) => patchLayout({ laneHeight })}
      />
          <Range
        name="Bars per line"
        display={layout.barsPerSystem > 0 ? `${layout.barsPerSystem}` : 'Auto'}
        min={0}
        max={12}
        value={layout.barsPerSystem}
        onChange={(barsPerSystem) => patchLayout({ barsPerSystem })}
      />
          <Range
        name="Between lines"
        display={`${layout.systemGap}`}
        min={16}
        max={110}
        value={layout.systemGap}
        onChange={(systemGap) => patchLayout({ systemGap })}
      />
        </div>
      </Group>

      <Group label="Page">
        {/* Swatches, not labelled tiles. A page colour is a colour — the name
            under it cost a row each and told you nothing the swatch did not.
            Each still previews its derived grid and ink, since those follow. */}
        <div className="page-swatches">
          {PAGES.map((page) => (
            <button
              key={page.id}
              className="page-swatch"
              style={{ background: page.color }}
              aria-pressed={theme.surface.background.toLowerCase() === page.color.toLowerCase()}
              onClick={() => setPage(page.color)}
              title={page.name}
            >
              <i
                style={{
                  background: makeSurface(page.color).gridStrong,
                  width: 11,
                  height: 3,
                  borderRadius: 2,
                  display: 'block',
                }}
              />
              <i
                style={{
                  background: makeSurface(page.color).text,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  display: 'block',
                }}
              />
            </button>
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
          <Range
            name="Grain strength"
            display={`${Math.round(layout.pageTexture.strength * 100)}%`}
            min={0.02}
            max={0.3}
            step={0.02}
            value={layout.pageTexture.strength}
            onChange={(strength) =>
              patchLayout({ pageTexture: { ...layout.pageTexture, strength } })
            }
          />
        )}

      </Group>

      <Group label="Show">
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
