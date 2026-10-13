import type { ReviewState } from "../storage/types.ts";
import { schedule } from "./schedule.ts";

/**
 * Pure update of a card's progress after the student marks it.
 * Counts the attempt and applies the 48 h / 72 h review schedule (see schedule.ts).
 */
export function applyResult(prev: ReviewState | undefined, cardId: string, result: "right" | "wrong", now: number): ReviewState {
  const base: ReviewState = prev ?? { cardId, stage: 0, seen: 0, rights: 0, misses: 0 };
  return {
    ...base,
    ...schedule(base, result, now),
    seen: base.seen + 1,
    rights: base.rights + (result === "right" ? 1 : 0),
    misses: base.misses + (result === "wrong" ? 1 : 0),
    lastResult: result,
    lastSeenAt: now,
  };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
