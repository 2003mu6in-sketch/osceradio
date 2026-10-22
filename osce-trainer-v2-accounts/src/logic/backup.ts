import type { Content } from "../data/types.ts";
import { itemPlace, itemTitle } from "../data/content.ts";
import { subjectName } from "../data/types.ts";
import { ERROR_TAGS, MCQ_CAUSES, ROOT_CAUSES, causeLabel, type ErrorEntry, type ReviewState, type StudySession } from "../storage/types.ts";
import { DELAY } from "./schedule.ts";

/** Backup file format. Bump SCHEMA_VERSION and add a step to MIGRATIONS when the shape changes. */
export const APP_ID = "osce-trainer";
export const SCHEMA_VERSION = 2;

export interface Backup {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: number;
  reviews: ReviewState[];
  errors: ErrorEntry[];
  session: StudySession | null;
}

export function buildBackup(reviews: ReviewState[], errors: ErrorEntry[], session: StudySession | null, now: number): Backup {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: now, reviews, errors, session };
}

/** Upgrade steps: MIGRATIONS[n] turns a version-n backup into version n+1. */
const MIGRATIONS: Record<number, (b: any) => any> = {
  // v1 (radiology only) -> v2 (four subjects): every v1 error entry is an OSCE picture entry.
  1: (b) => ({ ...b, schemaVersion: 2, errors: Array.isArray(b.errors) ? b.errors.map((e: any) => (e && !e.kind ? { ...e, kind: "osce" } : e)) : b.errors }),
};

export class BackupError extends Error {}

/** Parse and validate a backup file's text. Throws BackupError with a message the student can act on. */
export function parseBackup(text: string): Backup {
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new BackupError("This file is not a backup from this app (it is not valid JSON)."); }
  if (!raw || raw.app !== APP_ID) throw new BackupError("This file is not a backup from the Masterpiece OSCE Trainer.");
  let v = Number(raw.schemaVersion);
  if (!Number.isInteger(v) || v < 1) throw new BackupError("This backup has no version number and cannot be read.");
  if (v > SCHEMA_VERSION) throw new BackupError("This backup was made by a newer version of the app. Update the app, then import it.");
  while (v < SCHEMA_VERSION) { raw = MIGRATIONS[v](raw); v++; }
  if (!Array.isArray(raw.reviews) || !Array.isArray(raw.errors)) throw new BackupError("This backup is damaged (progress data missing).");
  const osceCauses = new Set<string>(ROOT_CAUSES.map((r) => r.id));
  const mcqCauses = new Set<string>(MCQ_CAUSES.map((r) => r.id));
  const tags = new Set<string>(ERROR_TAGS.map((t) => t.id));
  // Entries saved on the device before V2 have no `kind`: they are OSCE picture entries.
  const errors = (raw.errors as any[]).map((e) => (e && typeof e === "object" && !e.kind ? { ...e, kind: "osce" } : e)).filter((e) => {
    if (!e || typeof e.id !== "string" || typeof e.cardId !== "string" || typeof e.createdAt !== "number" || !Array.isArray(e.tags)) return false;
    if (!e.tags.every((t: string) => tags.has(t))) return false;
    if (e.kind === "osce") return osceCauses.has(e.rootCause) && e.tags.length > 0;
    if (e.kind === "mcq" || e.kind === "photo") return mcqCauses.has(e.rootCause);
    return false;
  });
  const reviews = (raw.reviews as any[]).filter((r) =>
    r && typeof r.cardId === "string" && typeof r.seen === "number" && typeof r.misses === "number" &&
    (r.stage === 0 || r.stage === 1 || r.stage === 2 || r.stage === "mastered"));
  if (errors.length !== raw.errors.length || reviews.length !== raw.reviews.length) {
    throw new BackupError("This backup is damaged (some entries are unreadable).");
  }
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: Number(raw.exportedAt) || 0, reviews, errors, session: raw.session ?? null };
}

export interface MergePlan {
  addErrors: ErrorEntry[];
  putReviews: ReviewState[];
  session: StudySession | null;     // set only when the backup's session is newer
  skippedUnknown: number;           // entries for questions not in this version of the bank
  newErrors: number; updatedQuestions: number; newQuestions: number;
}

const lastSeen = (r?: ReviewState) => r?.lastSeenAt ?? 0;

/**
 * Merge a backup into what is on this device. Nothing is ever deleted:
 * error entries are added if their id is new; a question's progress is replaced only
 * when the backup saw it more recently.
 */
export function planMerge(
  current: { reviews: Map<string, ReviewState>; errors: ErrorEntry[]; session: StudySession | null },
  incoming: Backup, knownCards: Set<string>,
): MergePlan {
  const haveIds = new Set(current.errors.map((e) => e.id));
  let skipped = 0;
  const addErrors = incoming.errors.filter((e) => {
    if (!knownCards.has(e.cardId)) { skipped++; return false; }
    return !haveIds.has(e.id);
  });
  let updated = 0, added = 0;
  const putReviews = incoming.reviews.filter((r) => {
    if (!knownCards.has(r.cardId)) { skipped++; return false; }
    const mine = current.reviews.get(r.cardId);
    if (!mine) { added++; return true; }
    if (lastSeen(r) > lastSeen(mine)) { updated++; return true; }
    return false;
  });
  const s = incoming.session;
  const session = s && (!current.session || s.updatedAt > current.session.updatedAt) && s.order.every((id) => knownCards.has(id)) ? s : null;
  return { addErrors, putReviews, session, skippedUnknown: skipped, newErrors: addErrors.length, updatedQuestions: updated, newQuestions: added };
}

export function describePlan(p: MergePlan): string {
  if (!p.newErrors && !p.updatedQuestions && !p.newQuestions && !p.session) return "Nothing new – everything in this backup is already on this device.";
  const parts = [
    p.newErrors && `${p.newErrors} error log ${p.newErrors === 1 ? "entry" : "entries"}`,
    p.newQuestions && `progress on ${p.newQuestions} new ${p.newQuestions === 1 ? "question" : "questions"}`,
    p.updatedQuestions && `newer progress on ${p.updatedQuestions} ${p.updatedQuestions === 1 ? "question" : "questions"}`,
    p.session && "your unfinished study session",
  ].filter(Boolean);
  return `Adds ${parts.join(", ")}.` + (p.skippedUnknown ? ` ${p.skippedUnknown} item(s) for questions no longer in the bank will be skipped.` : "");
}

/* ------------------------------------------------------------------ CSV */

export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (t?: number) => (t ? new Date(t).toISOString().replace("T", " ").slice(0, 16) : "");

/** One row per error-log entry, newest first. Starts with a UTF-8 BOM so Excel reads accents correctly. */
export function errorsCsv(errors: ErrorEntry[], reviews: Map<string, ReviewState>, content: Content): string {
  const tagL = new Map(ERROR_TAGS.map((t) => [t.id, t.label]));
  const head = ["Date (UTC)", "Subject", "Type", "Question", "Paper", "Answer / diagnosis", "Modality", "Root cause", "Error types", "Your answer", "Note", "Review stage", "Next review (UTC)", "Times wrong", "Times right"];
  const rows = [...errors].sort((a, b) => b.createdAt - a.createdAt).map((e) => {
    const it = content.items.get(e.cardId), r = reviews.get(e.cardId);
    const stage = !r || r.stage === 0 ? "" : r.stage === "mastered" ? "Mastered" : r.stage === 1 ? "1st review" : "2nd review";
    const kind = e.kind ?? "osce";
    let answer = "";
    if (it?.kind === "osce") answer = it.card.diagnosis ?? "";
    else if (it?.kind === "mcq") answer = it.card.options.filter((o) => it.card.correct.includes(o.key)).map((o) => `${o.key}. ${o.text}`).join("; ");
    else if (it?.kind === "photo") answer = it.card.answerKey ? `Key: ${it.card.answerKey}` : "";
    const yours = kind === "mcq" ? (e.chosen ? `Chose ${e.chosen}` : "") : (e.typedAnswer ?? "");
    return [iso(e.createdAt), it ? subjectName(it.card.subject) : "", kind === "osce" ? "OSCE picture" : kind === "mcq" ? "MCQ" : "Paper photo",
      it && it.kind !== "osce" ? `${e.cardId} – ${itemTitle(it)}` : e.cardId, it ? itemPlace(it) : "", answer,
      it?.kind === "osce" && it.card.subject === "radiology" ? it.card.modality : "",
      causeLabel(e.rootCause), e.tags.map((t) => tagL.get(t)).join("; "), yours, e.note ?? "",
      stage, iso(r?.dueAt), r?.misses ?? "", r?.rights ?? ""];
  });
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ reminder */

export const BACKUP_EVERY = 7 * 24 * 3_600_000;

/** Show the backup reminder? Only when there is progress the last backup doesn't contain. */
export function needsBackup(o: { now: number; lastExportAt: number | null; firstActivityAt: number | null; lastActivityAt: number | null; snoozedUntil?: number | null }): boolean {
  const { now, lastExportAt, firstActivityAt, lastActivityAt } = o;
  if (lastActivityAt == null || firstActivityAt == null) return false;
  if (o.snoozedUntil && now < o.snoozedUntil) return false;
  if (lastExportAt != null && lastActivityAt <= lastExportAt) return false;            // nothing new since the backup
  if (lastExportAt == null) return now - firstActivityAt >= DELAY[1] / 2;               // first reminder after a day of use
  return now - lastExportAt >= BACKUP_EVERY;
}

export function backupFileName(now: number, ext: "json" | "csv"): string {
  const d = new Date(now).toISOString().slice(0, 10);
  return ext === "json" ? `osce-trainer-backup-${d}.json` : `osce-trainer-error-log-${d}.csv`;
}
