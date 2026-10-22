import { useSyncExternalStore } from "react";
import { applySync, getProgress, onLocalChange, resetProgress } from "../storage/progress.ts";
import { emptyMeta, planSync, type RemoteError, type RemoteReview, type SyncMeta } from "./merge.ts";
import { ApiError, accessToken, accountsEnabled, call, getAuth, onAuthChange, signOut } from "./supabase.ts";

/**
 * Account sync: keeps this device's progress and error log in step with the student's Supabase account.
 * The device stays the source of truth while offline; sync runs a few seconds after each answer,
 * when the app is reopened or comes back online, and every few minutes while open.
 */
export type SyncStatus = "off" | "signed-out" | "idle" | "syncing" | "offline" | "error" | "choose";
export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  /** status "choose": this device holds progress from another account (that account's email). */
  otherEmail?: string;
}

const META_KEY = "osce-sync-meta";
let state: SyncState = { status: accountsEnabled() ? "signed-out" : "off", lastSyncedAt: null, error: null };
const listeners = new Set<() => void>();
const emit = (p: Partial<SyncState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
export const useSync = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
export const getSync = () => state;

function loadMeta(): SyncMeta | null {
  try { const m = JSON.parse(localStorage.getItem(META_KEY) ?? "null"); return m && m.userId && m.cursor && typeof m.cursor === "object" ? m : null; } catch { return null; }
}
function saveMeta(m: SyncMeta | null) {
  try { if (m) localStorage.setItem(META_KEY, JSON.stringify(m)); else localStorage.removeItem(META_KEY); } catch {}
}

/* ------------------------------------------------------------------ REST helpers */

const PAGE = 1000;
const margin = (c: string | null) => (c ? new Date(new Date(c).getTime() - 5000).toISOString() : null);

async function pullAll<T>(table: string, select: string, since: string | null, token: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = `select=${select}&order=updated_at.asc${since ? `&updated_at=gte.${encodeURIComponent(since)}` : ""}&limit=${PAGE}&offset=${offset}`;
    const page = await call<T[]>(`/rest/v1/${table}?${q}`, { token });
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function upsert(table: string, conflict: string, rows: object[], token: string) {
  for (let i = 0; i < rows.length; i += 500) {
    await call(`/rest/v1/${table}?on_conflict=${conflict}`, {
      body: rows.slice(i, i + 500), token, headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
  }
}

/* ------------------------------------------------------------------ the sync run */

let known: (cardId: string) => boolean = () => true;
let running = false, again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 15_000;

export function scheduleSync(delay = 2500) {
  clearTimeout(timer);
  timer = setTimeout(() => { void syncNow(); }, delay);
}

export async function syncNow(): Promise<void> {
  const user = getAuth().user;
  if (!accountsEnabled()) return emit({ status: "off" });
  if (!user) return emit({ status: "signed-out", error: null });
  if (running) { again = true; return; }
  if (!getProgress().ready) { scheduleSync(500); return; }

  let meta = loadMeta();
  if (meta && meta.userId !== user.id) {
    const p = getProgress();
    if (p.reviews.size || p.errors.length) return emit({ status: "choose", otherEmail: meta.email });
    meta = null;
  }
  meta ??= emptyMeta(user.id, user.email);

  running = true;
  emit({ status: "syncing", error: null });
  try {
    const token = await accessToken();
    const [reviews, errors] = await Promise.all([
      pullAll<RemoteReview>("reviews", "card_id,data,rev,updated_at", margin(meta.cursor.reviews), token),
      pullAll<RemoteError>("error_entries", "id,card_id,data,created_at,deleted,updated_at", margin(meta.cursor.errors), token),
    ]);
    const local = getProgress();
    const plan = planSync(local, { reviews, errors }, meta, known);
    await applySync({ putReviews: plan.putLocalReviews, addErrors: plan.addLocalErrors, deleteErrors: plan.deleteLocalErrors });
    if (plan.pushReviews.length) await upsert("reviews", "user_id,card_id", plan.pushReviews, token);
    if (plan.pushErrors.length) await upsert("error_entries", "user_id,id", plan.pushErrors, token);
    // deletions made while this run was in flight stay queued for the next run
    const pushed = new Set(meta.deletedErrors.map((t) => t.id));
    const queued = (loadMeta()?.deletedErrors ?? []).filter((t) => !pushed.has(t.id));
    saveMeta({ ...plan.meta, deletedErrors: queued });
    retryDelay = 15_000;
    emit({ status: "idle", lastSyncedAt: Date.now(), error: null });
    if (queued.length) again = true;
  } catch (e) {
    const err = e as ApiError;
    if (!getAuth().user) emit({ status: "signed-out" });
    else if (err.offline) emit({ status: "offline", error: null });
    else { emit({ status: "error", error: err.message }); scheduleSync(retryDelay); retryDelay = Math.min(retryDelay * 2, 10 * 60_000); }
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(300); }
  }
}

/** This device has another account's progress: add it to the signed-in account, or clear it first. */
export async function resolveOtherAccount(choice: "merge" | "clear"): Promise<void> {
  const user = getAuth().user;
  if (!user) return;
  if (choice === "clear") await resetProgress();
  saveMeta(emptyMeta(user.id, user.email));
  emit({ status: "idle", otherEmail: undefined });
  await syncNow();
}

/** Delete this account's synced progress (Settings → Delete all progress, while signed in). */
export async function wipeAccountProgress(): Promise<void> {
  const user = getAuth().user;
  if (!user) return;
  const token = await accessToken();
  const f = `user_id=eq.${user.id}`;
  await call(`/rest/v1/reviews?${f}`, { method: "DELETE", token, headers: { Prefer: "return=minimal" } });
  await call(`/rest/v1/error_entries?${f}`, { method: "DELETE", token, headers: { Prefer: "return=minimal" } });
  saveMeta(emptyMeta(user.id, user.email));
}

/** Sign out; optionally remove this account's progress from the device (shared computers). */
export async function signOutAndMaybeClear(clearDevice: boolean): Promise<void> {
  if (clearDevice) { await resetProgress(); saveMeta(null); }
  await signOut();
  emit({ status: "signed-out", lastSyncedAt: null, error: null, otherEmail: undefined });
}

/** After the account is deleted the device keeps its progress, signed out. */
export function forgetAccount() { saveMeta(null); emit({ status: "signed-out", lastSyncedAt: null, error: null }); }

let started = false;
/** Start once the question bank is loaded (sync skips rows for questions this version doesn't have). */
export function startSync(isKnown: (cardId: string) => boolean) {
  known = isKnown;
  if (started || !accountsEnabled()) return;
  started = true;
  onLocalChange((c) => {
    if (!getAuth().user) return;
    if (c.deleted?.length) {
      const m = loadMeta();
      if (m) { m.deletedErrors = [...m.deletedErrors, ...c.deleted.map((e) => ({ id: e.id, cardId: e.cardId, createdAt: e.createdAt }))]; saveMeta(m); }
    }
    scheduleSync(2500);
  });
  let lastUser = getAuth().user?.id ?? null;
  onAuthChange(() => {
    const id = getAuth().user?.id ?? null;
    if (id === lastUser) return;
    lastUser = id;
    if (id) scheduleSync(0); else emit({ status: "signed-out" });
  });
  window.addEventListener("online", () => scheduleSync(0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - (state.lastSyncedAt ?? 0) > 30_000) scheduleSync(0);
  });
  setInterval(() => { if (document.visibilityState === "visible" && getAuth().user) scheduleSync(0); }, 5 * 60_000);
  if (getAuth().user) scheduleSync(0);
}
