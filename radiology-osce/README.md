# Radiology OSCE trainer

A study app built from *MASTERPIECE – OSCE RADIOLOGY (UPDATED)*: see the image, answer, reveal, mark Right or Wrong;
wrong answers go to an error log with spaced review. Everything is stored on the student's device; no accounts, no server.

| Phase | Status |
|---|---|
| 1 Content pipeline (PDF → `content/cards.json` + images) | done |
| 2 App shell: navigation, theme, browse, card view, offline | done |
| 3 Study flow: reveal → Right / Wrong → error log entry | done |
| 4 Spaced review (48 h → 72 h → mastered) | done |
| 5 Error log & insights | done |
| 6 Storage export / import | done |
| 7 Polish & deploy (accessibility, update notice, Vercel config) | done – see DEPLOY.md |

## The app

```bash
npm install
npm run dev        # http://localhost:5173 – rebuilds on change
npm run build      # production build in dist/ (static files – host anywhere)
npm run preview    # serve dist/ on http://localhost:4173
npm test           # unit tests (node:test)
npm run e2e        # build + browser tests: offline, study, review clock, error log, backup round trip, updates
npm run typecheck
```

- **Stack:** React 19 + TypeScript, bundled with esbuild (`scripts/build.mjs`). No framework router or state library:
  a small hash router (`src/lib/router.ts`) and `useSyncExternalStore` stores keep the dependency list to React alone.
- **Offline:** `src/sw.ts` precaches the app, the question bank and every image (≈ 6.6 MB) on first visit.
- **Data on device:** IndexedDB (`src/storage/db.ts`) with stores `settings`, `reviews`, `errors`. Students move it between devices with a JSON backup (`src/logic/backup.ts`, `schemaVersion` + migration steps); import only adds, newest progress per question wins.
- **Hosting:** Vercel (`vercel.json`, see **DEPLOY.md**). `dist/` is plain static files with hash routes (`#/card/2017-Q13`), so any static host also works.
- **Updates:** the service worker checks for a new version when the app is reopened; students see "A new version is ready – Reload".
- **Accessibility:** WCAG AA text contrast in both themes (checked by `tests/unit/contrast.test.ts`), keyboard shortcuts for every action, labelled controls, visible focus, reduced-motion respected. Nothing shown before *Reveal* gives the answer away (no modality chip, neutral alt text, no diagnosis in review lists).

```
src/
  data/      types, card loading, filters, shuffle
  lib/       router, clock tick, file download
  storage/   IndexedDB wrapper, settings
  ui/        shell, image viewer (pinch/zoom), card parts, styles
  logic/     pure rules: progress updates, review schedule, insights, deck building (unit-tested)
  pages/     Home, Study (setup / run / summary), Review, Browse, Card, Error log, Settings, About
  sw.ts      service worker
tests/unit   node:test       tests/e2e   Playwright script
```

## Content pipeline

Turns the PDF into `content/cards.json` plus cropped WebP images.

## Content at a glance

| | |
|---|---|
| PDF items accounted for | 345 (every QUESTION heading / picture) |
| Unique cards | 220 (216 with images, 4 text-only) |
| Repeats merged | 70 cards carry "appears in" tags for several papers |
| Alternative answers kept | 51 (when a repeat was answered differently) |
| No answer in source | 5 (TIPS-19, TIPS-19B, 2023-Q01, 2023-Q05, 2015-Q12) |

## Running the pipeline

Needs Python 3.11+, `pypdfium2`, `Pillow`, `numpy`, `PyYAML`, `opencv-python` and poppler (`pdftotext`, `pdftoppm`).

```bash
cp /path/to/MASTERPIECE.pdf build/source.pdf
python3 pipeline/01_extract_layout.py      # text lines + image boxes per page   -> build/layout.json
python3 pipeline/02_crop_images.py         # render @200dpi, crop to WebP         -> content/img/
python3 pipeline/03_parse_cards.py         # split questions, prompts, answers    -> build/cards_draft.json
python3 pipeline/04_build.py               # apply overrides, merge, validate     -> content/cards.json
python3 pipeline/05_review_page.py         # QA sheet                             -> review/index.html
```

`02_crop_images.py id id …` re-crops only the listed images (use after editing a crop).

## Hand corrections live in `pipeline/overrides/*.yaml`

Never edit `content/cards.json` by hand; put corrections in an override file so a re-run keeps them.

```yaml
images:
  p71-1: {crop: [l, t, r, b]}                   # fractions of the original crop
  p40-2a: {from: p40-2, crop: [0, 0, 0.5, 1]}   # derived image (split side-by-side pictures)
cards:
  2017-Q10:
    stem: "Image of a 28-year-old male…"
    prompts: ["Identify the imaging modality", …]   # transcribed from the slide
    answer: [ … ]
    diagnosis: "Haemoperitoneum"
    modality: Ultrasound
  2021-Q01: {dupOf: 2017-Q09}       # merge into the canonical card
  30R-Q21: {drop: true, dropReason: "…"}
```

A field may only be set once across all override files (the loader refuses conflicting corrections).

## Card schema (`content/cards.json`)

```ts
interface Card {
  id: string;                 // stable, e.g. "2017-Q13", "70W-Q27-P2" – used as the key for student logs
  section: string;            // 70W | 30R | 2025 | TIPS | 2023 | 2021 | 2019 | 2018 | 2017 | 2016 | 2015 | 2014
  qNumber: number | null; picture: number | null;
  images: string[];           // ids → content/img/<id>.webp (w/h in top-level "images")
  stem: string | null;        // clinical vignette shown above the questions
  prompts: string[];
  promptSource: "pdf" | "transcribed" | "generic";
  answer: string[];           // lines; lines starting "Ans:" are answers to the preceding prompt line
  altAnswers: {source: string; lines: string[]}[];
  diagnosis: string | null;   // short title used in the error log
  notes: string[];
  modality: string;           // X-ray | CT | MRI | Ultrasound | IVU | HSG | RUG / MCUG / Cystogram | Barium study | Mammography | Angiography | Other
  appearsIn: string[];        // every paper this image appeared in (first = canonical)
  textOnly: boolean; noAnswer: boolean; page: number | null;
}
```

## Source notes

- **30 Roads** screenshots show the answer under the question; canonical cards are cropped so nothing leaks before reveal.
- **2017 Q9–24 = 2021 Q1–16 = most of 30 Roads**; **2018 = 2019**; the **2025 tips** slides reuse 2019/2017 questions. Each merges into one card.
- 2021 and 2023 give no answers ("refer to the Akorli Kingdoms"); answers come from the matching card where one exists.
- `build/reconciliation.md` lists where every PDF item went.
