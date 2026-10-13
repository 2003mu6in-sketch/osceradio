/** Student data, stored only on the device (IndexedDB). */
export type ErrorTag =
  | "wrong-modality" | "missed-finding" | "misread-finding"
  | "wrong-diagnosis" | "unknown-sign" | "incomplete";

export type RootCause = "image-familiarity" | "knowledge-application" | "never-learnt";

export const ERROR_TAGS: { id: ErrorTag; label: string; hint: string }[] = [
  { id: "wrong-modality", label: "Wrong modality or view", hint: "Named the wrong study, projection or window" },
  { id: "missed-finding", label: "Missed a finding", hint: "Didn't see something that was there" },
  { id: "misread-finding", label: "Misread a finding", hint: "Saw it but described it wrongly" },
  { id: "wrong-diagnosis", label: "Wrong diagnosis", hint: "Findings right, conclusion wrong" },
  { id: "unknown-sign", label: "Didn't know the sign or name", hint: "e.g. coffee bean, Rigler's, sail sign" },
  { id: "incomplete", label: "Incomplete answer", hint: "Right idea, missing parts or differentials" },
];

export const ROOT_CAUSES: { id: RootCause; key: string; label: string; hint: string }[] = [
  { id: "image-familiarity", key: "F", label: "Image familiarity", hint: "I couldn't read this kind of image or modality" },
  { id: "knowledge-application", key: "A", label: "Knowledge application", hint: "I saw the finding but drew the wrong conclusion" },
  { id: "never-learnt", key: "N", label: "Never learnt it", hint: "I didn't know this condition" },
];

export interface ErrorEntry {
  id: string;
  cardId: string;
  createdAt: number;
  tags: ErrorTag[];          // at least one
  rootCause: RootCause;      // required
  typedAnswer?: string;      // from the optional box before reveal
  note?: string;
}

/** Review stage: 0 = never missed; 1 = due 48 h after a miss; 2 = due 72 h after passing stage 1. */
export type Stage = 0 | 1 | 2 | "mastered";

export interface ReviewState {
  cardId: string;
  stage: Stage;
  dueAt?: number;
  seen: number;
  rights: number;
  misses: number;
  lastResult?: "right" | "wrong";
  lastSeenAt?: number;
}

/** A study session that can be resumed from the home screen. */
export interface StudySession {
  id: string;
  title: string;
  filter: { section?: string; modality?: string; unseenOnly?: boolean; retryOf?: string; review?: boolean };
  order: string[];            // card ids in study order
  index: number;              // next card to show
  results: Record<string, "right" | "wrong">;
  startedAt: number;
  updatedAt: number;
}
