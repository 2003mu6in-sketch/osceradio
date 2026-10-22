import { filterCards, itemSections, shuffle } from "../data/content.ts";
import type { Card, Content, Item, Kind, Modality, SectionId, Subject } from "../data/types.ts";
import type { ReviewState } from "../storage/types.ts";

export interface DeckOptions {
  section?: SectionId | "";
  modality?: Modality | "";
  unseenOnly?: boolean;
  shuffle?: boolean;
  seed?: number;
}

/** Cards for a study session, in paper order unless shuffled. */
export function buildDeck(cards: Card[], progress: Map<string, ReviewState>, o: DeckOptions): Card[] {
  let deck = filterCards(cards, { section: o.section, modality: o.modality });
  if (o.unseenOnly) deck = deck.filter((c) => !(progress.get(c.id)?.seen));
  return o.shuffle ? shuffle(deck, o.seed ?? Date.now()) : deck;
}

export function deckTitle(sectionName: string | undefined, modality: string | undefined, unseenOnly?: boolean): string {
  const base = sectionName ?? (modality || "All questions");
  const withMod = sectionName && modality ? `${sectionName} · ${modality}` : base;
  return unseenOnly ? `${withMod} (unseen)` : withMod;
}

/* ------------------------------------------------------------------ V2: every kind of item */

export interface ItemDeckOptions {
  subject?: Subject | "";
  kind?: Kind | "";
  section?: SectionId | "";
  modality?: Modality | "";
  unseenOnly?: boolean;
  wrongOnly?: boolean;           // only questions the student has got wrong at least once
  shuffle?: boolean;
  seed?: number;
}

/** Every item matching the filters, in bank order (OSCE, then MCQ, then paper photos) unless shuffled. */
export function itemDeck(content: Content, progress: Map<string, ReviewState>, o: ItemDeckOptions): Item[] {
  let deck = [...content.items.values()].filter((it) =>
    (!o.subject || it.card.subject === o.subject) &&
    (!o.kind || it.kind === o.kind) &&
    (!o.section || itemSections(it).includes(o.section)) &&
    (!o.modality || (it.kind === "osce" && it.card.modality === o.modality)));
  if (o.unseenOnly) deck = deck.filter((it) => !(progress.get(it.card.id)?.seen));
  if (o.wrongOnly) deck = deck.filter((it) => (progress.get(it.card.id)?.misses ?? 0) > 0);
  return o.shuffle ? shuffle(deck, o.seed ?? Date.now()) : deck;
}

const KIND_NAMES: Record<Kind, string> = { osce: "OSCE pictures", mcq: "MCQs", photo: "Paper photos" };
export const kindName = (k: Kind) => KIND_NAMES[k];

export function itemDeckTitle(subjectName: string | undefined, kind: Kind | "", sectionName: string | undefined, modality: string | undefined, o: { unseenOnly?: boolean; wrongOnly?: boolean } = {}): string {
  const parts = [subjectName, kind ? KIND_NAMES[kind] : undefined, sectionName, modality].filter(Boolean);
  const base = parts.length ? parts.join(" · ") : "All questions";
  return base + (o.wrongOnly ? " (got wrong before)" : o.unseenOnly ? " (unseen)" : "");
}
