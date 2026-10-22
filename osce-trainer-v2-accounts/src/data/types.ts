/** Content produced by the pipeline (content/*.json). Read-only in the app. */

export type Subject = "radiology" | "anaesthesia" | "ophthalmology" | "ent";
export const SUBJECTS: { id: Subject; name: string; short: string }[] = [
  { id: "radiology", name: "Radiology", short: "Radiology" },
  { id: "anaesthesia", name: "Anaesthesia", short: "Anaesthesia" },
  { id: "ophthalmology", name: "Ophthalmology", short: "Ophthalmology" },
  { id: "ent", name: "ENT", short: "ENT" },
];
export const subjectName = (s: Subject) => SUBJECTS.find((x) => x.id === s)?.name ?? s;

/** Kinds of study item. "osce" = picture/station card (reveal, self-mark); "mcq" = tap an option; "photo" = photographed paper (reveal key, self-mark). */
export type Kind = "osce" | "mcq" | "photo";

/** Radiology V1 section ids, or "<CODE> <paper>" for the other subjects. */
export type SectionId = string;

export type Modality =
  | "X-ray" | "CT" | "MRI" | "Ultrasound" | "IVU" | "HSG" | "RUG / MCUG / Cystogram"
  | "Barium study" | "Mammography" | "Angiography" | "Other";

export interface Section { id: SectionId; name: string; subject: Subject; kind: Kind }

export interface AltAnswer { source: string; lines: string[] }

/** OSCE picture or station card (all subjects). */
export interface Card {
  id: string;
  subject: Subject;
  section: SectionId;
  qNumber: number | null;
  picture: number | null;
  images: string[];
  answerImages?: string[];     // shown only after reveal
  stem: string | null;
  prompts: string[];
  promptSource: "pdf" | "transcribed" | "generic";
  answer: string[];
  refs?: string[];
  altAnswers: AltAnswer[];
  diagnosis: string | null;
  notes: string[];
  modality: Modality;
  appearsIn: string[];
  inSections: SectionId[];
  page: number | null;
  textOnly: boolean;
  noAnswer: boolean;
}

export interface McqOption { key: string; text: string }

export interface McqCard {
  id: string;
  subject: Subject;
  kind: "mcq";
  section: SectionId;          // "<CODE> MCQ <paper>"
  paper: string;
  qNumber: number;
  topic: string | null;
  leadIn: string | null;
  stem: string;
  options: McqOption[];
  correct: string[];           // marked in the source (usually one)
  accepted: string[];          // correct + disputed alternatives: any of these counts as right
  disputed: { alt: string[]; reason: "second-highlight" | "key-differs" | null } | null;
  multiMarked: boolean;
  noKey: boolean;              // no answer in the source: student self-marks
  answerText: string[] | null; // short-answer items
  type: "mcq" | "recall";
  notes: string[];
  appearsIn: string[];
  page: number;
  source: "typed" | "transcribed";
  images: string[];
}

export interface PhotoCard {
  id: string;
  subject: Subject;
  kind: "paper-photo";
  section: SectionId;
  paper: string;
  qLabel: string;
  qNumber: number | null;
  images: string[];
  answerKey: string | null;
  note: string;
  page: number;
  appearsIn: string[];
}

export interface RevisionNote {
  id: string;
  subject: Subject;
  title: string;
  lines: string[];
  images: string[];
  handwritten?: boolean;
}

export type Item =
  | { kind: "osce"; card: Card }
  | { kind: "mcq"; card: McqCard }
  | { kind: "photo"; card: PhotoCard };

export interface Content {
  version: number;
  source: string;
  sections: Section[];
  images: Record<string, { w: number; h: number }>;
  cards: Card[];               // OSCE cards, all subjects
  mcqs: McqCard[];
  photos: PhotoCard[];
  notes: RevisionNote[];
  items: Map<string, Item>;    // every study item by id
}
