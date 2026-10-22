/** Student data, stored only on the device (IndexedDB). */
export type ErrorTag =
  | "wrong-modality" | "missed-finding" | "misread-finding"
  | "wrong-diagnosis" | "unknown-sign" | "incomplete";

/** OSCE causes (F/A/N) and MCQ causes (N/R/M/T). "never-learnt" is shared. */
export type OsceCause = "image-familiarity" | "knowledge-application" | "never-learnt";
export type McqCause = "never-learnt" | "couldnt-recall" | "misread-question" | "narrowed-two";
export type RootCause = OsceCause | McqCause;

export const ERROR_TAGS: { id: ErrorTag; label: string; hint: string }[] = [
  { id: "wrong-modality", label: "Wrong modality or view", hint: "Named the wrong study, projection or window" },
  { id: "missed-finding", label: "Missed a finding", hint: "Didn't see something that was there" },
  { id: "misread-finding", label: "Misread a finding", hint: "Saw it but described it wrongly" },
  { id: "wrong-diagnosis", label: "Wrong diagnosis", hint: "Findings right, conclusion wrong" },
  { id: "unknown-sign", label: "Didn't know the sign or name", hint: "e.g. coffee bean, Rigler's, sail sign" },
  { id: "incomplete", label: "Incomplete answer", hint: "Right idea, missing parts or differentials" },
];

export const ROOT_CAUSES: { id: OsceCause; key: string; label: string; hint: string }[] = [
  { id: "image-familiarity", key: "F", label: "Image familiarity", hint: "I couldn't read this kind of image or modality" },
  { id: "knowledge-application", key: "A", label: "Knowledge application", hint: "I saw the finding but drew the wrong conclusion" },
  { id: "never-learnt", key: "N", label: "Never learnt it", hint: "I didn't know this condition" },
];

export const MCQ_CAUSES: { id: McqCause; key: string; label: string; hint: string }[] = [
  { id: "never-learnt", key: "N", label: "Never learnt it", hint: "I didn't know this topic" },
  { id: "couldnt-recall", key: "R", label: "Couldn't recall", hint: "I've learnt it but it didn't come back" },
  { id: "misread-question", key: "M", label: "Misread the question", hint: "Missed EXCEPT / NOT / FALSE, or a key word" },
  { id: "narrowed-two", key: "T", label: "Narrowed to two, picked wrong", hint: "Got it down to two options" },
];

/** Every cause with its label, for logs, filters and CSV. */
export const ALL_CAUSES: { id: RootCause; label: string }[] = [
  ...ROOT_CAUSES.map(({ id, label }) => ({ id: id as RootCause, label })),
  ...MCQ_CAUSES.filter((c) => c.id !== "never-learnt").map(({ id, label }) => ({ id: id as RootCause, label })),
];
export const causeLabel = (c: RootCause) => ALL_CAUSES.find((x) => x.id === c)?.label ?? c;

export type EntryKind = "osce" | "mcq" | "photo";

export interface ErrorEntry {
  id: string;
  cardId: string;
  createdAt: number;
  kind?: EntryKind;          // missing in V1 entries = "osce"
  tags: ErrorTag[];          // at least one for OSCE entries; empty for MCQ / photo entries
  rootCause: RootCause;      // required
  chosen?: string;           // MCQ: the option the student tapped
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
  /** When this record last changed on any device (ms). Used by account sync: newest wins. */
  updatedAt?: number;
}

/** A study session that can be resumed from the home screen. */
export interface StudySession {
  id: string;
  title: string;
  filter: { subject?: string; kind?: string; section?: string; modality?: string; unseenOnly?: boolean; wrongOnly?: boolean; retryOf?: string; review?: boolean };
  order: string[];            // card ids in study order
  index: number;              // next card to show
  results: Record<string, "right" | "wrong">;
  startedAt: number;
  updatedAt: number;
}
