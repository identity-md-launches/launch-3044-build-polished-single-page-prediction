import { EMPTY_STATS, PICK_STATE, ROUND_MS } from "./game.js";

export const STORAGE_KEY = "squeek-or-sleep:v1";

/** @typedef {import("./game.js").Stats} Stats */
/** @typedef {import("./game.js").Pick} Pick */
/** @typedef {{ id: string, pick: Pick, endsAt: number }} Round */
/** @typedef {{ stats: Stats, round: Round | null }} Saved */

/** @param {unknown} value */
const count = (value) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

/**
 * Accepts anything found in storage and returns a valid save.
 * @param {unknown} raw
 * @param {number} now
 * @returns {Saved}
 */
export function sanitizeSave(raw, now) {
  const data = typeof raw === "object" && raw !== null ? /** @type {Record<string, any>} */ (raw) : {};
  const stats = typeof data.stats === "object" && data.stats !== null ? data.stats : EMPTY_STATS;
  const streak = count(stats.streak);
  const round = data.round;
  const validRound =
    typeof round === "object" && round !== null &&
    typeof round.id === "string" &&
    Object.hasOwn(PICK_STATE, round.pick) &&
    typeof round.endsAt === "number" && Number.isFinite(round.endsAt) &&
    round.endsAt <= now + ROUND_MS;
  return {
    stats: {
      score: count(stats.score),
      streak,
      bestStreak: Math.max(count(stats.bestStreak), streak),
      rounds: count(stats.rounds),
    },
    round: validRound ? { id: round.id, pick: round.pick, endsAt: round.endsAt } : null,
  };
}

/** Falls back to memory when the browser blocks localStorage, and reports that so the page can say so. */
export function createStore() {
  /** @type {string | null} */
  let memory = null;
  let persistent = true;

  /** @param {number} now @returns {Saved} */
  function load(now) {
    /** @type {string | null} */
    let text = memory;
    if (persistent) {
      try {
        text = localStorage.getItem(STORAGE_KEY);
      } catch {
        persistent = false;
      }
    }
    try {
      return sanitizeSave(text ? JSON.parse(text) : null, now);
    } catch {
      return sanitizeSave(null, now);
    }
  }

  /** @param {Saved} saved */
  function save(saved) {
    const text = JSON.stringify(saved);
    memory = text;
    if (!persistent) return;
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch {
      persistent = false;
    }
  }

  return { load, save, isPersistent: () => persistent };
}
