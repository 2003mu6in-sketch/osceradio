import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyMeta, planIsEmpty, planSync, rev, type RemoteError, type RemoteReview } from "../../src/sync/merge.ts";
import { friendlyError } from "../../src/sync/supabase.ts";
import type { ErrorEntry, ReviewState } from "../../src/storage/types.ts";

const R = (cardId: string, t: number, extra: Partial<ReviewState> = {}): ReviewState =>
  ({ cardId, stage: 1, dueAt: t + 1, seen: 1, rights: 0, misses: 1, lastResult: "wrong", lastSeenAt: t, updatedAt: t, ...extra });
const E = (id: string, cardId: string, t: number): ErrorEntry => ({ id, cardId, createdAt: t, kind: "mcq", tags: [], rootCause: "misread-question" });
const rr = (r: ReviewState, at = "2026-10-21T10:00:00.000+00:00"): RemoteReview => ({ card_id: r.cardId, data: r, rev: rev(r), updated_at: at });
const re = (e: ErrorEntry, deleted = false, at = "2026-10-21T10:00:00.000+00:00"): RemoteError =>
  ({ id: e.id, card_id: e.cardId, data: deleted ? null : e, created_at: e.createdAt, deleted, updated_at: at });
const all = () => true;
const local = (reviews: ReviewState[], errors: ErrorEntry[]) => ({ reviews: new Map(reviews.map((r) => [r.cardId, r])), errors });

test("first sync of a device: everything local is uploaded, everything remote is downloaded", () => {
  const p = planSync(local([R("A", 100)], [E("e1", "A", 100)]), { reviews: [rr(R("B", 50))], errors: [re(E("e2", "B", 50))] }, emptyMeta("u", "x@y"), all);
  assert.deepEqual(p.pushReviews.map((r) => r.card_id), ["A"]);
  assert.deepEqual(p.pushErrors.map((e) => e.id), ["e1"]);
  assert.deepEqual(p.putLocalReviews.map((r) => r.cardId), ["B"]);
  assert.deepEqual(p.addLocalErrors.map((e) => e.id), ["e2"]);
  assert.deepEqual(p.meta.reviews, { A: 100, B: 50 });
  assert.equal(p.meta.cursor.reviews, "2026-10-21T10:00:00.000+00:00");
});

test("the newer copy of a question's progress wins, in either direction", () => {
  const p = planSync(local([R("A", 200), R("B", 100)], []), { reviews: [rr(R("A", 150)), rr(R("B", 300, { stage: 2 }))], errors: [] }, emptyMeta("u", ""), all);
  assert.deepEqual(p.pushReviews.map((r) => [r.card_id, r.rev]), [["A", 200]]);
  assert.deepEqual(p.putLocalReviews.map((r) => [r.cardId, r.stage]), [["B", 2]]);
});

test("V1 records without updatedAt compare by lastSeenAt", () => {
  const old = { ...R("A", 500) }; delete old.updatedAt;
  assert.equal(rev(old), 500);
  const p = planSync(local([old], []), { reviews: [rr(R("A", 400))], errors: [] }, emptyMeta("u", ""), all);
  assert.equal(p.pushReviews.length, 1);
});

test("after a sync, nothing changes → nothing to send (incremental)", () => {
  const l = local([R("A", 100)], [E("e1", "A", 100)]);
  const first = planSync(l, { reviews: [], errors: [] }, emptyMeta("u", ""), all);
  const second = planSync(l, { reviews: [rr(R("A", 100))], errors: [re(E("e1", "A", 100))] }, first.meta, all);
  assert.ok(planIsEmpty(second), JSON.stringify(second));
});

test("an undo (older stage, newer change time) beats the synced answer", () => {
  const synced = R("A", 100);
  const meta = { ...emptyMeta("u", ""), reviews: { A: 100 } };
  const undone: ReviewState = { cardId: "A", stage: 0, seen: 0, rights: 0, misses: 0, updatedAt: 105 };
  const p = planSync(local([undone], []), { reviews: [rr(synced)], errors: [] }, meta, all);
  assert.deepEqual(p.pushReviews.map((r) => [r.card_id, r.data.seen]), [["A", 0]]);
  assert.equal(p.putLocalReviews.length, 0);
});

test("deleting an entry on one device removes it on the others; tombstones are pushed", () => {
  const meta = { ...emptyMeta("u", ""), errors: { e1: 1 as const }, deletedErrors: [{ id: "e2", cardId: "B", createdAt: 7 }] };
  const p = planSync(local([], [E("e1", "A", 1)]), { reviews: [], errors: [re(E("e1", "A", 1), true), re(E("e2", "B", 7))] }, meta, all);
  assert.deepEqual(p.deleteLocalErrors, ["e1"]);
  assert.equal(p.addLocalErrors.length, 0, "deleted here, so not downloaded again");
  assert.deepEqual(p.pushErrors, [{ id: "e2", card_id: "B", data: null, created_at: 7, deleted: true }]);
});

test("rows for questions missing from this version of the bank stay in the account", () => {
  const p = planSync(local([], []), { reviews: [rr(R("GONE", 9))], errors: [re(E("x", "GONE", 9))] }, emptyMeta("u", ""), (id) => id !== "GONE");
  assert.equal(p.putLocalReviews.length + p.addLocalErrors.length + p.pushReviews.length + p.pushErrors.length, 0);
});

test("Supabase errors become plain sentences", () => {
  assert.equal(friendlyError(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }).message, "Wrong email or password.");
  assert.match(friendlyError(400, { error_code: "email_not_confirmed" }).message, /Confirm your email/);
  assert.match(friendlyError(422, { error_code: "user_already_exists" }).message, /already exists/);
  assert.match(friendlyError(429, {}).message, /Too many attempts/);
  assert.match(friendlyError(422, { error_code: "weak_password", msg: "Password should be at least 8 characters." }).message, /stronger password/);
  assert.match(friendlyError(500, { message: "boom" }).message, /boom/);
});
