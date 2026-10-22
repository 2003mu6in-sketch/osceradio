import { test } from "node:test";
import assert from "node:assert/strict";
import { applyResult } from "../../src/logic/progress.ts";
import { DELAY, HOUR, dueList, isDue, relTime, upcomingList } from "../../src/logic/schedule.ts";
import type { ReviewState } from "../../src/storage/types.ts";

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);

test("plan §6.1: wrong → stage 1, due in 48 h, misses + 1", () => {
  const s = applyResult(undefined, "c", "wrong", T0);
  assert.equal(s.stage, 1);
  assert.equal(s.dueAt, T0 + 48 * HOUR);
  assert.equal(s.misses, 1);
});

test("plan §6.1: right on a due stage-1 card → stage 2, due in 72 h", () => {
  const s1 = applyResult(undefined, "c", "wrong", T0);
  const t = T0 + 49 * HOUR;
  const s2 = applyResult(s1, "c", "right", t);
  assert.equal(s2.stage, 2);
  assert.equal(s2.dueAt, t + 72 * HOUR);
});

test("plan §6.1: right on a due stage-2 card → mastered, no due date", () => {
  let s = applyResult(undefined, "c", "wrong", T0);
  s = applyResult(s, "c", "right", T0 + DELAY[1]);                 // exactly at due time counts as due
  s = applyResult(s, "c", "right", T0 + DELAY[1] + DELAY[2] + 1);
  assert.equal(s.stage, "mastered");
  assert.equal(s.dueAt, undefined);
  assert.equal(isDue(s, T0 + 1000 * HOUR), false);
});

test("plan §6.1: wrong at stage 1 or 2 → back to stage 1, due in 48 h", () => {
  let s = applyResult(undefined, "c", "wrong", T0);
  s = applyResult(s, "c", "right", T0 + 50 * HOUR);                // → stage 2
  const t = T0 + 130 * HOUR;
  s = applyResult(s, "c", "wrong", t);
  assert.deepEqual([s.stage, s.dueAt, s.misses], [1, t + 48 * HOUR, 2]);
});

test("plan §6.1: right before the card is due does not advance it", () => {
  const s1 = applyResult(undefined, "c", "wrong", T0);
  const early = applyResult(s1, "c", "right", T0 + 2 * HOUR);      // e.g. "retry the ones I got wrong now"
  assert.equal(early.stage, 1);
  assert.equal(early.dueAt, s1.dueAt);
  assert.equal(early.rights, 1);
});

test("plan §6.1: wrong on a mastered card relapses to stage 1", () => {
  const m: ReviewState = { cardId: "c", stage: "mastered", seen: 3, rights: 2, misses: 1 };
  const s = applyResult(m, "c", "wrong", T0);
  assert.deepEqual([s.stage, s.dueAt], [1, T0 + 48 * HOUR]);
});

test("right on a never-missed card keeps it out of review", () => {
  const s = applyResult(undefined, "c", "right", T0);
  assert.equal(s.stage, 0);
  assert.equal(s.dueAt, undefined);
});

test("due and upcoming lists are sorted and disjoint", () => {
  const rs: ReviewState[] = [
    { cardId: "a", stage: 1, dueAt: T0 - 5 * HOUR, seen: 1, rights: 0, misses: 1 },
    { cardId: "b", stage: 2, dueAt: T0 - 50 * HOUR, seen: 2, rights: 1, misses: 1 },
    { cardId: "c", stage: 1, dueAt: T0 + 3 * HOUR, seen: 1, rights: 0, misses: 1 },
    { cardId: "d", stage: "mastered", seen: 3, rights: 2, misses: 1 },
    { cardId: "e", stage: 0, seen: 1, rights: 1, misses: 0 },
  ];
  assert.deepEqual(dueList(rs, T0).map((x) => x.cardId), ["b", "a"]);
  assert.deepEqual(upcomingList(rs, T0).map((x) => x.cardId), ["c"]);
});

test("relative time labels", () => {
  assert.equal(relTime(T0 + 48 * HOUR, T0), "in 2 days");
  assert.equal(relTime(T0 + 5 * HOUR, T0), "in 5 h");
  assert.equal(relTime(T0 - 3 * HOUR, T0), "overdue by 3 h");
});

test("relative time: just under 48 h still reads as 2 days", () => {
  assert.equal(relTime(T0 + 48 * HOUR - 5000, T0), "in 2 days");
  assert.equal(relTime(T0 + 72 * HOUR - 5000, T0), "in 3 days");
  assert.equal(relTime(T0 + 30 * HOUR, T0), "in 30 h");
});
