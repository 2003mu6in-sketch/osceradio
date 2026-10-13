import type { Card, Content, Modality, SectionId } from "./types.ts";

let cached: Promise<Content> | null = null;

/** Load cards.json once per session (served from the service-worker cache when offline). */
export function loadContent(url = "./content/cards.json"): Promise<Content> {
  cached ??= fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not load the question bank (HTTP ${r.status}).`);
    return r.json() as Promise<Content>;
  }).then(validate).catch((e) => { cached = null; throw e; });
  return cached;
}

export function validate(c: Content): Content {
  if (!c || !Array.isArray(c.cards) || !Array.isArray(c.sections)) throw new Error("The question bank file is damaged.");
  const ids = new Set<string>();
  for (const card of c.cards) {
    if (ids.has(card.id)) throw new Error(`Duplicate card id ${card.id}`);
    ids.add(card.id);
    for (const img of card.images) if (!c.images[img]) throw new Error(`Card ${card.id} references a missing image ${img}`);
  }
  return c;
}

export const imageUrl = (id: string) => `./content/img/${id}.webp`;
export const thumbUrl = (id: string) => `./content/img/thumb/${id}.webp`;

export interface Filter { section?: SectionId | ""; modality?: Modality | ""; query?: string }

export function filterCards(cards: Card[], f: Filter): Card[] {
  const q = (f.query ?? "").trim().toLowerCase();
  return cards.filter((c) =>
    (!f.section || c.inSections.includes(f.section)) &&
    (!f.modality || c.modality === f.modality) &&
    (!q || searchText(c).includes(q)));
}

const searchCache = new WeakMap<Card, string>();
function searchText(c: Card): string {
  let s = searchCache.get(c);
  if (!s) {
    s = [c.id, c.diagnosis, c.modality, c.stem, ...c.prompts, ...c.answer, ...c.appearsIn].join(" ").toLowerCase();
    searchCache.set(c, s);
  }
  return s;
}

export function countBy<K extends string>(cards: Card[], key: (c: Card) => K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const c of cards) for (const k of key(c)) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/** Deterministic shuffle (mulberry32) so a study session can be resumed in the same order. */
export function shuffle<T>(items: T[], seed: number): T[] {
  const a = items.slice();
  let t = seed >>> 0;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Split answer text into display lines: questions repeated inline, "Ans:" lines, and plain lines. */
export type AnswerLine = { kind: "question" | "answer" | "text"; text: string };
export function answerLines(lines: string[], prompts: string[]): AnswerLine[] {
  const ps = new Set(prompts.map((p) => p.trim()));
  return lines.map((l): AnswerLine => {
    if (ps.has(l.trim())) return { kind: "question", text: l };
    const m = /^ans\b\s*[:;]?\s*/i.exec(l);
    if (m) return { kind: "answer", text: l.slice(m[0].length) };
    return { kind: "text", text: l };
  }).filter((l) => l.text.trim() || l.kind === "answer");
}
