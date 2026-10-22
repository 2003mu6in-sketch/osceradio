import { test } from "node:test";
import assert from "node:assert/strict";
import { byModality, causeTotals, missRates, tagCounts, verdicts } from "../../src/logic/insights.ts";
import type { Card } from "../../src/data/types.ts";
import type { ErrorEntry, ReviewState } from "../../src/storage/types.ts";

// Fixture: 4 cards, 6 error entries. Expected values are worked out by hand in the comments.
const card = (id: string, modality: Card["modality"], diagnosis: string) => ({ id, modality, diagnosis } as Card);
const cards = new Map([
  ["us1", card("us1", "Ultrasound", "Placenta praevia")],
  ["us2", card("us2", "Ultrasound", "Hydrops fetalis")],
  ["xr1", card("xr1", "X-ray", "Sigmoid volvulus")],
  ["ct1", card("ct1", "CT", "Extradural haematoma")],
]);
let i = 0;
const e = (cardId: string, rootCause: ErrorEntry["rootCause"], tags: ErrorEntry["tags"]): ErrorEntry =>
  ({ id: `e${++i}`, cardId, createdAt: i, rootCause, tags });
const errors = [
  e("us1", "image-familiarity", ["missed-finding"]),
  e("us2", "image-familiarity", ["missed-finding", "wrong-modality"]),
  e("us1", "image-familiarity", ["misread-finding"]),
  e("xr1", "knowledge-application", ["wrong-diagnosis"]),
  e("ct1", "image-familiarity", ["missed-finding"]),
  e("xr1", "never-learnt", ["unknown-sign"]),
];

test("cause totals: 4 familiarity, 1 application, 1 never learnt", () => {
  assert.deepEqual(causeTotals(errors), { "image-familiarity": 4, "knowledge-application": 1, "never-learnt": 1, "couldnt-recall": 0, "misread-question": 0, "narrowed-two": 0 });
});

test("by modality: US 3 (all familiarity), X-ray 2 (1 app + 1 never), CT 1", () => {
  const rows = byModality(errors, cards);
  assert.deepEqual(rows.map((r) => [r.modality, r.total]), [["Ultrasound", 3], ["X-ray", 2], ["CT", 1]]);
  const z = { "couldnt-recall": 0, "misread-question": 0, "narrowed-two": 0 };
  assert.deepEqual(rows[0].causes, { "image-familiarity": 3, "knowledge-application": 0, "never-learnt": 0, ...z });
  assert.deepEqual(rows[1].causes, { "image-familiarity": 0, "knowledge-application": 1, "never-learnt": 1, ...z });
});

test("tag counts: missed finding 3, then the rest 1 each", () => {
  const t = tagCounts(errors);
  assert.deepEqual(t[0], { tag: "missed-finding", count: 3 });
  assert.equal(t.length, 5);
});

test("miss rates need 3 attempts and sort worst first", () => {
  const reviews: ReviewState[] = [
    { cardId: "us1", stage: 1, seen: 3, rights: 1, misses: 2 },
    { cardId: "us2", stage: 1, seen: 1, rights: 0, misses: 1 },   // US: 4 attempts, 3 misses = 75 %
    { cardId: "xr1", stage: 1, seen: 4, rights: 2, misses: 2 },   // X-ray: 4 attempts, 2 misses = 50 %
    { cardId: "ct1", stage: 1, seen: 2, rights: 1, misses: 1 },   // CT: 2 attempts – excluded
  ];
  const r = missRates(reviews, cards);
  assert.deepEqual(r.map((x) => [x.modality, x.attempts, x.misses, x.rate]), [["Ultrasound", 4, 3, 0.75], ["X-ray", 4, 2, 0.5]]);
});

test("verdicts: dominant cause, per-modality pattern, common error type", () => {
  const v = verdicts(errors, cards);
  assert.equal(v[0], "Most of your misses (4 of 6) are image familiarity: you are not yet reading these images confidently. Look at more normal and abnormal Ultrasound images before revising the theory.");
  assert.equal(v[1], "Ultrasound: mostly image familiarity (3 of 3).");
  assert.equal(v[2], "Your most common error type is “missed a finding” (3 of 6 entries).");
  assert.equal(v.length, 3, "X-ray (2 errors) and CT (1) are below the per-modality threshold");
});

test("verdicts: never-learnt names the diagnoses; spread when no cause reaches half", () => {
  const nl = [e("xr1", "never-learnt", ["unknown-sign"]), e("ct1", "never-learnt", ["unknown-sign"]), e("us1", "image-familiarity", ["missed-finding"])];
  assert.match(verdicts(nl, cards)[0], /never learnt\. Read up on: Sigmoid volvulus; Extradural haematoma\./);
  const spread = [e("us1", "image-familiarity", ["incomplete"]), e("xr1", "knowledge-application", ["incomplete"]), e("ct1", "never-learnt", ["missed-finding"]), e("us2", "knowledge-application", ["wrong-diagnosis"])];
  // knowledge application 2 of 4 = 50 % → still dominant
  assert.match(verdicts(spread, cards)[0], /^Most of your misses \(2 of 4\) are knowledge application/);
  const even = spread.slice(0, 3);
  assert.equal(verdicts(even, cards)[0], "Your misses are spread across causes: image familiarity 1, knowledge application 1, never learnt it 1.");
});

test("verdicts: too few entries", () => {
  assert.deepEqual(verdicts(errors.slice(0, 2), cards), ["Log at least 3 mistakes to see patterns – you have 2 so far."]);
});
