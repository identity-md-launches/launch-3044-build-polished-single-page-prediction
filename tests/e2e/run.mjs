// Interaction checks on the built dist/, served under a subpath, with the status API mocked per test.
// Needs a Playwright Chromium: `npx playwright-core install chromium`, or set PLAYWRIGHT_BROWSERS_PATH.
// node tests/e2e/run.mjs [screenshot dir]
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright-core";

const DIST = resolve("dist");
const SHOTS = resolve(process.argv[2] ?? "test/scratch/shots");
const API = "https://api.squeekchain.com/v1/status";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const RUNNING = { measurement: { coreStatus: "running", rpmMilli: 42300 } };
const RESTING = { measurement: { coreStatus: "resting", rpmMilli: 0 } };

await mkdir(SHOTS, { recursive: true });
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith("/preview/")) { res.writeHead(404).end(); return; }
  const rel = path.slice("/preview/".length) || "index.html";
  try {
    const body = await readFile(join(DIST, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const URL_ROOT = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({ headless: true });

const results = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Opens the game with the API answering whatever `api.body`/`api.mode` currently say. */
async function open({ viewport = { width: 390, height: 844 }, reducedMotion, storage, clock = true, body = RUNNING } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: reducedMotion ? "reduce" : "no-preference", hasTouch: viewport.width < 600 });
  const api = { body, mode: "ok", calls: [] };
  const problems = [];
  const attach = (page) => {
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      // Failed status reads are an expected state in these tests and print a browser network error.
      if (message.type() === "error" && !/status of (403|500|429)|ERR_FAILED|CORS policy/.test(message.text())) problems.push(`console: ${message.text()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().startsWith(URL_ROOT)) problems.push(`${response.status()} ${response.url()}`);
    });
  };
  await context.route(API, async (route) => {
    const request = route.request();
    api.calls.push({ method: request.method(), headers: request.headers() });
    if (api.mode === "ok") await route.fulfill({ json: api.body, headers: { "access-control-allow-origin": "*" } });
    else if (api.mode === "500") await route.fulfill({ status: 500, body: "nope", headers: { "access-control-allow-origin": "*" } });
    else if (api.mode === "429") await route.fulfill({ status: 429, body: "", headers: { "access-control-allow-origin": "*", "retry-after": "120", "access-control-expose-headers": "Retry-After" } });
    else if (api.mode === "challenge") await route.fulfill({ status: 403, contentType: "text/html", body: "<title>Just a moment...</title>" });
    else await route.abort("failed");
  });
  const page = await context.newPage();
  attach(page);
  if (storage) await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(key, value); sessionStorage.setItem("seeded", "1"); } }, ["squeek-or-sleep:v1", JSON.stringify(storage)]);
  if (clock) await page.clock.install();
  await page.goto(URL_ROOT);
  await settleAsync();
  return { context, page, api, problems, attach };
}

/** Lets mocked fetches finish while the page's clock stands still. */
const settleAsync = () => sleep(120);
const text = (page, selector) => page.locator(selector).innerText();
const stats = async (page) => ({
  score: Number(await text(page, "#stat-score")), streak: Number(await text(page, "#stat-streak")),
  best: Number(await text(page, "#stat-best")), rounds: Number(await text(page, "#stat-rounds")),
});
function equal(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: got ${a}, expected ${b}`);
}
function ok(value, label) {
  if (!value) throw new Error(label);
}
/** Runs a whole round: pick, let 90 seconds pass on the page's clock, wait for the result panel. */
async function playRound(page, pick) {
  await page.locator(`#pick-${pick}`).click();
  await page.clock.runFor(90_500);
  await settleAsync();
}
async function test(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
    console.log(`pass  ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

await test("loads at a subpath with relative assets, share tags and the local font", async () => {
  const { context, page, problems } = await open();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.reload();
  await settleAsync();
  const external = requests.filter((url) => !url.startsWith(URL_ROOT) && url !== API);
  equal(external, [], "requests off the page's origin");
  equal(await page.title(), "Squeek or Sleep: predict the hamster", "title");
  const meta = (name) => page.locator(`meta[property="${name}"], meta[name="${name}"]`).getAttribute("content");
  equal(await meta("og:title"), "Squeek or Sleep", "og:title");
  equal(await meta("og:image"), "./og.png", "og:image");
  ok(await meta("description"), "description");
  equal((await page.request.get(`${URL_ROOT}og.png`)).status(), 200, "og.png");
  equal((await page.request.get(`${URL_ROOT}favicon.svg`)).status(), 200, "favicon");
  ok(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("600 20px Fredoka"); }), "Fredoka did not load");
  equal(problems, [], "console and resource problems");
  await context.close();
});

await test("the status request is a simple GET with no custom headers, so no preflight", async () => {
  const { context, api } = await open();
  ok(api.calls.length > 0, "no call made");
  for (const call of api.calls) {
    equal(call.method, "GET", "method");
    const custom = Object.keys(call.headers).filter((name) => /^(if-none-match|authorization|content-type|x-)/.test(name));
    equal(custom, [], "custom headers");
  }
  await context.close();
});

await test("live status shows running and sleeping from the API, with art to match", async () => {
  const { context, page, api } = await open();
  equal(await text(page, "#now-text"), "Running at 42.3 rpm", "running text");
  equal(await page.locator("#wheel").getAttribute("data-hamster"), "running", "running art");
  api.body = RESTING;
  await page.clock.runFor(15_500);
  await settleAsync();
  equal(await text(page, "#now-text"), "Sleeping, wheel at 0.0 rpm", "resting text");
  equal(await page.locator("#wheel").getAttribute("data-hamster"), "resting", "resting art");
  await context.close();
});

await test("a correct pick scores +1, then +2, then +3; a wrong pick resets the streak", async () => {
  const { context, page, api } = await open();
  equal(await stats(page), { score: 0, streak: 0, best: 0, rounds: 0 }, "start");
  await playRound(page, "squeek");
  equal(await text(page, "#play-title"), "Correct. Squeektoshi is running.", "title 1");
  equal(await text(page, "#result-text"), "+1 point. Your streak is now 1.", "result 1");
  equal(await text(page, "#result-evidence"), "You picked Squeek. Final reading: coreStatus running, 42.3 rpm.", "evidence");
  equal(await stats(page), { score: 1, streak: 1, best: 1, rounds: 1 }, "stats 1");

  await page.locator("#next").click();
  await playRound(page, "squeek");
  equal(await text(page, "#result-text"), "+2 points. Your streak is now 2.", "result 2");
  equal(await stats(page), { score: 3, streak: 2, best: 2, rounds: 2 }, "stats 2");

  await page.locator("#next").click();
  api.body = RESTING;
  await playRound(page, "sleep");
  equal(await text(page, "#play-title"), "Correct. Squeektoshi is sleeping.", "title 3");
  equal(await text(page, "#result-text"), "+3 points. Your streak is now 3.", "result 3");
  equal(await stats(page), { score: 6, streak: 3, best: 3, rounds: 3 }, "stats 3");

  await page.locator("#next").click();
  await playRound(page, "squeek");
  equal(await text(page, "#play-title"), "Not this time. Squeektoshi is sleeping.", "title 4");
  equal(await text(page, "#result-text"), "No points. Your streak is back to 0.", "result 4");
  equal(await stats(page), { score: 6, streak: 0, best: 3, rounds: 4 }, "stats 4");
  await context.close();
});

await test("the round resolves on the status at the end, not the status when picked", async () => {
  const { context, page, api } = await open();
  await page.locator("#pick-squeek").click();
  await page.clock.runFor(60_000);
  api.body = RESTING;
  await page.clock.runFor(30_500);
  await settleAsync();
  equal(await text(page, "#play-title"), "Not this time. Squeektoshi is sleeping.", "title");
  await context.close();
});

await test("the countdown and ring run, and the pick cannot be changed once locked", async () => {
  const { context, page } = await open();
  await page.locator("#pick-sleep").click();
  equal(await text(page, "#play-title"), "You picked Sleep", "locked title");
  equal(await text(page, "#timer"), "1:30", "start");
  equal(await page.locator("#pick-squeek").isVisible(), false, "picks hidden");
  await page.clock.runFor(30_300);
  equal(await text(page, "#timer"), "1:00", "after 30s");
  const widths = await page.evaluate(async () => {
    await document.fonts.ready;
    const timer = document.querySelector("#timer");
    const size = parseFloat(getComputedStyle(timer).fontSize);
    const cell = timer.querySelector(".timer-digit");
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    timer.append(probe);
    const natural = [..."0123456789"].map((digit) => { probe.textContent = digit; return probe.getBoundingClientRect().width; });
    probe.remove();
    const cells = [..."0123456789"].map((digit) => { cell.textContent = digit; return cell.getBoundingClientRect().width; });
    return { cells: new Set(cells).size, fits: Math.max(...natural) <= cells[0], widest: Math.max(...natural) / size };
  });
  ok(widths.fits, `widest digit is ${widths.widest}em`);
  equal(widths.cells, 1, "distinct digit cell widths in the timer");
  const offset = await page.locator("#wheel-ring").evaluate((node) => Number(node.style.strokeDashoffset));
  ok(Math.abs(offset - 1 / 3) < 0.02, `ring offset ${offset}`);
  await context.close();
});

await test("stats and a running round survive a reload", async () => {
  const { context, page } = await open();
  await playRound(page, "squeek");
  await page.reload();
  await settleAsync();
  equal(await stats(page), { score: 1, streak: 1, best: 1, rounds: 1 }, "after reload");
  equal(await text(page, "#play-title"), "Where will Squeektoshi be in 90 seconds?", "idle after reload");
  await page.locator("#pick-sleep").click();
  await page.clock.runFor(40_000);
  await page.reload();
  await settleAsync();
  equal(await text(page, "#play-title"), "You picked Sleep", "round resumed");
  equal(await text(page, "#timer"), "0:50", "timer resumed");
  await context.close();
});

for (const mode of ["500", "challenge", "network"]) {
  await test(`a round is not scored when the final read fails (${mode}), then play recovers`, async () => {
    const { context, page, api } = await open({ storage: { stats: { score: 5, streak: 2, bestStreak: 4, rounds: 7 }, round: null } });
    await page.locator("#pick-squeek").click();
    await page.clock.runFor(89_000);
    api.mode = mode;
    await page.clock.runFor(1_500);
    await settleAsync();
    equal(await text(page, "#play-title"), "Reading the wheel…", "reading view");
    for (let i = 0; i < 4; i += 1) {
      await page.clock.runFor(7_000);
      await settleAsync();
    }
    equal(await text(page, "#play-title"), "Round not scored", "void title");
    equal(await text(page, "#result-evidence"), "Unable to read the wheel when the timer ended.", "void reason");
    equal(await stats(page), { score: 5, streak: 2, best: 4, rounds: 7 }, "stats unchanged");
    equal(await text(page, "#now-text"), "Unable to read the wheel", "live failure text");
    ok(await page.locator("#retry").isVisible(), "retry shown");

    api.mode = "ok";
    await page.locator("#retry").click();
    await page.clock.runFor(100);
    await settleAsync();
    equal(await text(page, "#now-text"), "Running at 42.3 rpm", "recovered");
    equal(await page.locator("#retry").isVisible(), false, "retry hidden");
    await page.locator("#next").click();
    ok(await page.locator("#pick-squeek").isVisible(), "picks back");
    await context.close();
  });
}

await test("a final read that fails once and then answers still scores", async () => {
  const { context, page, api } = await open();
  await page.locator("#pick-squeek").click();
  await page.clock.runFor(89_000);
  api.mode = "500";
  await page.clock.runFor(1_500);
  await settleAsync();
  api.mode = "ok";
  await page.clock.runFor(3_100);
  await settleAsync();
  equal(await text(page, "#play-title"), "Correct. Squeektoshi is running.", "title");
  await context.close();
});

await test("a status with no answer voids the round instead of guessing", async () => {
  const { context, page, api } = await open({ body: { measurement: { coreStatus: "offline", rpmMilli: 42300 } } });
  equal(await text(page, "#now-text"), "The wheel reports no clear status", "live text");
  equal(await page.locator("#wheel").getAttribute("data-hamster"), "unknown", "art");
  await page.locator("#pick-squeek").click();
  await page.clock.runFor(90_500);
  for (let i = 0; i < 4; i += 1) { await settleAsync(); await page.clock.runFor(7_000); }
  await settleAsync();
  equal(await text(page, "#play-title"), "Round not scored", "void");
  equal(await stats(page), { score: 0, streak: 0, best: 0, rounds: 0 }, "stats");
  ok(api.calls.length >= 4, "retried");
  await context.close();
});

await test("polling backs off on failure and honours Retry-After", async () => {
  const { context, page, api } = await open();
  api.mode = "429";
  await page.clock.runFor(15_500);
  await settleAsync();
  const before = api.calls.length;
  await page.clock.runFor(100_000);
  await settleAsync();
  equal(api.calls.length, before, "no call inside Retry-After");
  await page.clock.runFor(25_000);
  await settleAsync();
  equal(api.calls.length, before + 1, "one call after Retry-After");
  await context.close();
});

await test("a round reopened long after its timer is not scored", async () => {
  const stale = { stats: { score: 2, streak: 1, bestStreak: 1, rounds: 2 }, round: { id: "old", pick: "squeek", endsAt: Date.now() - 300_000 } };
  const { context, page } = await open({ storage: stale });
  equal(await text(page, "#play-title"), "Round not scored", "void");
  equal(await text(page, "#result-evidence"), "The timer ended while this page was away.", "reason");
  equal(await stats(page), { score: 2, streak: 1, best: 1, rounds: 2 }, "stats");
  await context.close();
});

await test("a round that ended moments ago while closed still scores", async () => {
  const recent = { stats: { score: 0, streak: 0, bestStreak: 0, rounds: 0 }, round: { id: "new", pick: "squeek", endsAt: Date.now() - 5_000 } };
  const { context, page } = await open({ storage: recent });
  equal(await text(page, "#play-title"), "Correct. Squeektoshi is running.", "title");
  await context.close();
});

await test("corrupt storage starts clean rather than breaking", async () => {
  const context = await browser.newContext();
  await context.route(API, (route) => route.fulfill({ json: RUNNING, headers: { "access-control-allow-origin": "*" } }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("squeek-or-sleep:v1", "{not json"));
  await page.goto(URL_ROOT);
  await settleAsync();
  equal(await stats(page), { score: 0, streak: 0, best: 0, rounds: 0 }, "stats");
  equal(errors, [], "page errors");
  await context.close();
});

await test("blocked storage still plays, and says the numbers will not last", async () => {
  const context = await browser.newContext();
  await context.route(API, (route) => route.fulfill({ json: RUNNING, headers: { "access-control-allow-origin": "*" } }));
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
  });
  await page.clock.install();
  await page.goto(URL_ROOT);
  await settleAsync();
  ok(await page.locator("#storage-note").isVisible(), "note shown");
  await page.locator("#pick-squeek").click();
  await page.clock.runFor(90_500);
  await settleAsync();
  equal(await stats(page), { score: 1, streak: 1, best: 1, rounds: 1 }, "stats");
  await context.close();
});

await test("two tabs on one round score it once", async () => {
  const { context, page, attach } = await open();
  await page.locator("#pick-squeek").click();
  const second = await context.newPage();
  attach(second);
  await second.clock.install();
  await second.goto(URL_ROOT);
  await settleAsync();
  equal(await text(second, "#play-title"), "You picked Squeek", "second tab adopts the round");
  await page.clock.runFor(95_000);
  await second.clock.runFor(95_000);
  await settleAsync();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("squeek-or-sleep:v1")));
  equal(saved.stats, { score: 1, streak: 1, bestStreak: 1, rounds: 1 }, "scored once");
  await context.close();
});

await test("the whole round works from the keyboard, with focus kept and a visible ring", async () => {
  const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim()));
  }
  equal(seen.slice(0, 3), ["How it works", "pick-squeek", "pick-sleep"], "tab order");
  await page.locator("#pick-squeek").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const ring = await page.evaluate(() => { const style = getComputedStyle(document.activeElement); return `${style.outlineStyle} ${style.outlineWidth}`; });
  equal(ring, "solid 2px", "focus ring");
  await page.screenshot({ path: join(SHOTS, "1440-focus.png") });
  await page.keyboard.press("Enter");
  equal(await page.evaluate(() => document.activeElement?.id), "play-title", "focus after pick");
  await page.clock.runFor(90_500);
  await settleAsync();
  equal(await page.locator("#wheel-ring").evaluate((node) => getComputedStyle(node).visibility), "hidden", "empty ring leaves no dot");
  equal(await page.evaluate(() => document.activeElement?.id), "next", "focus on next round");
  await page.keyboard.press("Enter");
  equal(await page.evaluate(() => document.activeElement?.id), "play-title", "focus after next");
  await page.keyboard.press("Tab");
  equal(await page.evaluate(() => document.activeElement?.id), "pick-squeek", "back to picks");
  await context.close();
});

await test("results are announced through one polite status region", async () => {
  const { context, page } = await open();
  await page.locator("#pick-squeek").click();
  equal(await text(page, "#announce"), "You picked Squeek. The round ends in 90 seconds.", "start");
  await page.clock.runFor(90_500);
  await settleAsync();
  equal(await text(page, "#announce"), "Correct. Squeektoshi is running. +1 point. Your streak is now 1.", "result");
  await context.close();
});

await test("endless motion stops under reduced motion", async () => {
  for (const body of [RUNNING, RESTING]) {
    const { context, page } = await open({ reducedMotion: true, body });
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations === Infinity).length);
    equal(running, 0, "infinite animations");
    await context.close();
  }
  const { context, page } = await open();
  const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations === Infinity).length);
  ok(moving > 0, "wheel should spin without the preference");
  await context.close();
});

const VIEWPORTS = [
  { width: 320, height: 568 }, { width: 390, height: 664 }, { width: 390, height: 844 },
  { width: 768, height: 1024 }, { width: 960, height: 700 }, { width: 1440, height: 900 },
];

/** Every state a visitor can reach, set up from scratch for each width. */
const STATES = {
  idle: async () => {},
  locked: async ({ page }) => { await page.locator("#pick-squeek").click(); await page.clock.runFor(30_000); },
  reading: async ({ page, api }) => { await page.locator("#pick-sleep").click(); await page.clock.runFor(89_000); api.mode = "500"; await page.clock.runFor(1_500); await settleAsync(); },
  correct: async ({ page }) => { await playRound(page, "squeek"); },
  wrong: async ({ page }) => { await playRound(page, "sleep"); },
  void: async ({ page, api }) => { await page.locator("#pick-squeek").click(); await page.clock.runFor(89_000); api.mode = "500"; await page.clock.runFor(1_500); for (let i = 0; i < 4; i += 1) { await settleAsync(); await page.clock.runFor(7_000); } await settleAsync(); },
  sleeping: async () => {},
  failed: async () => {},
};

for (const viewport of VIEWPORTS) {
  await test(`no overflow in any state at ${viewport.width}x${viewport.height}`, async () => {
    for (const [name, enter] of Object.entries(STATES)) {
      const session = await open({ viewport, storage: { stats: { score: 12345, streak: 12, bestStreak: 123, rounds: 4567 }, round: null }, body: name === "sleeping" ? RESTING : RUNNING });
      if (name === "failed") { session.api.mode = "500"; await session.page.clock.runFor(15_500); await settleAsync(); }
      await enter(session);
      const overflow = await session.page.evaluate(() => {
        const root = document.documentElement;
        const clipped = [...document.querySelectorAll("button, a, h1, h2, h3, p, dd, dt, li")]
          .filter((node) => node.getClientRects().length && !node.closest(".sr-only"))
          .filter((node) => { const box = node.getBoundingClientRect(); return box.right > root.clientWidth + 0.5 || box.left < -0.5; })
          .map((node) => node.id || node.tagName);
        return { scroll: root.scrollWidth - root.clientWidth, clipped };
      });
      equal(overflow, { scroll: 0, clipped: [] }, `${name}`);
      if (viewport.width !== 768 && viewport.width !== 960) await session.page.screenshot({ path: join(SHOTS, `${viewport.width}x${viewport.height}-${name}.png`) });
      await session.context.close();
    }
  });
}

for (const viewport of [{ width: 390, height: 664 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 900 }]) {
  await test(`the wheel and both picks are on the first screen at ${viewport.width}x${viewport.height}`, async () => {
    const { context, page } = await open({ viewport });
    const boxes = await page.evaluate(() => ["#wheel", "#pick-squeek", "#pick-sleep", "#stat-score", "#stat-rounds"].map((selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { selector, bottom: box.bottom };
    }));
    for (const box of boxes) ok(box.bottom <= viewport.height, `${box.selector} ends at ${box.bottom}`);
    equal(await page.evaluate(() => scrollY), 0, "scroll");
    await context.close();
  });
}

await test("moving through a round does not move the wheel or the rules", async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    const { context, page } = await open({ viewport });
    const positions = () => page.evaluate(() => ["#wheel", "#rules"].map((selector) => Math.round(document.querySelector(selector).getBoundingClientRect().top + scrollY)));
    const start = await positions();
    await page.locator("#pick-squeek").click();
    equal(await positions(), start, `locked at ${viewport.width}`);
    await page.clock.runFor(90_500);
    await settleAsync();
    equal(await positions(), start, `result at ${viewport.width}`);
    await context.close();
  }
});

await test("every control is at least 44px tall on a phone", async () => {
  const { context, page, api } = await open();
  api.mode = "500";
  await page.clock.runFor(15_500);
  await settleAsync();
  const small = await page.evaluate(() => [...document.querySelectorAll("button, .masthead a")]
    .filter((node) => node.getClientRects().length)
    .map((node) => ({ id: node.id || node.textContent.trim(), height: node.getBoundingClientRect().height }))
    .filter((control) => control.height < 44));
  equal(small, [], "small controls");
  await context.close();
});

await test("a real round runs on real timers for the full 90 seconds", async () => {
  const { context, page } = await open({ clock: false });
  const started = Date.now();
  await page.locator("#pick-squeek").click();
  await page.waitForFunction(() => document.querySelector("#play")?.dataset.view === "result", undefined, { timeout: 100_000, polling: 250 });
  const elapsed = Date.now() - started;
  ok(elapsed >= 89_500 && elapsed < 93_000, `took ${elapsed}ms`);
  equal(await stats(page), { score: 1, streak: 1, best: 1, rounds: 1 }, "stats");
  console.log(`      real round took ${(elapsed / 1000).toFixed(1)}s`);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
