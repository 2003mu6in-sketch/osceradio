import { filterCards, shuffle } from "../data/content.ts";
import type { Card, Modality, SectionId } from "../data/types.ts";
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
