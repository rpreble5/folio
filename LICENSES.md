# Third-party licences

## Bravura

`src/render/glyphs.ts` contains notation glyph outlines converted from
**Bravura**, the SMuFL reference font — clefs, rests, accidentals, flags,
noteheads, time-signature digits and articulation marks.

Bravura is © Steinberg Media Technologies GmbH & Co. KG and is licensed under
the **SIL Open Font License, Version 1.1**, which permits use, study,
modification and redistribution, including of derivative works, provided this
notice travels with them.

The full licence text is at <https://scripts.sil.org/OFL>.

The outlines were converted from the copy distributed with
[VexFlow](https://github.com/0xfe/vexflow) 4.2.3 (MIT), by
`tools/gen-glyphs.mjs`. Neither VexFlow nor the font itself is a dependency of
this project — the conversion is run once by hand and its output committed, so
what ships is path data and nothing loads at runtime.

Any individual glyph in `src/render/glyphs.ts` may be replaced with an original
drawing by editing its path string; nothing else in the codebase depends on
where a path came from.
