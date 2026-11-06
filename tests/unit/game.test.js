import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRetryAfter, readWheel, STATUS_URL } from "../../src/api.js";
import { EMPTY_STATS, classifyCoreStatus, formatClock, parseStatus, scoreRound, spinSeconds } from "../../src/game.js";
import { sanitizeSave } from "../../src/store.js";

test("coreStatus words are sorted without guessing", () => {
  for (const word of ["running", "RUNNING", "wheel_running", "Spinning", "active"]) assert.equal(classifyCoreStatus(word), "running", word);
  for (const word of ["resting", "SLEEPING", "idle", "core-resting", "stopped"]) assert.equal(classifyCoreStatus(word), "resting", word);
  for (const word of ["offline", "ERROR", "stale", "unknown"]) assert.equal(classifyCoreStatus(word), "no-data", word);
  for (const word of ["ok", "online", "not_running", "", 3, null, undefined]) assert.equal(classifyCoreStatus(word), null, String(word));
});

test("a clear coreStatus decides, even against rpmMilli", () => {
  assert.equal(parseStatus({ measurement: { coreStatus: "running", rpmMilli: 42300 } })?.state, "running");
  assert.equal(parseStatus({ measurement: { coreStatus: "resting", rpmMilli: 0 } })?.state, "resting");
  assert.equal(parseStatus({ measurement: { coreStatus: "resting", rpmMilli: 900 } })?.state, "resting");
  assert.equal(parseStatus({ measurement: { coreStatus: "running", rpmMilli: 0 } })?.state, "running");
});

test("rpmMilli decides when coreStatus is unclear or missing", () => {
  assert.equal(parseStatus({ measurement: { coreStatus: "ok", rpmMilli: 42300 } })?.state, "running");
  assert.equal(parseStatus({ measurement: { coreStatus: "ok", rpmMilli: 999 } })?.state, "resting");
  assert.equal(parseStatus({ measurement: { rpmMilli: 1000 } })?.state, "running");
  assert.equal(parseStatus({ measurement: { rpmMilli: "5000" } })?.state, "running");
  assert.equal(parseStatus({ measurement: { coreStatus: "ok" }, rpmMilli: 5000 })?.state, "running");
});

test("no answer is never turned into a guess", () => {
  assert.equal(parseStatus({ measurement: { coreStatus: "offline", rpmMilli: 42300 } })?.state, null);
  assert.equal(parseStatus({ measurement: { coreStatus: "ok" } })?.state, null);
  assert.equal(parseStatus({ measurement: { coreStatus: "ok", rpmMilli: -5 } })?.state, null);
  for (const body of [null, "x", 7, [], {}, { measurement: {} }, { measurement: null }]) assert.equal(parseStatus(body), null);
});

test("a correct pick scores 1 plus the streak held going in", () => {
  let stats = { ...EMPTY_STATS };
  const points = [];
  for (let i = 0; i < 3; i += 1) {
    const round = scoreRound(stats, "squeek", "running");
    assert.equal(round.correct, true);
    points.push(round.points);
    stats = round.stats;
  }
  assert.deepEqual(points, [1, 2, 3]);
  assert.deepEqual(stats, { score: 6, streak: 3, bestStreak: 3, rounds: 3 });
});

test("a wrong pick scores nothing, resets the streak and keeps the best streak", () => {
  const round = scoreRound({ score: 6, streak: 3, bestStreak: 3, rounds: 3 }, "sleep", "running");
  assert.equal(round.correct, false);
  assert.equal(round.points, 0);
  assert.deepEqual(round.stats, { score: 6, streak: 0, bestStreak: 3, rounds: 4 });
});

test("Sleep is the correct pick for a resting hamster", () => {
  assert.equal(scoreRound(EMPTY_STATS, "sleep", "resting").correct, true);
  assert.equal(scoreRound(EMPTY_STATS, "squeek", "resting").correct, false);
});

test("the clock rounds up and never goes negative", () => {
  assert.equal(formatClock(90_000), "1:30");
  assert.equal(formatClock(89_001), "1:30");
  assert.equal(formatClock(60_000), "1:00");
  assert.equal(formatClock(9_000), "0:09");
  assert.equal(formatClock(-5), "0:00");
});

test("the wheel spin follows rpm within readable limits", () => {
  assert.equal(spinSeconds(60_000), 1);
  assert.equal(spinSeconds(1_000_000), 0.4);
  assert.equal(spinSeconds(1000), 6);
  assert.equal(spinSeconds(null), 1.2);
});

test("a save from storage is repaired, not trusted", () => {
  const now = 1_000_000;
  assert.deepEqual(sanitizeSave(null, now), { stats: EMPTY_STATS, round: null });
  assert.deepEqual(sanitizeSave({ stats: { score: -4, streak: 2.5, bestStreak: "9", rounds: 3 } }, now).stats, { score: 0, streak: 0, bestStreak: 0, rounds: 3 });
  assert.equal(sanitizeSave({ stats: { streak: 5, bestStreak: 2 } }, now).stats.bestStreak, 5);
  assert.equal(sanitizeSave({ round: { id: "a", pick: "toString", endsAt: now } }, now).round, null);
  assert.equal(sanitizeSave({ round: { id: "a", pick: "sleep", endsAt: now + 9_000_000 } }, now).round, null);
  assert.deepEqual(sanitizeSave({ round: { id: "a", pick: "sleep", endsAt: now } }, now).round, { id: "a", pick: "sleep", endsAt: now });
});

test("Retry-After accepts seconds and dates", () => {
  assert.equal(parseRetryAfter("30", 0), 30_000);
  assert.equal(parseRetryAfter(null, 0), null);
  assert.equal(parseRetryAfter("soon", 0), null);
  assert.equal(parseRetryAfter(new Date(5000).toUTCString(), 0), 5000);
});

test("readWheel sends a request that needs no CORS preflight", async () => {
  /** @type {RequestInit | undefined} */
  let seen;
  const result = await readWheel(async (url, init) => {
    assert.equal(url, STATUS_URL);
    seen = init;
    return new Response(JSON.stringify({ measurement: { coreStatus: "running", rpmMilli: 1000 } }));
  });
  assert.equal(result.ok, true);
  assert.equal(seen?.headers, undefined);
  assert.equal(seen?.method, undefined);
  assert.equal(seen?.cache, "no-cache");
});

test("readWheel reports every failure the same calm way and never throws", async () => {
  const failing = [
    async () => { throw new TypeError("Failed to fetch"); },
    async () => new Response("<html>challenge</html>", { status: 403 }),
    async () => new Response("<html>not json</html>", { status: 200 }),
    async () => new Response(JSON.stringify({ hello: "world" })),
  ];
  for (const fetchImpl of failing) assert.equal((await readWheel(fetchImpl)).ok, false);
  const limited = await readWheel(async () => new Response("", { status: 429, headers: { "Retry-After": "45" } }));
  assert.deepEqual(limited, { ok: false, retryAfterMs: 45_000 });
});
