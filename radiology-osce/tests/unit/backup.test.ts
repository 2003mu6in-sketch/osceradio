import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKUP_EVERY, BackupError, buildBackup, csvCell, describePlan, errorsCsv, needsBackup, parseBackup, planMerge } from "../../src/logic/backup.ts";
import type { Content } from "../../src/data/types.ts";
import type { ErrorEntry, ReviewState } from "../../src/storage/types.ts";

const bank = JSON.parse(readFileSync("content/cards.json", "utf8")) as Content;
const known = new Set(bank.cards.map((c) => c.id));
const H = 3_600_000, T = Date.UTC(2026, 9, 1);
const err = (id: string, cardId: string, at: number, extra: Partial<ErrorEntry> = {}): ErrorEntry =>
  ({ id, cardId, createdAt: at, tags: ["missed-finding"], rootCause: "image-familiarity", ...extra });
const rev = (cardId: string, lastSeenAt: number, extra: Partial<ReviewState> = {}): ReviewState =>
  ({ cardId, stage: 1, dueAt: lastSeenAt + 48 * H, seen: 1, rights: 0, misses: 1, lastResult: "wrong", lastSeenAt, ...extra });

test("backup round-trips through JSON unchanged", () => {
  const b = buildBackup([rev("70W-Q04", T)], [err("a", "70W-Q04", T, { note: 'said "double bubble", wrong' })], null, T + H);
  assert.deepEqual(parseBackup(JSON.stringify(b)), b);
});

test("parseBackup rejects other files with an actionable message", () => {
  assert.throws(() => parseBackup("not json"), (e: Error) => e instanceof BackupError && /not valid JSON/.test(e.message));
  assert.throws(() => parseBackup('{"app":"other"}'), /not a backup from the Radiology OSCE Trainer/);
  assert.throws(() => parseBackup(JSON.stringify({ ...buildBackup([], [], null, T), schemaVersion: 99 })), /newer version of the app/);
  const bad = buildBackup([], [err("a", "70W-Q04", T, { rootCause: "bogus" as never })], null, T);
  assert.throws(() => parseBackup(JSON.stringify(bad)), /damaged/);
});

test("merge: new entries added, duplicates ignored, newest progress wins, nothing deleted", () => {
  const current = {
    reviews: new Map([["70W-Q04", rev("70W-Q04", T + 10 * H)], ["70W-Q18", rev("70W-Q18", T + 10 * H)]]),
    errors: [err("a", "70W-Q04", T)],
    session: null,
  };
  const incoming = buildBackup(
    [rev("70W-Q04", T + 5 * H, { misses: 9 }),            // older than mine → keep mine
     rev("70W-Q18", T + 20 * H, { stage: 2 }),            // newer → take it
     rev("2019-Q01", T + 1 * H),                          // new question
     rev("GONE-Q1", T + 1 * H)],                          // not in this bank → skipped
    [err("a", "70W-Q04", T), err("b", "70W-Q18", T + 2 * H), err("c", "GONE-Q1", T)],
    null, T + 30 * H);
  const p = planMerge(current, incoming, known);
  assert.deepEqual(p.addErrors.map((e) => e.id), ["b"]);
  assert.deepEqual(p.putReviews.map((r) => r.cardId), ["70W-Q18", "2019-Q01"]);
  assert.deepEqual([p.newErrors, p.updatedQuestions, p.newQuestions, p.skippedUnknown], [1, 1, 1, 2]);
  assert.equal(describePlan(p), "Adds 1 error log entry, progress on 1 new question, newer progress on 1 question. 2 item(s) for questions no longer in the bank will be skipped.");
});

test("merge of the same backup twice adds nothing", () => {
  const b = buildBackup([rev("70W-Q04", T)], [err("a", "70W-Q04", T)], null, T);
  const p = planMerge({ reviews: new Map([["70W-Q04", rev("70W-Q04", T)]]), errors: [err("a", "70W-Q04", T)], session: null }, b, known);
  assert.equal(describePlan(p), "Nothing new – everything in this backup is already on this device.");
});

test("CSV cells: quotes, commas and newlines are escaped (RFC 4180)", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('said "x", then'), '"said ""x"", then"');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell(undefined), "");
});

test("error log CSV: header, one row per entry, newest first, Excel BOM", () => {
  const csv = errorsCsv([err("a", "70W-Q04", T, { note: "coffee bean, inverted" }), err("b", "2019-Q01", T + H, { tags: ["missed-finding", "wrong-diagnosis"] })],
    new Map([["70W-Q04", rev("70W-Q04", T)]]), bank);
  assert.ok(csv.startsWith("﻿Date (UTC),Question,Paper,Diagnosis,Modality,Root cause"));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^2026-10-01 01:00,2019-Q01,2019 OSCE,/);
  assert.match(lines[1], /Missed a finding; Wrong diagnosis/);
  assert.match(lines[2], /70W-Q04,70 Ways to Akorli Kingdom,Sigmoid Volvulus,X-ray,Image familiarity,Missed a finding,,"coffee bean, inverted",1st review,/);
});

test("backup reminder: after a day of first use, then weekly, only when something is new", () => {
  const base = { firstActivityAt: T, lastActivityAt: T + 2 * H };
  assert.equal(needsBackup({ ...base, now: T + 3 * H, lastExportAt: null }), false, "too early");
  assert.equal(needsBackup({ ...base, now: T + 25 * H, lastExportAt: null }), true, "a day of use, never backed up");
  assert.equal(needsBackup({ ...base, now: T + 25 * H, lastExportAt: null, snoozedUntil: T + 30 * H }), false, "snoozed");
  assert.equal(needsBackup({ ...base, now: T + 9 * 24 * H, lastExportAt: T + 3 * H }), false, "nothing new since backup");
  assert.equal(needsBackup({ firstActivityAt: T, lastActivityAt: T + 5 * H, now: T + 3 * H + BACKUP_EVERY, lastExportAt: T + 3 * H }), true, "week old + new progress");
  assert.equal(needsBackup({ firstActivityAt: T, lastActivityAt: T + 5 * H, now: T + 4 * H, lastExportAt: T + 3 * H }), false, "recent backup");
  assert.equal(needsBackup({ firstActivityAt: null, lastActivityAt: null, now: T, lastExportAt: null }), false, "no progress");
});
