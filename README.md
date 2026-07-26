# Folio

Sheet music, in a language that suits you.

Folio reads a score in a standard format and lets you redesign how it looks —
colour, shape, labels, spacing, right down to a single note. The goal is
accessibility: traditional notation is a fixed encoding with no redundancy, so
missing one channel means losing the thread. Folio lets a reader choose the
encoding, and lets the same fact be carried by several channels at once.

```bash
npm install
npm run dev
```

Open the printed URL in Chrome. No backend, no account, no build config to
touch.

---

## The idea

Traditional notation maps pitch to vertical position on a *diatonic* axis (so
the same visual step is sometimes a tone and sometimes a semitone), duration to
notehead fill plus stems, flags and dots, and everything else to memorised
glyphs. It is dense and efficient once learned, and brutal before then —
largely because nothing is redundant. Every symbol carries unique meaning.

So Folio is not "sheet music with colours". It is an **encoding editor**: you
map musical dimensions onto visual channels, and you may map one dimension onto
several channels at once.

| Musical dimension | Visual channel |
| --- | --- |
| pitch class · octave · scale degree · duration · hand · dynamics · fingering | vertical position · length · hue · shape · size · outline · label |

One rule is deliberately baked in: **colour is never the only channel
available.** Around 8% of men have some colour vision deficiency, and twelve
mutually distinguishable hues do not exist for them. Palettes that need twelve
are marked as such in the UI, shape and label channels are always offered
alongside, and a colour vision simulator is one click away so you can check
rather than hope.

## Architecture

```
MusicXML ─┐
MIDI file ─┼──▶  Score IR  ──▶  Theme  ──▶  Layout  ──▶  SVG
Live MIDI ─┘   (normalised     (cascading    (pure fn)
                 events)         rules)
```

Everything hinges on `Score IR` (`src/core/types.ts`) — a flat, source-agnostic
event list. Every input converges on it and every renderer reads only from it.
That boundary is what makes a new visual language a config object rather than a
code change, and it is what will let live keyboard input reuse the renderer
untouched: incoming MIDI simply produces the same `NoteEvent` shape.

```
src/
  core/
    types.ts      Score IR, tempo/key/time maps, beat↔second conversion
    pitch.ts      Spelling, scale degrees, piano keyboard geometry
    theme.ts      The cascade: selectors, specificity, style resolution
    palettes.ts   Colour and shape vocabularies, each owning its dimension
    presets.ts    Six curated starting points
    dsl.ts        Compact text notation used to author the demo library
    library.ts    Built-in repertoire
  io/
    musicxml.ts   MusicXML → IR (the preferred path — keeps spelling, voices)
    midifile.ts   Standard MIDI File → IR (lossy: no spelling, inferred hands)
    mxl.ts        Minimal ZIP reader for compressed .mxl
  render/
    layout.ts     IR + theme + width → positioned systems. Pure, no DOM.
    ScoreView.tsx SVG renderer
    NoteGlyph.tsx A single note
    cvd.tsx       Colour vision deficiency simulation
  ui/             Library, Style Studio, note inspector, transport
  audio/          Synthesised playback (Web Audio, no samples)
```

### Themes cascade

Themes work like CSS. A base encoding covers every note; rules with selectors
layer on top in specificity order:

```
base                    colour by pitch class, shape = capsule
pitchClass G       →    colour #E8B4FF, shape = hexagon
octave 3           →    heavier outline
note "n_412"       →    label "thumb"
```

Specificity runs `hand < octave < scaleDegree < pitchClass < pitchClassOctave
< note`, and ties break on rule order. This is why "make every G a hexagon" is
one line rather than a forked palette, why switching presets keeps your
overrides, and why a shared theme reads as a legible diff.

### Layout wraps into systems

Music wraps into rows the way text wraps into lines. That is built in from the
start because it is also the answer to page turns in live mode — see below.

## Input formats

| Format | Support | Notes |
| --- | --- | --- |
| MusicXML (`.xml`, `.musicxml`) | Preferred | Keeps spelling, voices, staves, fingering, articulation, ties |
| Compressed MusicXML (`.mxl`) | Yes | MuseScore's default export |
| Standard MIDI (`.mid`) | Lossy | No spelling (reconstructed from key signature), hands inferred from track layout |

Not handled yet: grace notes (no duration to place them in), `score-timewise`
files, and PDF or image scans (that needs optical music recognition, which is a
project of its own).

## Where this is going

The endgame is a live display driven by a Bluetooth or USB keyboard, fully
replacing paper. Two notes on that:

**Latency is not the hard part.** Web MIDI dispatches note-on in a few
milliseconds; the real floor is the display refresh, which native code would
not beat. Latency only becomes critical if we synthesise audio in response to a
key press.

**Page turns should be designed away, not raced.** Rather than flipping a page
at exactly the right moment, the next system materialises once the player is
reliably past the current one. Nothing ever flips, so there is no moment to
mistime. The layout engine already produces wrapped systems, so this is a
rendering change rather than an architectural one.

Platform-wise, Chrome on desktop and Android supports Web MIDI including
Bluetooth LE, which covers the prototype. iOS Safari does not support Web MIDI
at all, so an iPad music stand would need a Capacitor wrapper — the IR boundary
means only the input adapter changes.
