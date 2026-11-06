# Validation

## Scope and assumptions

Reviewed the one page, built to `dist/`, with its round flow and all reachable states: loading, idle, locked,
reading, correct, wrong, not scored (read failed, status gave no answer, round too late), live failure with
retry, blocked storage, and a second tab.

Choices the brief left open:

- "+1 point + streak" uses the streak held going into the round, so correct picks score +1, +2, +3. A wrong
  pick costs no points.
- A clear `coreStatus` word beats `rpmMilli`, and `rpmMilli` decides when the word is unclear. `rpmMilli` is read
  from `measurement`, then from the top level, and as rpm × 1000.
- A round with no reading is not scored and is not counted in total rounds.
- The brief's "pure HTML, CSS and JavaScript" is kept in source and output. Vite and `tsc --noEmit` with JSDoc
  are build-time only, which satisfies the requested build and typecheck.

Hosting on `*.imd.site` happens after this job, from the committed `dist/`.

## The status API

| Client | What happened |
| --- | --- |
| `curl`, Node `fetch`, WebFetch | 403 with `cf-mitigated: challenge` |
| Headless Chromium running the finished site | Request blocked by CORS, as the challenge response has no CORS header. The site showed "Unable to read the wheel" with no page error. |
| OPTIONS preflight from `curl` | 403 with `cf-mitigated: challenge` |
| One `curl` GET sent with a desktop Chrome user agent and an `Origin` header | 200, `content-type: application/json`, `access-control-allow-origin: *`. The body was discarded. |

The last row impersonated a browser and was not repeated once it was clear that this was bot protection. The
real payload was therefore never read. **No scored round has run against the real API.** The tests prove the
game logic against a mock shaped from the brief's field names. Nothing shows yet that the `coreStatus` word
lists match real values, or that visitors' browsers are admitted.

## Coverage of the six domains

| Domain | Status | Inspected |
| --- | --- | --- |
| Accessibility | Checked | Native buttons and links, keyboard walk, focus after each transition, focus ring, polite status region, `role="timer"`, SVG name, reduced motion, 44px controls on phones, zoom meta not capped |
| Layout | Checked | Six viewports across every state, first screen, no shift between views, safe areas, logical properties, content-based breakpoint |
| Writing | Checked | Verb-first actions, one term per concept, errors in a calm tone with a next step, sentence case |
| Typography | Checked | Five sizes, three weights, descending headings, wrapping, digit stability, measure |
| Colors | Checked | Role tokens over primitives, measured pairs below, no meaning by color alone |
| UI | Checked | State walk from screenshots, named transitions, press scale 0.96, flat surfaces, radii |

Not verified, within those domains:

- Screen reader session. The polite region and names were checked in the DOM only.
- Browser-native 200% zoom. Reflow was checked at 320 CSS pixels instead.
- Forced-colors rendering. The rules exist but were not rendered.
- Physical phones, and WebKit or Safari. WebKit failed to launch here: `liblcms2.so.2` is missing.
- Motion at 10% speed.
- RTL and localization are not applicable: the site is English only.

The assigned browser tool could not start (`Chromium distribution 'chrome' is not found`), so rendered checks
used Playwright scripts driving the installed Chromium headless shell. Screenshots of representative states were viewed at
320x568, 390x664, 390x844 and 1440x900. Every state was captured, but not every capture was viewed.

## Measured contrast

Computed from the role tokens as resolved to sRGB by Chromium's canvas. All backgrounds are solid.

| Foreground | Background | Ratio |
| --- | --- | --- |
| text primary `#f8f5ef` | page `#140f0b` | 17.50:1 |
| text primary | surface `#201a15` | 15.82:1 |
| text primary | control `#302922` | 13.16:1 |
| text secondary `#c5bcb1` | page | 10.16:1 |
| text secondary | surface | 9.18:1 |
| accent text `#ffa659` | page | 9.84:1 |
| accent text | surface | 8.89:1 |
| on accent `#2c1204` | accent solid `#fe8c2c` | 7.53:1 |
| on accent | accent hover `#ffa659` | 9.08:1 |
| correct `#6de18b` | page | 11.60:1 |
| wrong `#ff8880` | page | 8.24:1 |
| status running `#6de18b` | surface | 10.49:1 |
| status failed `#ff8880` | surface | 7.45:1 |
| focus ring `#f8f5ef` | page | 17.50:1 |
| Sleep border `#fe8c2c` | control | 6.14:1 |

The focus ring against the orange button is 2.14:1, but the 2px offset keeps the ring on the page color, as the
focused screenshot at 1440 shows.

## Findings and fixes

| Severity | Where | Evidence | Fix | Recheck |
| --- | --- | --- | --- | --- |
| High | `src/style.css:70` | At 320x568 the Squeek button ended at 574.9px, below the first screen | Wheel cap 37 to 35 of the viewport height, tagline moved to its own full-width row | Browser test passes at 320x568, 390x664, 390x844 |
| Medium | `src/main.js:152`, `src/style.css` `.timer-digit` | Fredoka has no tabular figures: 5 distinct digit widths, so the clock would jitter | Fixed 0.66em digit cells | Browser test: one cell width, widest digit fits |
| Medium | `src/style.css:220` | A five-digit score wrapped to "1234 / 5" at 320 | Stat columns size to content | Screenshot at 320x568 |
| Medium | `index.html:117`, `src/style.css` `.text-button` | Probe `eyebrows` failed: a boxed "Retry now" sat directly above the play heading in the failure state | Restyled as a text button, matching the existing text link | Probe passes, 44px target kept |
| Medium | `src/main.js:212` | Focus moved to the Next button with `preventScroll`, which could leave it below the fold on a short screen | Removed `preventScroll` for that focus | Source review; focus target is browser tested, the scroll at short heights is not |
| Low | `src/main.js:132`, `src/style.css` `.wheel-ring[data-empty]` | An orange arc showed in the result screenshot, and a round cap can leave a dot on an empty ring | Hide the ring at zero | Browser test: computed `visibility: hidden` |
| Low | `index.html:128` | Pick details wrapped to two lines at 320, and "Resting" did not match the status text | "Hamster running" and "Hamster sleeping" | Screenshot at 320x568 |
| Low | `src/style.css:39` | The live dot borrowed `--color-correct`, a result color | Added `--color-status-running` and `--color-status-failed` | Source review |

No known high or medium findings remain open apart from the limitations below.

## Verification

Commands run on the final source, with `PLAYWRIGHT_BROWSERS_PATH` pointing at this machine's browsers:

| Command | Result |
| --- | --- |
| `npm ci` | Passed on a clean install, 0 vulnerabilities |
| `npm run build` | Passed; `dist/` is 7 files, about 160 KB |
| `npm run typecheck` | Passed, 0 errors |
| `npm test` | 13 of 13 passed |
| `npm run test:e2e` | 34 of 34 passed in headless Chromium, API mocked; includes one real 90.2-second round |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16 of 16 checks passed |

The browser tests serve `dist/` under `/preview/`. They cover relative assets and share tags, the absence of
preflight headers, live status, scoring across four rounds, resolving on the status at the end of the window,
countdown and ring, reload, three kinds of final-read failure and recovery, a retry that succeeds, a no-answer
status, `Retry-After`, late rounds, corrupt and blocked storage, two tabs, the keyboard path, the status region,
reduced motion, overflow for eight states at six viewports, the first screen, layout stability, phone target
sizes, and one round on real timers for the full 90 seconds.

The probe measures whichever state the page reaches on its own. Its browser cannot reach the API, so its figures
describe the "Unable to read the wheel" state on the first screen. Its 390 screenshot confirms the stats, wheel,
question and both picks are on the first screen. The other states were checked by the browser tests and screenshots
above. The probe also reported 64 text boxes as over images and left them unmeasured, which is why the pairs were
computed separately above.

## Completion

**Incomplete for one stated requirement, complete for the rest.** The site, build, typecheck, tests, design review
and documents are done. Resolving a round against the real status is implemented but unproven, because the API's
bot protection blocks this machine from reading it.

To close this, open the site in an ordinary browser and confirm that the status line shows a reading. If it shows
"Unable to read the wheel", the API owner needs to let cross-origin GETs from the site through Cloudflare. If it
shows "The wheel reports no clear status" or the wrong state, compare a real reply with the word lists in
`src/game.js:25`.
