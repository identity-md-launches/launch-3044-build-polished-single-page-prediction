# Squeek or Sleep

Predict the hamster. Powered by the real wheel.

A single-page prediction game for the Squeekchain hamster economy. Pick whether Squeektoshi will be
running or sleeping when a 90-second timer ends. When it ends, the page reads the real status from
`https://api.squeekchain.com/v1/status` and scores the round. There is no wallet, no account and no
backend: score, streak, best streak and total rounds live in this browser's `localStorage`.

## Install, preview and rebuild

Requires Node 22.12 or newer. Checked on Node 24.22.1.

```sh
npm ci            # install the exact versions in package-lock.json
npm run dev       # development server with live reload
npm run build     # write the static export to dist/
npm run preview   # serve the built dist/ locally
```

`dist/` is committed and is what gets hosted. After any source change, run `npm run build` and commit
`dist/` with it. Every asset URL is relative (`base: "./"` in `vite.config.js`), so the export works at
a domain root, a gateway subpath or an ENS name. There is nothing to configure.

The share image and touch icon in `public/` are static files. The site itself is plain HTML, CSS and
JavaScript with no runtime dependencies: Vite only bundles it, TypeScript only checks it (JSDoc types,
`checkJs`), and the one font (Fredoka, SIL Open Font License) is served from `dist/assets/`.

## Checks

```sh
npm run typecheck                             # tsc --noEmit over src/, tests/unit/ and the Vite config
npm test                                      # game rules, status parsing, storage repair
npx playwright-core install chromium          # once, for the browser tests
npm run test:e2e                              # built dist/ in Chromium, with the status API mocked
```

## How a round is decided

| Rule | Where |
| --- | --- |
| A clear `measurement.coreStatus` decides: running words count as running, resting words as sleeping. | `src/game.js` `parseStatus` |
| An unclear word, or none, falls back to `rpmMilli` (read as rpm × 1000): 1 rpm or more counts as running. | `src/game.js` `MIN_RUNNING_RPM_MILLI` |
| A status that reports no data (`offline`, `error`, `stale` and similar), or a reply with neither field, decides nothing. | `src/game.js` `NO_DATA_WORDS` |
| A correct pick scores 1 plus the streak held going in: +1, +2, +3 and so on. A wrong pick scores nothing and resets the streak. | `src/game.js` `scoreRound` |
| The final read is tried four times over about 15 seconds. If none answers, the round is not scored and no number changes. | `src/main.js` `resolveRound` |
| A round reopened more than 75 seconds after its timer ended is not scored, because no reading exists for that moment. | `src/game.js` `LATE_LIMIT_MS` |

The request must stay a CORS "simple" GET. The API allows any origin on GET but refused an OPTIONS
preflight when probed, so custom headers, including `If-None-Match`, would break it. `cache: "no-cache"`
gets the same revalidation without a custom header. Polling runs every 15 seconds while the tab is
visible, backs off to 60 seconds on failure and honours `Retry-After`.

## Latest results

Run on the final source. Full design review and evidence: [VALIDATION.md](VALIDATION.md).

| Command | Result |
| --- | --- |
| `npm ci` | Passed on a clean install, 0 vulnerabilities |
| `npm run build` | Passed; `dist/` is 7 files, about 160 KB |
| `npm run typecheck` | Passed, 0 errors |
| `npm test` | 13 of 13 passed |
| `npm run test:e2e` | 34 of 34 passed in headless Chromium, API mocked; includes one real 90.2-second round |
| `taste.mjs` design probe | 16 of 16 checks passed |

### Known limitations

- **The real API response has not been seen.** Cloudflare answers automated clients with a challenge,
  so this machine's Chromium got a CORS failure and the site correctly showed "Unable to read the
  wheel". All scored rounds in the tests use a mocked API built from the field names in the brief. The
  `coreStatus` word lists and the `rpmMilli` unit are assumptions until checked against a real reply.
- **Live play in a visitor's browser is unconfirmed.** If Cloudflare also challenges cross-origin
  requests from real browsers, every round ends as "Round not scored". The game says so and never
  invents a result, but it cannot score until the API admits those requests.
- **Not run:** WebKit and Safari (the engine needs system libraries this machine lacks), physical
  devices and a screen reader session.
- Scores are local to one browser and can be edited by their owner. There is no shared leaderboard.
