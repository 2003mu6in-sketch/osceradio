import type { Card, Modality } from "../data/types.ts";
import { ERROR_TAGS, ROOT_CAUSES, type ErrorEntry, type ErrorTag, type ReviewState, type RootCause } from "../storage/types.ts";

/** Pure analysis of the error log – no LLM, fixed rules (implementation plan §6.3). */
export const CAUSES: RootCause[] = ["image-familiarity", "knowledge-application", "never-learnt"];
export const MIN_ERRORS = 3;          // below this, no verdicts
export const MIN_ATTEMPTS = 3;        // modality miss rates need this many attempts
export type CauseCounts = Record<RootCause, number>;
const zero = (): CauseCounts => ({ "image-familiarity": 0, "knowledge-application": 0, "never-learnt": 0 });

export function causeTotals(errors: ErrorEntry[]): CauseCounts {
  const c = zero();
  for (const e of errors) c[e.rootCause]++;
  return c;
}

export interface ModalityRow { modality: Modality; total: number; causes: CauseCounts }

/** Errors per modality split by root cause, most errors first (ties: alphabetical). */
export function byModality(errors: ErrorEntry[], cards: Map<string, Card>): ModalityRow[] {
  const rows = new Map<Modality, ModalityRow>();
  for (const e of errors) {
    const m = cards.get(e.cardId)?.modality ?? "Other";
    const r = rows.get(m) ?? { modality: m, total: 0, causes: zero() };
    r.total++; r.causes[e.rootCause]++;
    rows.set(m, r);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.modality.localeCompare(b.modality));
}

export function tagCounts(errors: ErrorEntry[]): { tag: ErrorTag; count: number }[] {
  const c = new Map<ErrorTag, number>();
  for (const e of errors) for (const t of e.tags) c.set(t, (c.get(t) ?? 0) + 1);
  return ERROR_TAGS.map((t) => ({ tag: t.id, count: c.get(t.id) ?? 0 })).filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

export interface MissRate { modality: Modality; attempts: number; misses: number; rate: number }

/** Share of attempts marked wrong, per modality (from review states), worst first. */
export function missRates(reviews: Iterable<ReviewState>, cards: Map<string, Card>, minAttempts = MIN_ATTEMPTS): MissRate[] {
  const m = new Map<Modality, { a: number; w: number }>();
  for (const r of reviews) {
    const mod = cards.get(r.cardId)?.modality ?? "Other";
    const x = m.get(mod) ?? { a: 0, w: 0 };
    x.a += r.seen; x.w += r.misses;
    m.set(mod, x);
  }
  return [...m.entries()].filter(([, x]) => x.a >= minAttempts)
    .map(([modality, x]) => ({ modality, attempts: x.a, misses: x.w, rate: x.w / x.a }))
    .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts);
}

const causeName = (c: RootCause) => ROOT_CAUSES.find((r) => r.id === c)!.label.toLowerCase();
const tagName = (t: ErrorTag) => ERROR_TAGS.find((r) => r.id === t)!.label.toLowerCase();
const dominant = (c: CauseCounts): [RootCause, number] => CAUSES.map((k) => [k, c[k]] as [RootCause, number]).sort((a, b) => b[1] - a[1])[0];

/** Plain-English verdict lines. Order: overall cause, per-modality patterns, most common error type. */
export function verdicts(errors: ErrorEntry[], cards: Map<string, Card>): string[] {
  const n = errors.length;
  if (n < MIN_ERRORS) return [`Log at least ${MIN_ERRORS} mistakes to see patterns – you have ${n} so far.`];
  const out: string[] = [];
  const totals = causeTotals(errors);
  const [top, topN] = dominant(totals);
  const rows = byModality(errors, cards);
  const modFor = (c: RootCause) => rows.filter((r) => r.causes[c] > 0).sort((a, b) => b.causes[c] - a.causes[c])[0]?.modality;

  if (topN / n >= 0.5) {
    const m = modFor(top);
    if (top === "image-familiarity") {
      out.push(`Most of your misses (${topN} of ${n}) are image familiarity: you are not yet reading these images confidently. Look at more normal and abnormal ${m ? `${m} images` : "images"} before revising the theory.`);
    } else if (top === "knowledge-application") {
      out.push(`Most of your misses (${topN} of ${n}) are knowledge application: you see the findings but reach the wrong conclusion. Revise how findings link to diagnoses${m ? `, starting with ${m}` : ""}.`);
    } else {
      const dx = [...new Set(errors.filter((e) => e.rootCause === "never-learnt").map((e) => cards.get(e.cardId)?.diagnosis).filter(Boolean))].slice(0, 3);
      out.push(`Most of your misses (${topN} of ${n}) are conditions you never learnt. Read up on${dx.length ? `: ${dx.join("; ")}` : " these topics first"}.`);
    }
  } else {
    out.push(`Your misses are spread across causes: ${CAUSES.map((c) => `${causeName(c)} ${totals[c]}`).join(", ")}.`);
  }

  for (const r of rows) {
    if (r.total < MIN_ERRORS) continue;
    const [c, k] = dominant(r.causes);
    if (k / r.total >= 0.6) out.push(`${r.modality}: mostly ${causeName(c)} (${k} of ${r.total}).`);
  }

  const tags = tagCounts(errors);
  if (tags[0] && tags[0].count / n >= 0.4) out.push(`Your most common error type is “${tagName(tags[0].tag)}” (${tags[0].count} of ${n} entries).`);
  return out;
}
