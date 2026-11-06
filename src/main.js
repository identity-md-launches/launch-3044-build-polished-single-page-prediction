import "./style.css";
import { readWheel } from "./api.js";
import { LATE_LIMIT_MS, ROUND_MS, formatAge, formatClock, formatRpm, scoreRound, spinSeconds } from "./game.js";
import { createStore } from "./store.js";

/** @typedef {import("./game.js").Reading} Reading */
/** @typedef {import("./game.js").Pick} Pick */
/** @typedef {import("./game.js").HamsterState} HamsterState */
/** @typedef {import("./store.js").Round} Round */
/** @typedef {"idle" | "locked" | "reading" | "result"} View */

const POLL_MS = 15_000;
const MAX_BACKOFF_MS = 60_000;
/** Waits between attempts at the final reading. A round is only void after all of them fail. */
const FINAL_READ_WAITS_MS = [3000, 5000, 7000];
const QUESTION = "Where will Squeektoshi be in 90 seconds?";
/** @type {Record<Pick, string>} */
const PICK_NAME = { squeek: "Squeek", sleep: "Sleep" };
/** @type {Record<HamsterState, string>} */
const STATE_WORD = { running: "running", resting: "sleeping" };

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return /** @type {T} */ (element);
}

const el = {
  score: byId("stat-score"),
  streak: byId("stat-streak"),
  best: byId("stat-best"),
  rounds: byId("stat-rounds"),
  storageNote: byId("storage-note"),
  wheel: /** @type {SVGSVGElement} */ (/** @type {unknown} */ (byId("wheel"))),
  ring: /** @type {SVGCircleElement} */ (/** @type {unknown} */ (byId("wheel-ring"))),
  nowState: byId("now-state"),
  nowText: byId("now-text"),
  nowAge: byId("now-age"),
  retry: byId("retry"),
  play: byId("play"),
  title: byId("play-title"),
  timer: byId("timer"),
  resultLine: byId("result-line"),
  resultText: byId("result-text"),
  resultEvidence: byId("result-evidence"),
  next: byId("next"),
  announce: byId("announce"),
};

const store = createStore();
let saved = store.load(Date.now());

/** @type {View} */
let view = "idle";
/** @type {Reading | null} */
let live = null;
let lastReadAt = 0;
let liveFailed = false;
let failures = 0;
let pollTimer = 0;
let polling = false;
let appliedSpin = 0;

/** @param {Reading} reading */
function describeReading(reading) {
  const parts = [];
  if (reading.coreStatus !== null) parts.push(`coreStatus ${reading.coreStatus}`);
  if (reading.rpmMilli !== null) parts.push(`${formatRpm(reading.rpmMilli)} rpm`);
  return parts.join(", ");
}

function renderStats() {
  const { score, streak, bestStreak, rounds } = saved.stats;
  el.score.textContent = String(score);
  el.streak.textContent = String(streak);
  el.best.textContent = String(bestStreak);
  el.rounds.textContent = String(rounds);
  el.storageNote.hidden = store.isPersistent();
}

function renderLive() {
  const state = live?.state ?? null;
  el.wheel.dataset.hamster = state ?? "unknown";
  el.wheel.setAttribute(
    "aria-label",
    state === "running" ? "Squeektoshi is running on the wheel"
      : state === "resting" ? "Squeektoshi is asleep and the wheel is still"
        : "Squeektoshi, status not known",
  );

  const spin = spinSeconds(live?.rpmMilli ?? null);
  // Changing the duration restarts the turn, so small rpm drift is not worth a visible jump.
  if (!appliedSpin || Math.abs(spin - appliedSpin) / appliedSpin > 0.25) {
    appliedSpin = spin;
    el.wheel.style.setProperty("--spin", `${spin.toFixed(2)}s`);
  }

  const rpm = live?.rpmMilli ?? null;
  let text = "Reading the wheel…";
  let tone = "unknown";
  if (liveFailed) {
    text = "Unable to read the wheel";
    tone = "failed";
  } else if (state === "running") {
    text = rpm === null ? "Running" : `Running at ${formatRpm(rpm)} rpm`;
    tone = "running";
  } else if (state === "resting") {
    text = rpm === null ? "Sleeping" : `Sleeping, wheel at ${formatRpm(rpm)} rpm`;
    tone = "resting";
  } else if (live) {
    text = "The wheel reports no clear status";
  }
  el.nowText.textContent = text;
  el.nowState.dataset.tone = tone;
  el.retry.hidden = !liveFailed;
  renderAge();
}

function renderAge() {
  el.nowAge.textContent = lastReadAt ? formatAge(Date.now() - lastReadAt) : "";
}

/** @param {number} fraction 1 is a full ring, 0 is empty. */
function setRing(fraction) {
  const filled = Math.min(1, Math.max(0, fraction));
  el.ring.style.strokeDashoffset = String(1 - filled);
  el.ring.toggleAttribute("data-empty", filled === 0);
}

/** @param {View} next @param {string} title */
function setView(next, title) {
  view = next;
  el.play.dataset.view = next;
  el.title.textContent = title;
}

/** @param {string} message */
const announce = (message) => {
  el.announce.textContent = message;
};

function focusIsInPanel() {
  return document.activeElement !== null && el.play.contains(document.activeElement);
}

/** @param {string} clock */
function setClock(clock) {
  if (el.timer.textContent === clock) return;
  el.timer.replaceChildren(
    ...[...clock].map((character) => {
      const cell = document.createElement("span");
      if (character !== ":") cell.className = "timer-digit";
      cell.textContent = character;
      return cell;
    }),
  );
}

function renderLocked() {
  const round = saved.round;
  if (!round) return;
  const left = round.endsAt - Date.now();
  setClock(formatClock(left));
  setRing(left / ROUND_MS);
}

function showIdle() {
  setView("idle", QUESTION);
  setRing(1);
}

/** @param {Round} round */
function showLocked(round) {
  setView("locked", `You picked ${PICK_NAME[round.pick]}`);
  renderLocked();
}

/** @param {Pick} pick */
function startRound(pick) {
  if (view !== "idle") return;
  const round = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pick,
    endsAt: Date.now() + ROUND_MS,
  };
  saved = { ...saved, round };
  store.save(saved);
  showLocked(round);
  el.title.focus({ preventScroll: true });
  announce(`You picked ${PICK_NAME[pick]}. The round ends in 90 seconds.`);
}

/**
 * Another tab settled this round first. Show its numbers rather than scoring twice.
 * @param {import("./store.js").Saved} current
 */
function adoptOtherTab(current) {
  saved = current;
  renderStats();
  if (current.round) showLocked(current.round);
  else showIdle();
}

/** @param {boolean} hadFocus */
function focusNext(hadFocus) {
  // Without preventScroll: on a short screen the button can sit below the fold.
  if (hadFocus) el.next.focus();
}

/**
 * @param {Round} round
 * @param {string} evidence
 */
function showVoid(round, evidence) {
  const hadFocus = focusIsInPanel();
  const current = store.load(Date.now());
  if (current.round?.id !== round.id) {
    adoptOtherTab(current);
    return;
  }
  saved = { ...current, round: null };
  store.save(saved);
  renderStats();
  setRing(0);
  setView("result", "Round not scored");
  el.resultLine.dataset.tone = "void";
  el.resultText.textContent = "Score and streak did not change.";
  el.resultEvidence.textContent = evidence;
  focusNext(hadFocus);
  announce(`Round not scored. ${evidence} Score and streak did not change.`);
}

/**
 * @param {Round} round
 * @param {Reading} reading
 * @param {HamsterState} actual
 */
function settle(round, reading, actual) {
  const hadFocus = focusIsInPanel();
  const current = store.load(Date.now());
  if (current.round?.id !== round.id) {
    adoptOtherTab(current);
    return;
  }

  const outcome = scoreRound(current.stats, round.pick, actual);
  saved = { stats: outcome.stats, round: null };
  store.save(saved);
  renderStats();
  setRing(0);

  const word = STATE_WORD[actual];
  const { streak } = outcome.stats;
  const previousStreak = current.stats.streak;
  let detail;
  if (outcome.correct) {
    const points = outcome.points === 1 ? "+1 point" : `+${outcome.points} points`;
    detail = `${points}. Your streak is now ${streak}.`;
  } else {
    detail = previousStreak > 0 ? "No points. Your streak is back to 0." : "No points this round.";
  }
  const title = outcome.correct ? `Correct. Squeektoshi is ${word}.` : `Not this time. Squeektoshi is ${word}.`;
  const evidence = `You picked ${PICK_NAME[round.pick]}. Final reading: ${describeReading(reading)}.`;

  setView("result", title);
  el.resultLine.dataset.tone = outcome.correct ? "correct" : "wrong";
  el.resultText.textContent = detail;
  el.resultEvidence.textContent = evidence;
  focusNext(hadFocus);
  announce(`${title} ${detail}`);
}

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {Round} round */
async function resolveRound(round) {
  if (Date.now() - round.endsAt > LATE_LIMIT_MS) {
    showVoid(round, "The timer ended while this page was away.");
    return;
  }
  setView("reading", "Reading the wheel…");
  setRing(0);
  announce("Time is up. Reading the wheel.");

  for (let attempt = 0; attempt <= FINAL_READ_WAITS_MS.length; attempt += 1) {
    if (attempt > 0) await wait(FINAL_READ_WAITS_MS[attempt - 1]);
    const result = await readWheel();
    applyLiveResult(result);
    if (result.ok && result.reading.state) {
      settle(round, result.reading, result.reading.state);
      return;
    }
  }
  showVoid(round, "Unable to read the wheel when the timer ended.");
}

/** @param {Awaited<ReturnType<typeof readWheel>>} result */
function applyLiveResult(result) {
  if (result.ok) {
    live = result.reading;
    lastReadAt = Date.now();
    liveFailed = false;
    failures = 0;
  } else {
    // The last good reading is out of date now, so the scene stops claiming it.
    live = null;
    liveFailed = true;
    failures += 1;
  }
  renderLive();
}

/** @param {number} delay */
function schedulePoll(delay) {
  clearTimeout(pollTimer);
  pollTimer = window.setTimeout(poll, delay);
}

async function poll() {
  if (polling) return;
  if (document.hidden || view === "reading") {
    schedulePoll(POLL_MS);
    return;
  }
  polling = true;
  const result = await readWheel();
  polling = false;
  // The final read owns the scene once it has started, and the view may have changed during the await.
  if (/** @type {View} */ (view) !== "reading") applyLiveResult(result);
  const backoff = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.max(0, failures - 1));
  schedulePoll(Math.max(backoff, result.retryAfterMs ?? 0));
}

function tick() {
  renderAge();
  if (view !== "locked") return;
  const round = saved.round;
  if (!round) return;
  if (Date.now() >= round.endsAt) void resolveRound(round);
  else renderLocked();
}

function syncFromOtherTab() {
  if (view === "reading") return;
  saved = store.load(Date.now());
  renderStats();
  if (saved.round && view !== "locked") showLocked(saved.round);
  else if (!saved.round && view === "locked") showIdle();
}

byId("pick-squeek").addEventListener("click", () => startRound("squeek"));
byId("pick-sleep").addEventListener("click", () => startRound("sleep"));
el.next.addEventListener("click", () => {
  showIdle();
  el.title.focus({ preventScroll: true });
});
el.retry.addEventListener("click", () => {
  el.nowText.textContent = "Reading the wheel…";
  el.nowState.dataset.tone = "unknown";
  failures = 0;
  schedulePoll(0);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  tick();
  if (Date.now() - lastReadAt > POLL_MS) schedulePoll(0);
});
window.addEventListener("storage", syncFromOtherTab);

renderStats();
renderLive();
if (saved.round) {
  if (Date.now() >= saved.round.endsAt) void resolveRound(saved.round);
  else showLocked(saved.round);
} else {
  showIdle();
}
schedulePoll(0);
setInterval(tick, 250);
