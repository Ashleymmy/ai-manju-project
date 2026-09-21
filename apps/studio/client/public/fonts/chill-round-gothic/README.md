# Chill Round Gothic

Source: https://github.com/Warren2060/ChillRoundGothic

Pinned revision: `53505f0818983d2fcdda00dc66e051ad13e81ffb`

Copyright 2023 The ChillRoundGothic Project Authors. Distributed under the SIL
Open Font License 1.1; the unmodified upstream license is included in `OFL.txt`.

These WOFF2 subsets are derived from upstream WOFF files:

- `medium.53505f0.woff2`: `woff/ChillRoundGothic_Medium.woff`
- `bold.53505f0.woff2`: `woff/ChillRoundGothic_Bold.woff`

The UI uses the medium face for normal/medium text and bold for emphasized text.
Both retain 7,807 characters: GB2312 coverage plus Latin U+0020-00FF, punctuation
U+2000-206F and U+3000-303F, and full-width forms U+FF00-FFEF where available in
the source. Rarer characters use the system Chinese font fallback. They are served
locally with `font-display: swap`; no third-party request is needed for rounded UI.
Existing explicit canvas/editor and monospace fonts are kept unchanged.

Generated with FontTools 4.65.0 `Subsetter`, default layout options, all name IDs
and languages retained, and Brotli 1.2.0 WOFF2 compression. Each GB2312 character
is obtained by decoding valid byte pairs A1-F7 / A1-FE; this set is unioned with
the Unicode ranges above. Glyph coverage is verified after reopening the output.
Medium is 1,844,232 bytes; bold is 1,890,344 bytes (about 76% smaller in total).
