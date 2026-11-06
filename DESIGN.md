# Squeek or Sleep design

## Overview

A small game for people following the Squeekchain hamster. One idea carries the page: the big wheel is
both the live status and the countdown. Squeektoshi's pose and the wheel's spin show the current reading,
and the orange rim drains over the 90-second round. Everything else stays quiet so that the wheel, the
two picks and the score are what you see first.

The system is dark, warm and flat, with rounded type and one orange accent. It is mobile-first and dense
enough to fit the game on one phone screen, with the rules below it.

All styling lives in `src/style.css`. Markup, including the SVG art, is in `index.html`. Behavior is in
`src/main.js`.

## Colors

Defined as `oklch()` in `:root` in `src/style.css`. Primitives (`--neutral-*`, `--orange-*`, `--green-400`,
`--red-400`) are only referenced by the role tokens below, and components only use role tokens. There is
one dark theme and no light theme.

| Token | Value | Job |
| --- | --- | --- |
| `--color-bg-page` | `oklch(0.175 0.012 65)` | Page, and the inside of the wheel |
| `--color-bg-surface` | `oklch(0.225 0.014 65)` | The stage card; Sleep button on hover |
| `--color-bg-control` | `oklch(0.285 0.016 65)` | Sleep button, drained ring track, spokes |
| `--color-line` | `oklch(0.47 0.018 65)` | Wheel stand, rungs and hub |
| `--color-text-primary` | `oklch(0.97 0.008 80)` | Headings, numbers, status text |
| `--color-text-secondary` | `oklch(0.8 0.018 75)` | Captions, labels, tagline, sleeping marks |
| `--color-accent-solid` | `oklch(0.75 0.17 55)` | Squeek and Next buttons, Sleep border, wheel ring |
| `--color-accent-hover` | `oklch(0.8 0.14 60)` | Filled button hover |
| `--color-accent-text` | `oklch(0.8 0.14 60)` | Links and text buttons |
| `--color-on-accent` | `oklch(0.22 0.05 50)` | Text on filled orange |
| `--color-focus` | `oklch(0.97 0.008 80)` | Focus ring |
| `--color-correct` / `--color-wrong` | `oklch(0.82 0.16 150)` / `oklch(0.76 0.15 25)` | Result line; always with an icon and words |
| `--color-status-running` / `--color-status-failed` | same green / same red | Live status dot; always with words |

`--art-*` tokens (`--art-fur`, `--art-fur-dark`, `--art-belly`, `--art-ear`, `--art-eye`, `--art-nose`) color
the hamster and nothing else. Measured contrast pairs are in `VALIDATION.md`.

## Typography

One family: Fredoka, variable, weights 300 to 700, Latin subset, loaded from
`@fontsource-variable/fredoka` by the `@font-face` at the top of `src/style.css`. Fallback is
`ui-rounded, system-ui, sans-serif`. Inline `code` in the rules uses `ui-monospace`. Weights in use are
400 for text, 500 for status and links and 600 for headings, numbers and button names.

| Token | Size | Used for |
| --- | --- | --- |
| `--text-caption` | 0.8125rem | Captions, stat labels, tagline on phones, pick details, links |
| `--text-body` | 1rem | Body, status line, result line, rules, tagline from 60rem |
| `--text-title` | 1.25rem | Play panel heading, Rules heading, pick names |
| `--text-stat` | 1.75rem | Stat numbers; `h1` on phones |
| `--text-display` | 2.5rem | Round timer; `h1` from 60rem |

Inline code renders at 0.9375em of its parent. Headings use line-height 1.1 to 1.2 and `text-wrap: balance`;
body uses 1.5, captions 1.4. The `h1` tracks at -0.01em and everything else is natural. The rules are capped
at `65ch`.

Fredoka has no tabular figures. `font-variant-numeric: tabular-nums` on stats and status only helps the
fallback font, so the round timer sets each digit in a fixed `.timer-digit` cell 0.66em wide
(`setClock` in `src/main.js`).

## Layout

Spacing tokens are `--space-2` to `--space-8` (0.5, 0.75, 1, 1.5 and 2rem). `--gutter` is the page margin, and
`body` padding adds safe-area insets to it. `.masthead` and `.game` share a `max-width` of 72rem.

`.game` is a CSS grid with named areas, one breakpoint and no JavaScript layout.

- **Below 60rem:** one column in the order stats, stage, play, rules. `--wheel-size` is `min(100%, 35svh)`
  (with a `vh` fallback), so the picks stay on the first screen on short phones. Checked at 320x568,
  390x664 and 390x844.
- **From 60rem:** the stage takes the left column (`1.1fr`) and sticks while the right column (`1fr`) holds
  stats, play and rules. `--wheel-size` becomes `min(100%, 68svh)`. Checked at 960x700 and 1440x900.

`.play` has a `min-height` so moving between views does not push the rules. Stat columns size to their
content, so a five-digit score does not wrap at 320 wide.

## Elevation and depth

Flat. No shadows are used for depth. The stage is one tonal step above the page, and controls are one step
above that. The only `box-shadow` is the inset ring on the sleeping status dot.

## Shapes

`--radius-surface` (1.5rem) for the stage and `--radius-control` (0.875rem) for buttons. Circles are reserved
for the wheel and the status dot. Borders mark only the Sleep button (2px accent).

## Components

All are CSS patterns with markup in `index.html`, not exported library components.

- **Wheel (`.wheel`, `#wheel`):** inline SVG. `data-hamster` is `running`, `resting` or `unknown` and selects
  the pose. `--spin` sets a turn's duration from the real rpm, clamped to 0.4 to 6 seconds. `#wheel-ring` shows
  the time left through `stroke-dashoffset` and takes `data-empty` to hide the round cap at zero. Its
  `aria-label` changes with the status. Animation is opt-in through `prefers-reduced-motion: no-preference`.
- **Live status (`.now`):** a dot plus words in `#now-text`, with `data-tone` of `running`, `resting`, `failed`
  or `unknown`. Shows "Checked Ns ago", and `#retry` only after a failed read.
- **Play panel (`.play`):** `data-view` of `idle`, `locked`, `reading` or `result` shows one `.view`. One shared
  `#play-title` holds the state's heading and takes focus after a pick.
- **Pick buttons (`.pick`):** `.pick-squeek` is filled and `.pick-sleep` is outlined, so the two read as awake
  and asleep. Each has a name and a detail line. Press scales to 0.96. Hover is gated by `(hover: hover)`.
- **Next button (`.next`):** filled orange, shown on the result view.
- **Text link and text button (`.text-link`, `.text-button`):** accent, underlined from font metrics, 44px tall
  in the masthead and status strip.
- **Stats (`.stats dl`):** four `dt`/`dd` pairs. The DOM reads label then value, and the value shows on top.
- **Result line (`.result-line`):** `data-tone` of `correct`, `wrong` or `void` selects color and icon.
- **Announcer (`#announce`):** a stable `role="status"` region for round start and results. The timer is
  `role="timer"` and stays silent.

Every interactive element uses the shared `:focus-visible` ring: 2px solid `--color-focus`, offset 2px.

## Do's and don'ts

- Do say only what the API said. A missing reading is "Unable to read the wheel" or "Round not scored", never
  a guess or a sample value.
- Do pair every status color with words or an icon.
- Do keep orange for actions, links and the ring.
- Do put new endless motion inside the `prefers-reduced-motion: no-preference` block.
- Don't add a custom request header to the status call. It triggers a preflight, which the API refused.
- Don't add a size to the type scale, or a shadow to a bordered surface.

To add another page, start from `body` with `.masthead` and a `.game`-style grid, build on `--space-*` and
the role tokens, use `.next` for its one primary action and `.text-link` for everything lighter, and keep
asset URLs relative.
