import { parseStatus } from "./game.js";

export const STATUS_URL = "https://api.squeekchain.com/v1/status";
const TIMEOUT_MS = 8000;

/** @typedef {import("./game.js").Reading} Reading */
/** @typedef {{ ok: true, reading: Reading, retryAfterMs: number | null } | { ok: false, retryAfterMs: number | null }} WheelResult */

/**
 * @param {string | null} header a Retry-After value: seconds or an HTTP date.
 * @param {number} now
 * @returns {number | null}
 */
export function parseRetryAfter(header, now) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * Reads the live status once and never throws.
 * The request stays a CORS "simple" GET on purpose: the API refuses preflight OPTIONS requests, so no
 * custom header (If-None-Match included) may be set. cache: "no-cache" still makes the browser
 * revalidate with its stored ETag, so a round never settles on a stale copy.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<WheelResult>}
 */
export async function readWheel(fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(STATUS_URL, { cache: "no-cache", signal: controller.signal });
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), Date.now());
    if (!response.ok) return { ok: false, retryAfterMs };
    const reading = parseStatus(await response.json());
    return reading ? { ok: true, reading, retryAfterMs } : { ok: false, retryAfterMs };
  } catch {
    return { ok: false, retryAfterMs: null };
  } finally {
    clearTimeout(timeout);
  }
}
