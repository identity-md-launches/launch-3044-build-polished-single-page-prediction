// Game rules with no DOM or network, so they can be unit tested on their own.

export const ROUND_MS = 90_000;
/** A round reopened later than this after its timer ended is not scored: no reading exists for that moment. */
export const LATE_LIMIT_MS = 75_000;
/** Below 1 rpm the wheel is drifting, not being run. Only used when coreStatus is unclear. */
export const MIN_RUNNING_RPM_MILLI = 1000;

/** @typedef {"running" | "resting"} HamsterState */
/** @typedef {"squeek" | "sleep"} Pick */
/** @typedef {{ score: number, streak: number, bestStreak: number, rounds: number }} Stats */
/**
 * @typedef {object} Reading
 * @property {HamsterState | null} state null when the status cannot decide a round.
 * @property {string | null} coreStatus the API's own word, shown to the player as evidence.
 * @property {number | null} rpmMilli
 */

/** @type {Record<Pick, HamsterState>} */
export const PICK_STATE = { squeek: "running", sleep: "resting" };

/** @type {Readonly<Stats>} */
export const EMPTY_STATS = Object.freeze({ score: 0, streak: 0, bestStreak: 0, rounds: 0 });

const RUNNING_WORDS = new Set(["running", "run", "runs", "spinning", "spin", "active", "moving"]);
const RESTING_WORDS = new Set(["resting", "rest", "sleeping", "sleep", "asleep", "idle", "stopped", "still", "napping", "inactive", "paused"]);
const NO_DATA_WORDS = new Set(["offline", "down", "unavailable", "disconnected", "unknown", "error", "fault", "failed", "maintenance", "stale", "nodata"]);

/**
 * Sorts the API's status word into what it says about the hamster.
 * @param {unknown} value
 * @returns {HamsterState | "no-data" | null} null when the word says nothing either way.
 */
export function classifyCoreStatus(value) {
  if (typeof value !== "string") return null;
  const words = value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.includes("not") || words.includes("non")) return null;
  if (words.some((word) => NO_DATA_WORDS.has(word))) return "no-data";
  const running = words.some((word) => RUNNING_WORDS.has(word));
  const resting = words.some((word) => RESTING_WORDS.has(word));
  if (running === resting) return null;
  return running ? "running" : "resting";
}

/** @param {unknown} value @returns {number | null} */
function toRpmMilli(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : null;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Turns a /v1/status body into a reading. A clear coreStatus decides; rpmMilli decides when the word
 * is unclear; a status that reports no data, or a body with neither field, decides nothing.
 * @param {unknown} body
 * @returns {Reading | null} null when the body holds neither field.
 */
export function parseStatus(body) {
  if (!isRecord(body)) return null;
  const measurement = isRecord(body.measurement) ? body.measurement : {};
  const rawStatus = measurement.coreStatus;
  const coreStatus = typeof rawStatus === "string" && rawStatus.trim() !== "" ? rawStatus.trim() : null;
  const rpmMilli = toRpmMilli(measurement.rpmMilli ?? body.rpmMilli);
  if (coreStatus === null && rpmMilli === null) return null;

  const word = classifyCoreStatus(coreStatus);
  /** @type {HamsterState | null} */
  let state = null;
  if (word === "running" || word === "resting") state = word;
  else if (word === null && rpmMilli !== null) state = rpmMilli >= MIN_RUNNING_RPM_MILLI ? "running" : "resting";
  return { state, coreStatus, rpmMilli };
}

/** @param {number} rpmMilli @returns {string} one decimal place, for example "42.3". */
export const formatRpm = (rpmMilli) => (rpmMilli / 1000).toFixed(1);

/**
 * Seconds a wheel turn takes on screen. It follows the real rpm within what the eye can read.
 * @param {number | null} rpmMilli
 */
export function spinSeconds(rpmMilli) {
  if (!rpmMilli) return 1.2;
  return Math.min(6, Math.max(0.4, 60 / (rpmMilli / 1000)));
}

/**
 * Points for a correct pick: 1 plus the streak held going into the round.
 * @param {number} streak
 */
export const pointsFor = (streak) => 1 + streak;

/**
 * @param {Stats} stats
 * @param {Pick} pick
 * @param {HamsterState} actual
 * @returns {{ stats: Stats, correct: boolean, points: number }}
 */
export function scoreRound(stats, pick, actual) {
  const correct = PICK_STATE[pick] === actual;
  const points = correct ? pointsFor(stats.streak) : 0;
  const streak = correct ? stats.streak + 1 : 0;
  return {
    correct,
    points,
    stats: {
      score: stats.score + points,
      streak,
      bestStreak: Math.max(stats.bestStreak, streak),
      rounds: stats.rounds + 1,
    },
  };
}

/** @param {number} ms @returns {string} remaining time as m:ss, rounded up. */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** @param {number} ms */
export function formatAge(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `Checked ${seconds}s ago`;
  return `Checked ${Math.floor(seconds / 60)}m ago`;
}
