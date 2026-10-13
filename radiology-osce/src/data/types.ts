/** Content produced by the pipeline (content/cards.json). Read-only in the app. */
export type SectionId = "70W" | "30R" | "2025" | "TIPS" | "2023" | "2021" | "2019" | "2018" | "2017" | "2016" | "2015" | "2014";

export type Modality =
  | "X-ray" | "CT" | "MRI" | "Ultrasound" | "IVU" | "HSG" | "RUG / MCUG / Cystogram"
  | "Barium study" | "Mammography" | "Angiography" | "Other";

export interface Section { id: SectionId; name: string }

export interface AltAnswer { source: string; lines: string[] }

export interface Card {
  id: string;
  section: SectionId;
  qNumber: number | null;
  picture: number | null;
  images: string[];
  stem: string | null;
  prompts: string[];
  promptSource: "pdf" | "transcribed" | "generic";
  answer: string[];
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

export interface Content {
  version: number;
  source: string;
  sections: Section[];
  images: Record<string, { w: number; h: number }>;
  cards: Card[];
}
