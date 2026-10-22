import type { ErrorEntry, ReviewState } from "../storage/types.ts";

/**
 * Pure sync planning (no I/O) – unit-tested in tests/unit/sync.test.ts.
 *
 * Rules (the same spirit as importing a backup – nothing is lost):
 *  - A question's progress: the copy changed most recently wins (rev = updatedAt, else lastSeenAt).
 *  - Error-log entries are never edited, only added or deleted. A deletion on any device is
 *    recorded as a tombstone and removes the entry everywhere.
 *  - Rows for questions that are not in this version of the bank stay in the account untouched.
 */

export interface RemoteReview { card_id: string; data: ReviewState; rev: number; updated_at: string }
export interface RemoteError { id: string; card_id: string; data: ErrorEntry | null; created_at: number; deleted: boolean; updated_at: string }

/** What this device last agreed with the account: used to find local changes without a full upload. */
export interface SyncMeta {
  userId: string;
  email: string;
  /** Server updated_at of the newest row pulled so far, per table (pull cursors). */
  cursor: { reviews: string | null; errors: string | null };
  /** rev of each review as last synced. */
  reviews: Record<string, number>;
  /** ids of error entries the account already has (live or deleted). */
  errors: Record<string, 1>;
  /** Local deletions not yet pushed. */
  deletedErrors: { id: string; cardId: string; createdAt: number }[];
}

export const emptyMeta = (userId: string, email: string): SyncMeta =>
  ({ userId, email, cursor: { reviews: null, errors: null }, reviews: {}, errors: {}, deletedErrors: [] });

export const rev = (r: ReviewState | undefined): number => (r ? r.updatedAt ?? r.lastSeenAt ?? 0 : 0);

export interface SyncPlan {
  /** apply on this device */
  putLocalReviews: ReviewState[];
  addLocalErrors: ErrorEntry[];
  deleteLocalErrors: string[];
  /** send to the account */
  pushReviews: { card_id: string; data: ReviewState; rev: number }[];
  pushErrors: { id: string; card_id: string; data: ErrorEntry | null; created_at: number; deleted: boolean }[];
  /** the meta to save once the push has succeeded */
  meta: SyncMeta;
}

export function planSync(
  local: { reviews: Map<string, ReviewState>; errors: ErrorEntry[] },
  pulled: { reviews: RemoteReview[]; errors: RemoteError[] },
  meta: SyncMeta,
  known: (cardId: string) => boolean,
): SyncPlan {
  const next: SyncMeta = { ...meta, reviews: { ...meta.reviews }, errors: { ...meta.errors }, deletedErrors: [] };
  const putLocalReviews: ReviewState[] = [];
  const addLocalErrors: ErrorEntry[] = [];
  const deleteLocalErrors: string[] = [];
  const pushReviews: SyncPlan["pushReviews"] = [];
  const pushErrors: SyncPlan["pushErrors"] = [];
  const cursor = { ...meta.cursor };
  const later = (k: "reviews" | "errors", t: string) => { if (!cursor[k] || t > cursor[k]!) cursor[k] = t; };

  // ---- pulled reviews: take the account's copy when it is newer than this device's
  const pulledReviewIds = new Set<string>();
  for (const r of pulled.reviews) {
    later("reviews", r.updated_at);
    pulledReviewIds.add(r.card_id);
    const mine = local.reviews.get(r.card_id);
    if (rev(mine) < r.rev) {
      if (known(r.card_id)) putLocalReviews.push({ ...r.data, cardId: r.card_id, updatedAt: r.rev });
      next.reviews[r.card_id] = r.rev;
    } else if (rev(mine) === r.rev) {
      next.reviews[r.card_id] = r.rev;
    }
    // else: this device is newer; pushed below
  }
  // ---- local reviews changed since the last sync (or never synced)
  for (const [id, r] of local.reviews) {
    const v = rev(r);
    if (next.reviews[id] === v) continue;
    if (pulledReviewIds.has(id) && putLocalReviews.some((p) => p.cardId === id)) continue;
    pushReviews.push({ card_id: id, data: r, rev: v });
    next.reviews[id] = v;
  }

  // ---- error entries
  const localIds = new Set(local.errors.map((e) => e.id));
  const tomb = new Set(meta.deletedErrors.map((t) => t.id));
  for (const e of pulled.errors) {
    later("errors", e.updated_at);
    next.errors[e.id] = 1;
    if (e.deleted) { if (localIds.has(e.id)) deleteLocalErrors.push(e.id); continue; }
    if (tomb.has(e.id) || localIds.has(e.id) || !e.data) continue;
    if (known(e.card_id)) addLocalErrors.push({ ...e.data, id: e.id, cardId: e.card_id });
  }
  for (const e of local.errors) {
    if (next.errors[e.id] || deleteLocalErrors.includes(e.id)) continue;
    pushErrors.push({ id: e.id, card_id: e.cardId, data: e, created_at: e.createdAt, deleted: false });
    next.errors[e.id] = 1;
  }
  for (const t of meta.deletedErrors) {
    pushErrors.push({ id: t.id, card_id: t.cardId, data: null, created_at: t.createdAt, deleted: true });
    next.errors[t.id] = 1;
  }

  next.cursor = cursor;
  return { putLocalReviews, addLocalErrors, deleteLocalErrors, pushReviews, pushErrors, meta: next };
}

export const planIsEmpty = (p: SyncPlan) =>
  !p.putLocalReviews.length && !p.addLocalErrors.length && !p.deleteLocalErrors.length && !p.pushReviews.length && !p.pushErrors.length;
