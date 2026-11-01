# Brand: Verdict

Status: set

A verification instrument, not a landing page. Every screen should read like
a receipt you can audit: the claim, the evidence, and the check.

## Palette (CSS variables in `app/src/styles.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| paper | `#f6f4ee` | `#121210` | page background |
| surface | `#fffefa` | `#1a1a17` | panels |
| ink | `#17160f` | `#edeae2` | text, primary buttons |
| ink-2 | `#4c4a42` | `#aeaa9d` | secondary text (8.0:1 on paper) |
| rule / rule-strong | `#dcd8cc` / `#bdb8a8` | `#2e2d28` / `#47453d` | 1px borders |
| pass | `#17663f` on `#e3efe6` | `#5fcf95` on `#17271e` | a check passed |
| fail | `#a5281c` on `#f6e4e0` | `#f4877a` on `#2c1a17` | a check failed, a refusal |
| wait | `#7a5a08` on `#f3ead2` | `#e2bd5c` on `#2a2415` | pending, sample-data notice |

Colour carries meaning only. No gradients, glows or decorative colour.

## Type

- IBM Plex Sans for interface text (400/500/600).
- IBM Plex Mono for hashes, keys, model ids, request ids and timestamps.
- Uppercase 12px labels with 0.08em tracking for section labels.

## Shape

- 1px borders, `rounded-md` panels, `rounded` controls, no shadows.
- One content width (`max-w-6xl`), one gutter (`px-4 md:px-6`).

## Voice

Plain and specific. Say what was checked and what it means ("The signature
does not cover this response"), never "Oops" or marketing claims. Name the
limits of what is proven.
