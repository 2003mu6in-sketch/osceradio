import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyResult, newId } from "../../src/logic/progress.ts";
import { buildDeck, deckTitle } from "../../src/logic/deck.ts";
import type { Content } from "../../src/data/types.ts";
import type { ReviewState } from "../../src/storage/types.ts";

const bank = JSON.parse(readFileSync("content/cards.json", "utf8")) as Content;

test("applyResult counts attempts and keeps the last result", () => {
  const a = applyResult(undefined, "X", "right", 1000);
  assert.deepEqual([a.seen, a.rights, a.misses, a.lastResult, a.lastSeenAt], [1, 1, 0, "right", 1000]);
  const b = applyResult(a, "X", "wrong", 2000);
  assert.deepEqual([b.seen, b.rights, b.misses, b.lastResult], [2, 1, 1, "wrong"]);
  assert.equal(a.seen, 1, "previous state is not mutated");
});

test("newId gives unique ids", () => {
  const ids = new Set(Array.from({ length: 500 }, newId));
  assert.equal(ids.size, 500);
});

test("buildDeck: paper order, unseen filter, deterministic shuffle", () => {
  const none = new Map<string, ReviewState>();
  const d2014 = buildDeck(bank.cards, none, { section: "2014" });
  assert.equal(d2014.length, bank.cards.filter((c) => c.inSections.includes("2014")).length);
  const seen = new Map<string, ReviewState>([[d2014[0].id, { cardId: d2014[0].id, stage: 0, seen: 1, rights: 1, misses: 0 }]]);
  assert.equal(buildDeck(bank.cards, seen, { section: "2014", unseenOnly: true }).length, d2014.length - 1);
  const s1 = buildDeck(bank.cards, none, { section: "2014", shuffle: true, seed: 5 }).map((c) => c.id);
  const s2 = buildDeck(bank.cards, none, { section: "2014", shuffle: true, seed: 5 }).map((c) => c.id);
  assert.deepEqual(s1, s2);
  assert.deepEqual([...s1].sort(), d2014.map((c) => c.id).sort());
});

test("deckTitle names the set", () => {
  assert.equal(deckTitle("2019 OSCE", "", false), "2019 OSCE");
  assert.equal(deckTitle(undefined, "CT", true), "CT (unseen)");
  assert.equal(deckTitle("2019 OSCE", "CT", false), "2019 OSCE · CT");
});
