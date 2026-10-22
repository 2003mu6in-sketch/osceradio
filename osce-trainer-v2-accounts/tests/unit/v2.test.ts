import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assemble, itemPlace, itemSections } from "../../src/data/content.ts";
import { itemDeck, itemDeckTitle } from "../../src/logic/deck.ts";

const j = (p: string) => JSON.parse(readFileSync(`content/${p}`, "utf8"));
const OTHER = ["anaesthesia", "ophthalmology", "ent"], ALL = ["radiology", ...OTHER];
const raw = () => ({ radiology: j("cards.json"), osce: Object.fromEntries(OTHER.map((s) => [s, j(`osce/${s}.json`)])), mcq: Object.fromEntries(ALL.map((s) => [s, j(`mcq/${s}.json`)])) }) as never;
const content = assemble(raw());

test("assemble: all four subjects, every item reachable by id", () => {
  assert.equal(content.items.size, content.cards.length + content.mcqs.length + content.photos.length);
  for (const s of ALL) {
    assert.ok(content.mcqs.some((c) => c.subject === s), `${s} has MCQs`);
    assert.ok(content.cards.some((c) => c.subject === s), `${s} has OSCE cards`);
  }
  for (const c of content.cards) for (const s of c.inSections) assert.ok(content.sections.some((x) => x.id === s), `${c.id}: section ${s}`);
});

test("assemble: every MCQ is answerable – options, accepted ⊇ correct, or flagged", () => {
  for (const c of content.mcqs) {
    if (c.type === "recall") { assert.ok((c.answerText ?? []).length > 0 || c.noKey, c.id); continue; }
    assert.ok(c.options.length >= 2, `${c.id} options`);
    assert.ok(c.noKey || c.correct.length > 0, `${c.id} key`);
    for (const k of c.correct) assert.ok(c.accepted.includes(k) && c.options.some((o) => o.key === k), `${c.id} key ${k}`);
  }
});

test("assemble: radiology V1 card ids are unchanged (progress survives the upgrade)", () => {
  const v1 = j("cards.json").cards.map((c: { id: string }) => c.id);
  for (const id of v1) assert.equal(content.items.get(id)?.kind, "osce", id);
});

test("assemble rejects a duplicate id across subjects", () => {
  const r = raw() as any;
  r.mcq.ent.cards.push(r.mcq.radiology.cards[0]);
  assert.throws(() => assemble(r), /Duplicate/);
});

test("itemDeck filters by subject, kind and paper; wrong-only uses misses", () => {
  const ana = itemDeck(content, new Map(), { subject: "anaesthesia", kind: "mcq" });
  assert.ok(ana.length > 0 && ana.every((it) => it.kind === "mcq" && it.card.subject === "anaesthesia"));
  const sec = ana[0].card.section;
  const one = itemDeck(content, new Map(), { subject: "anaesthesia", kind: "mcq", section: sec });
  assert.ok(one.every((it) => itemSections(it).includes(sec)) && one.length < ana.length);
  const id = ana[3].card.id;
  const prog = new Map([[id, { cardId: id, stage: 1, dueAt: 0, misses: 1, attempts: 1, seen: true, lastResult: "wrong" }]]) as never;
  assert.deepEqual(itemDeck(content, prog, { subject: "anaesthesia", wrongOnly: true }).map((it) => it.card.id), [id]);
  assert.equal(itemDeck(content, prog, { subject: "anaesthesia", kind: "mcq", unseenOnly: true }).length, ana.length - 1);
  const a = itemDeck(content, new Map(), { subject: "ent", shuffle: true, seed: 7 }).map((it) => it.card.id);
  const b = itemDeck(content, new Map(), { subject: "ent", shuffle: true, seed: 7 }).map((it) => it.card.id);
  assert.deepEqual(a, b);
});

test("deck titles and places read naturally", () => {
  assert.equal(itemDeckTitle("ENT", "mcq", undefined, undefined, { wrongOnly: true }), "ENT · MCQs (got wrong before)");
  assert.equal(itemDeckTitle(undefined, "", undefined, undefined), "All questions");
  const m = content.mcqs[0];
  assert.match(itemPlace({ kind: "mcq", card: m }), new RegExp(`Q${m.qNumber}`));
});
