import type { Card, Content, Item, McqCard, Modality, PhotoCard, RevisionNote, Section, SectionId, Subject } from "./types.ts";

const OTHER: Subject[] = ["anaesthesia", "ophthalmology", "ent"];
const ALL: Subject[] = ["radiology", ...OTHER];
const CODE: Record<Subject, string> = { radiology: "RAD", anaesthesia: "ANA", ophthalmology: "OPH", ent: "ENT" };

/** Raw files as published by the pipeline. */
export interface RawBank {
  radiology: { version: number; source: string; sections: { id: string; name: string }[]; images: Record<string, { w: number; h: number }>; cards: Omit<Card, "subject">[] };
  osce: Partial<Record<Subject, { cards: any[]; notes: RevisionNote[]; images: Record<string, { w: number; h: number }> }>>;
  mcq: Partial<Record<Subject, { cards: Omit<McqCard, "section">[]; photoCards?: Omit<PhotoCard, "section">[]; images?: Record<string, { w: number; h: number }> }>>;
}

let cached: Promise<Content> | null = null;

const getJson = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`Could not load the question bank (HTTP ${r.status}).`);
  return r.json();
});

/** Load every subject's files once per session (served from the service-worker cache when offline). */
export function loadContent(base = "./content"): Promise<Content> {
  cached ??= Promise.all([
    getJson(`${base}/cards.json`),
    Promise.all(OTHER.map((s) => getJson(`${base}/osce/${s}.json`))),
    Promise.all(ALL.map((s) => getJson(`${base}/mcq/${s}.json`))),
  ]).then(([radiology, osce, mcq]) => assemble({
    radiology: validate(radiology),
    osce: Object.fromEntries(OTHER.map((s, i) => [s, osce[i]])),
    mcq: Object.fromEntries(ALL.map((s, i) => [s, mcq[i]])),
  })).catch((e) => { cached = null; throw e; });
  return cached;
}

/** Check the V1 radiology file (unique ids, every image present). */
export function validate<T extends { cards: { id: string; images: string[] }[]; sections: unknown[]; images: Record<string, unknown> }>(c: T): T {
  if (!c || !Array.isArray(c.cards) || !Array.isArray(c.sections)) throw new Error("The question bank file is damaged.");
  const ids = new Set<string>();
  for (const card of c.cards) {
    if (ids.has(card.id)) throw new Error(`Duplicate card id ${card.id}`);
    ids.add(card.id);
    for (const img of card.images) if (!c.images[img]) throw new Error(`Card ${card.id} references a missing image ${img}`);
  }
  return c;
}

const paperSection = (s: Subject, kind: "osce" | "mcq", paper: string): SectionId => `${CODE[s]} ${kind === "mcq" ? "MCQ " : ""}${paper}`;
/** "2025 Trial Set 1" -> "2025 Trial" (sets are grouped under their paper). */
const paperGroup = (paper: string) => paper.replace(/\s+Set\s+\d+$/i, "").replace(/\s+SET\s+\d+$/, "");

/** Merge all subjects into one Content (pure; used by the loader and tests). */
export function assemble(raw: RawBank): Content {
  const r = raw.radiology;
  const sections: Section[] = r.sections.map((s) => ({ id: s.id, name: s.name, subject: "radiology" as Subject, kind: "osce" as const }));
  const images: Content["images"] = { ...r.images };
  const cards: Card[] = r.cards.map((c) => ({ ...c, subject: "radiology" as Subject }));
  const notes: RevisionNote[] = [];
  const addSection = (subject: Subject, kind: "osce" | "mcq", paper: string) => {
    const id = paperSection(subject, kind, paperGroup(paper));
    if (!sections.some((x) => x.id === id)) sections.push({ id, name: paperGroup(paper), subject, kind });
    return id;
  };
  for (const s of OTHER) {
    const f = raw.osce[s];
    if (!f) continue;
    Object.assign(images, f.images);
    notes.push(...f.notes.map((n) => ({ ...n, subject: s })));
    for (const c of f.cards) {
      const sec = addSection(s, "osce", c.paper);
      cards.push({
        id: c.id, subject: s, section: sec, qNumber: c.qNumber ?? null, picture: null, images: c.images,
        answerImages: c.answerImages ?? [], stem: c.stem, prompts: c.prompts, promptSource: c.promptSource,
        answer: c.answer, refs: c.refs ?? [], altAnswers: c.altAnswers ?? [], diagnosis: c.diagnosis ?? null,
        notes: c.notes ?? [], modality: "Other" as Modality, appearsIn: c.appearsIn, inSections: [sec],
        page: c.page ?? null, textOnly: c.textOnly, noAnswer: c.noAnswer,
      });
    }
  }
  const mcqs: McqCard[] = [];
  const photos: PhotoCard[] = [];
  for (const s of ALL) {
    const f = raw.mcq[s];
    if (!f) continue;
    Object.assign(images, f.images ?? {});
    for (const c of f.cards) mcqs.push({ ...c, subject: s, section: addSection(s, "mcq", c.paper), images: c.images ?? [] });
    for (const p of f.photoCards ?? []) photos.push({ ...p, subject: s, section: addSection(s, "mcq", p.paper) });
  }
  const items = new Map<string, Item>();
  const put = (id: string, it: Item) => {
    if (items.has(id)) throw new Error(`Duplicate question id ${id}`);
    items.set(id, it);
  };
  for (const c of cards) put(c.id, { kind: "osce", card: c });
  for (const c of mcqs) put(c.id, { kind: "mcq", card: c });
  for (const c of photos) put(c.id, { kind: "photo", card: c });
  for (const it of items.values()) {
    const imgs = it.kind === "osce" ? [...it.card.images, ...(it.card.answerImages ?? [])] : it.card.images;
    for (const i of imgs) if (!images[i]) throw new Error(`${it.card.id} references a missing image ${i}`);
  }
  return { version: r.version, source: r.source, sections, images, cards, mcqs, photos, notes, items };
}

export const itemSubject = (it: Item): Subject => it.card.subject;
export const itemSection = (it: Item): SectionId => it.kind === "osce" ? it.card.section : it.card.section;
export const itemSections = (it: Item): SectionId[] => it.kind === "osce" ? it.card.inSections : [it.card.section];

/** Short label for lists (error log, review, summary). Never reveals an OSCE answer unless `reveal`. */
export function itemTitle(it: Item, reveal = true): string {
  if (it.kind === "mcq") return it.card.stem.length > 90 ? it.card.stem.slice(0, 88) + "…" : it.card.stem;
  if (it.kind === "photo") return `Paper photo · ${it.card.paper} Q${it.card.qLabel}`;
  return (reveal && it.card.diagnosis) || (it.card.prompts[0] ?? it.card.modality);
}
export function itemPlace(it: Item): string {
  if (it.kind === "osce") return it.card.appearsIn[0] ?? it.card.id;
  if (it.kind === "mcq") return `${it.card.paper} Q${it.card.qNumber}`;
  return `${it.card.paper} Q${it.card.qLabel}`;
}
export const kindLabel = (k: Item["kind"]) => k === "osce" ? "OSCE picture" : k === "mcq" ? "MCQ" : "Paper photo";

export const imageUrl = (id: string) => `./content/img/${id}.webp`;
export const thumbUrl = (id: string) => `./content/img/thumb/${id}.webp`;

export interface Filter { subject?: Subject | ""; section?: SectionId | ""; modality?: Modality | ""; query?: string }

export function filterCards(cards: Card[], f: Filter): Card[] {
  const q = (f.query ?? "").trim().toLowerCase();
  return cards.filter((c) =>
    (!f.subject || c.subject === f.subject) &&
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
