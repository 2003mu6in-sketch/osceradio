import type { ReviewState, Stage } from "../storage/types.ts";

/**
 * Spaced review rules (implementation plan §6.1):
 *   Wrong (any stage)            → stage 1, due in 48 h, misses + 1
 *   Right on a DUE stage-1 card  → stage 2, due in 72 h
 *   Right on a DUE stage-2 card  → mastered (no due date)
 *   Right when not due / stage 0 / mastered → recorded, stage unchanged
 *   Wrong on a mastered card     → back to stage 1 (relapse)
 */
export const HOUR = 3_600_000;
export const DELAY: Record<1 | 2, number> = { 1: 48 * HOUR, 2: 72 * HOUR };

export function isDue(s: ReviewState | undefined, now: number): boolean {
  return !!s && (s.stage === 1 || s.stage === 2) && s.dueAt != null && s.dueAt <= now;
}

export function schedule(s: ReviewState, result: "right" | "wrong", now: number): Pick<ReviewState, "stage" | "dueAt"> {
  if (result === "wrong") return { stage: 1, dueAt: now + DELAY[1] };
  if (isDue(s, now)) {
    return s.stage === 1 ? { stage: 2, dueAt: now + DELAY[2] } : { stage: "mastered", dueAt: undefined };
  }
  return { stage: s.stage, dueAt: s.dueAt };
}

export interface DueItem { cardId: string; stage: Stage; dueAt: number }

/** Cards due now, oldest due first. */
export function dueList(reviews: Iterable<ReviewState>, now: number): DueItem[] {
  return [...reviews].filter((r) => isDue(r, now)).map((r) => ({ cardId: r.cardId, stage: r.stage, dueAt: r.dueAt! }))
    .sort((a, b) => a.dueAt - b.dueAt);
}

/** Scheduled but not yet due, soonest first. */
export function upcomingList(reviews: Iterable<ReviewState>, now: number): DueItem[] {
  return [...reviews].filter((r) => (r.stage === 1 || r.stage === 2) && r.dueAt != null && r.dueAt > now)
    .map((r) => ({ cardId: r.cardId, stage: r.stage, dueAt: r.dueAt! })).sort((a, b) => a.dueAt - b.dueAt);
}

export function stageLabel(stage: Stage): string {
  return stage === 1 ? "1st review" : stage === 2 ? "2nd review" : stage === "mastered" ? "Mastered" : "New";
}

/** "in 2 days", "in 5 h", "overdue by 3 h" … */
export function relTime(t: number, now: number): string {
  const d = t - now, abs = Math.abs(d);
  const txt = abs >= 36 * HOUR ? `${Math.round(abs / (24 * HOUR))} days` : abs >= HOUR ? `${Math.round(abs / HOUR)} h` : `${Math.max(1, Math.round(abs / 60_000))} min`;
  return d >= 0 ? `in ${txt}` : `overdue by ${txt}`;
}
