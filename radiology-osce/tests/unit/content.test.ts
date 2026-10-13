import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { answerLines, countBy, filterCards, shuffle, validate } from "../../src/data/content.ts";
import { parse } from "../../src/lib/router.ts";
import type { Content } from "../../src/data/types.ts";

const bank = JSON.parse(readFileSync("content/cards.json", "utf8")) as Content;

test("question bank is valid and every image file exists", () => {
  validate(bank);
  for (const id of Object.keys(bank.images)) {
    assert.ok(existsSync(`content/img/${id}.webp`), `missing content/img/${id}.webp`);
    assert.ok(existsSync(`content/img/thumb/${id}.webp`), `missing thumbnail for ${id}`);
  }
});

test("every card can be studied: prompts, and an answer or an explicit no-answer flag", () => {
  for (const c of bank.cards) {
    assert.ok(c.prompts.length > 0, `${c.id} has no prompts`);
    assert.ok(c.answer.length > 0 || c.noAnswer, `${c.id} has no answer and no flag`);
    assert.ok(c.inSections.includes(c.section), `${c.id} not in its own section`);
    assert.equal(c.appearsIn.length >= 1, true);
  }
});

test("card ids are stable keys (pattern SECTION-…)", () => {
  for (const c of bank.cards) assert.match(c.id, /^(70W|30R|2025|TIPS|2023|2021|2019|2018|2017|2016|2015|2014)-/);
});

test("validate rejects duplicate ids and missing images", () => {
  const card = bank.cards[0];
  assert.throws(() => validate({ ...bank, cards: [card, card] }), /Duplicate/);
  assert.throws(() => validate({ ...bank, images: {}, cards: [card] }), /missing image/);
});

test("filter by paper includes merged repeats", () => {
  const in2021 = filterCards(bank.cards, { section: "2021" });
  assert.equal(in2021.length, countBy(bank.cards, (c) => c.inSections)["2021"]);
  assert.ok(in2021.some((c) => c.section === "2017"), "2021 slides live on 2017 cards");
  assert.ok(filterCards(bank.cards, { query: "achalasia" }).length >= 3);
  assert.ok(filterCards(bank.cards, { modality: "MRI" }).every((c) => c.modality === "MRI"));
});

test("shuffle is a deterministic permutation", () => {
  const ids = bank.cards.map((c) => c.id);
  const a = shuffle(ids, 42), b = shuffle(ids, 42), c = shuffle(ids, 7);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual([...a].sort(), [...ids].sort());
});

test("answer lines separate repeated questions and Ans: lines", () => {
  const out = answerLines(["1. What is it?", "Ans: Achalasia", "Note"], ["1. What is it?"]);
  assert.deepEqual(out.map((l) => l.kind), ["question", "answer", "text"]);
  assert.equal(out[1].text, "Achalasia");
});

test("hash routes parse path and query", () => {
  const r = parse("#/card/2017-Q13?section=2021&q=bird%20beak");
  assert.deepEqual(r.parts, ["card", "2017-Q13"]);
  assert.equal(r.query.get("section"), "2021");
  assert.equal(r.query.get("q"), "bird beak");
  assert.equal(parse("").path, "/");
});
