import { useSyncExternalStore } from "react";
import { applyResult, newId } from "../logic/progress.ts";
import { get, getAll, openDb, put, tx } from "./db.ts";
import type { ErrorEntry, ReviewState, StudySession } from "./types.ts";

/**
 * In-memory mirror of the student's progress, loaded once from IndexedDB.
 * Every Right/Wrong is written in a single transaction (review state + error entry).
 */
interface State {
  ready: boolean;
  reviews: Map<string, ReviewState>;
  errors: ErrorEntry[];          // newest first
  session: StudySession | null;
  saveError: string | null;
}
let state: State = { ready: false, reviews: new Map(), errors: [], session: null, saveError: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

/**
 * Local changes are announced to the account sync (src/sync/sync.ts), which uploads them.
 * `deleted` lists error-log entries removed on this device, so the deletion can reach other devices.
 */
export interface LocalChange { deleted?: ErrorEntry[] }
const changeHooks = new Set<(c: LocalChange) => void>();
export const onLocalChange = (fn: (c: LocalChange) => void) => { changeHooks.add(fn); return () => changeHooks.delete(fn); };
const changed = (c: LocalChange = {}) => changeHooks.forEach((h) => { try { h(c); } catch {} });

export function useProgress(): State {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
export const getProgress = () => state;

export async function loadProgress(): Promise<void> {
  try {
    const [reviews, errors, session] = await Promise.all([
      getAll<ReviewState>("reviews"), getAll<ErrorEntry>("errors"), get<StudySession>("settings", "session"),
    ]);
    set({
      ready: true,
      reviews: new Map(reviews.map((r) => [r.cardId, r])),
      errors: errors.sort((a, b) => b.createdAt - a.createdAt),
      session: session ?? null,
    });
  } catch (e) {
    set({ ready: true, saveError: (e as Error).message });
  }
}

export interface Recorded { cardId: string; prev: ReviewState | undefined; next: ReviewState; entry?: ErrorEntry; session: StudySession | null; prevSession: StudySession | null }

/** Save one Right/Wrong. Returns what is needed to undo it. */
export async function recordResult(
  cardId: string, result: "right" | "wrong", entry?: Omit<ErrorEntry, "id" | "cardId" | "createdAt">, now = Date.now(),
): Promise<Recorded> {
  if (result === "wrong" && (!entry || !entry.rootCause || ((entry.kind ?? "osce") === "osce" && entry.tags.length === 0))) {
    throw new Error("A wrong answer needs a cause (and, for picture questions, at least one error type).");
  }
  const prev = state.reviews.get(cardId);
  const next = { ...applyResult(prev, cardId, result, now), updatedAt: now };
  const full: ErrorEntry | undefined = entry && { ...entry, id: newId(), cardId, createdAt: now };
  const prevSession = state.session;
  const session = prevSession && prevSession.order[prevSession.index] === cardId
    ? { ...prevSession, index: prevSession.index + 1, results: { ...prevSession.results, [cardId]: result }, updatedAt: now }
    : prevSession;

  await tx(["reviews", "errors", "settings"], (t) => {
    t.objectStore("reviews").put(next);
    if (full) t.objectStore("errors").put(full);
    if (session) t.objectStore("settings").put(session, "session");
  });
  const reviews = new Map(state.reviews); reviews.set(cardId, next);
  set({ reviews, errors: full ? [full, ...state.errors] : state.errors, session, saveError: null });
  changed();
  return { cardId, prev, next, entry: full, session, prevSession };
}

/** Reverse the last recordResult (accidental tap). */
export async function undoResult(r: Recorded): Promise<void> {
  // The restored record gets a new change time so that sync treats the undo as the latest change.
  // A question answered for the first time goes back to a blank record (behaves exactly like "never seen").
  const back: ReviewState = { ...(r.prev ?? { cardId: r.cardId, stage: 0, seen: 0, rights: 0, misses: 0 }), updatedAt: Date.now() };
  await tx(["reviews", "errors", "settings"], (t) => {
    t.objectStore("reviews").put(back);
    if (r.entry) t.objectStore("errors").delete(r.entry.id);
    if (r.prevSession) t.objectStore("settings").put(r.prevSession, "session");
  });
  const reviews = new Map(state.reviews);
  reviews.set(r.cardId, back);
  set({ reviews, errors: r.entry ? state.errors.filter((e) => e.id !== r.entry!.id) : state.errors, session: r.prevSession });
  changed({ deleted: r.entry ? [r.entry] : [] });
}

export async function saveSession(s: StudySession | null): Promise<void> {
  set({ session: s });
  try {
    if (s) await put("settings", s, "session");
    else { const db = await openDb(); db.transaction("settings", "readwrite").objectStore("settings").delete("session"); }
  } catch (e) { set({ saveError: (e as Error).message }); }
}

/** Remove one error-log entry (the question's review schedule is left as it is). */
export async function deleteError(id: string): Promise<void> {
  const gone = state.errors.filter((e) => e.id === id);
  await tx(["errors"], (t) => t.objectStore("errors").delete(id));
  set({ errors: state.errors.filter((e) => e.id !== id) });
  changed({ deleted: gone });
}

/** Apply an import plan in one transaction (adds and newer-wins updates only; nothing is deleted). */
export async function applyImport(plan: import("../logic/backup.ts").MergePlan): Promise<void> {
  await tx(["reviews", "errors", "settings"], (t) => {
    for (const r of plan.putReviews) t.objectStore("reviews").put(r);
    for (const e of plan.addErrors) t.objectStore("errors").put(e);
    if (plan.session) t.objectStore("settings").put(plan.session, "session");
  });
  const reviews = new Map(state.reviews);
  for (const r of plan.putReviews) reviews.set(r.cardId, r);
  const errors = [...plan.addErrors, ...state.errors].sort((a, b) => b.createdAt - a.createdAt);
  set({ reviews, errors, session: plan.session ?? state.session });
  changed();
}

/** Apply changes downloaded from the student's account (does not trigger another upload). */
export async function applySync(p: { putReviews: ReviewState[]; addErrors: ErrorEntry[]; deleteErrors: string[] }): Promise<void> {
  if (!p.putReviews.length && !p.addErrors.length && !p.deleteErrors.length) return;
  await tx(["reviews", "errors"], (t) => {
    for (const r of p.putReviews) t.objectStore("reviews").put(r);
    for (const e of p.addErrors) t.objectStore("errors").put(e);
    for (const id of p.deleteErrors) t.objectStore("errors").delete(id);
  });
  const reviews = new Map(state.reviews);
  for (const r of p.putReviews) reviews.set(r.cardId, r);
  const drop = new Set(p.deleteErrors);
  const errors = [...p.addErrors, ...state.errors.filter((e) => !drop.has(e.id))].sort((a, b) => b.createdAt - a.createdAt);
  set({ reviews, errors });
}

/** Wipe progress, error log and session from this device (settings are kept). */
export async function resetProgress(): Promise<void> {
  await tx(["reviews", "errors", "settings"], (t) => {
    t.objectStore("reviews").clear();
    t.objectStore("errors").clear();
    t.objectStore("settings").delete("session");
  });
  set({ reviews: new Map(), errors: [], session: null });
}

/** First and last time the student did anything (for the backup reminder). */
export function activitySpan(): { first: number | null; last: number | null } {
  const times = [...[...state.reviews.values()].map((r) => r.lastSeenAt ?? 0), ...state.errors.map((e) => e.createdAt)].filter(Boolean);
  return times.length ? { first: Math.min(...times), last: Math.max(...times) } : { first: null, last: null };
}
