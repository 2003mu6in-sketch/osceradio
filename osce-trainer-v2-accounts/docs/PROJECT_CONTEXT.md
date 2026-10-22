# Masterpiece OSCE & MCQ Trainer: Project Context Spec

> **Purpose of this document.** One place that explains how the whole project fits together. It is for a developer, or an AI coding assistant, who is about to change the code or the question content. Read it before editing.
>
> **As of:** 21 Oct 2026. Repo version: V2 + accounts (commit after `402631a`).

---

## 1. What the product is

The app is a study tool for medical students preparing for OSCE and MCQ exams. It covers four subjects: **Radiology, Anaesthesia, Ophthalmology and ENT**.

All the content comes from the class's *Masterpiece* PDFs. A Python pipeline turns them into JSON plus WebP images. The web app is a static single-page progressive web app (PWA).

| Study item | How a student answers | How it is marked |
|---|---|---|
| **OSCE picture/station card** | Looks at the image, answers in their head (or types it), then reveals | Self-marked **Right / Wrong** |
| **MCQ** | Taps an option (or presses a key) | Marked by the app from the source's key. Disputed keys accept either answer. Questions with no key are self-marked |
| **Recall MCQ** (short answer) | Reveals the answer | Self-marked |
| **Paper photo** (questions that could not be transcribed) | Reads the photographed question, reveals the key | Self-marked |

**Every Wrong answer** creates an **error-log entry**. For OSCE cards, the student picks error types plus a root cause. For MCQs and paper photos, they pick an MCQ root cause.

The question then follows the **spaced review** schedule: it comes back after 48 h, then after 72 h, and then it is mastered. A wrong answer at any point restarts the cycle.

### Non-negotiable product rules

1. **Works offline and on phones.** All questions are available offline after the first visit. The radiology OSCE images are precached. The other subjects' images are cached when first viewed, or per subject from Settings.
2. **No LLM and no server-side logic for studying.** The insights come from fixed rules (`src/logic/insights.ts`).
3. **The student's data belongs to the student.**
   - It is stored on the device (IndexedDB).
   - It can be exported as JSON (a backup) or as a CSV error log.
   - Signing in is optional and is used **only** to sync progress between devices.
4. **Never reveal an answer early.**
   - The modality, diagnosis and alt text stay hidden until reveal.
   - Review lists never show diagnoses.
   - A regression test (`tests/e2e/flash.mjs`) guards this.
5. **Card IDs are permanent.**
   - Progress, review schedules and error-log entries point at IDs.
   - Never renumber or rename an existing ID. New content gets new IDs.

---

## 2. Architecture at a glance

```
 PDFs ──► pipeline/ (Python) ──► content/*.json + content/img/*.webp ──┐
                                                                      │  scripts/build.mjs (esbuild)
 src/ (React 19 + TypeScript) ────────────────────────────────────────┼──► dist/  ──► Vercel (static hosting)
                                                                      │      ├─ index.html, assets/app-[hash].js|css
 env: SUPABASE_URL / SUPABASE_ANON_KEY (optional) ────────────────────┘      ├─ content/ (JSON + images)
                                                                             └─ sw.js (service worker, precache list)

 Browser:  React UI ◄──► in-memory stores (useSyncExternalStore) ◄──► IndexedDB "osce-trainer"
                                                   │
                                                   └──► src/sync (optional) ◄──HTTPS──► Supabase Auth + PostgREST
                                                                                       tables: reviews, error_entries (RLS)
```

| Layer | Technology | Notes |
|---|---|---|
| UI | React 19, TypeScript, hand-written CSS (`src/ui/styles.css`) | No UI framework. Dark/light themes defined as CSS custom properties |
| Routing | Custom **hash router** (`src/lib/router.ts`) | Works on any static host and offline. Routes look like `#/study?subject=ent&kind=mcq` |
| State | Small stores built on `useSyncExternalStore` | `storage/progress.ts`, `storage/settings.ts`, `sync/supabase.ts` (auth), `sync/sync.ts` (sync status) |
| Persistence | IndexedDB (`storage/db.ts`) | db `osce-trainer` v1; stores `settings`, `reviews`, `errors` |
| Offline | Service worker `src/sw.ts`, generated precache list | Versioned cache `osce-<hash>`, runtime image cache `osce-img-v2` (survives updates) |
| Build | esbuild via `scripts/build.mjs` | No Vite or webpack. A single ESM bundle with hashed names |
| Hosting | Vercel (static), configured by `vercel.json` | Build command `npm run build`, output folder `dist` |
| Accounts | Supabase Auth (email + password) + PostgREST | Plain `fetch`, **no SDK**. Optional: switched off when env vars are missing |
| Content pipeline | Python 3 + pypdfium2, pdftotext, Pillow, PyYAML, (tesseract for drafts) | Run by hand. Its output is committed |
| Tests | `node:test` + tsx (unit), Playwright + Chromium (e2e) | See §10 |

---

## 3. Repository layout

```
radiology-osce/
├─ src/
│  ├─ main.tsx            entry: initAuth() → render <App/> → load settings/progress → register SW
│  ├─ App.tsx             route switch; starts sync once content has loaded
│  ├─ index.html          template (%CSS% / %JS% replaced by the build); theme set before first paint
│  ├─ sw.ts               service worker (precache + runtime image cache + update)
│  ├─ data/               question bank: types.ts (Content model), content.ts (load/assemble/filter), useContent.ts
│  ├─ logic/              pure logic: schedule.ts (48h/72h rules), progress.ts, deck.ts, insights.ts, backup.ts (JSON/CSV/merge)
│  ├─ storage/            device data: db.ts (IndexedDB), progress.ts (store + writes), settings.ts, types.ts
│  ├─ sync/               accounts: supabase.ts (Auth/REST client), merge.ts (pure planner), sync.ts (engine)
│  ├─ pages/              Home, Study, Browse, CardPage, Review, ErrorLog, Notes, Settings, Account, About
│  ├─ ui/                 Shell (header/nav/account chip), dialogs, MCQ parts, image viewer, DataTools, OfflineImages, styles.css
│  └─ lib/                router.ts, useNow.ts, download.ts
├─ content/               ← pipeline OUTPUT, committed; read by the app
│  ├─ cards.json          radiology OSCE (V1 format; 220 cards)
│  ├─ osce/<subject>.json anaesthesia / ophthalmology / ent OSCE cards + revision notes
│  ├─ mcq/<subject>.json  MCQs + paper-photo cards per subject; REPORT.md = reconciliation
│  └─ img/*.webp, img/thumb/*.webp   675 images (full + thumbnail)
├─ pipeline/              Python content pipeline (see §8)
├─ supabase/migrations/   SQL to run once in the Supabase project
├─ scripts/               build.mjs, dev.mjs (watch + serve :5173), serve.mjs (static server for previews/tests)
├─ tests/unit/            *.test.ts (node:test)
├─ tests/e2e/             run.mjs, flash.mjs, update.mjs, v2.mjs, accounts.mjs (Playwright)
├─ public/                manifest.webmanifest, icons
├─ types/                 globals.d.ts (__SUPABASE__), offline/react.d.ts (typing shim for offline boxes)
├─ docs/PROJECT_CONTEXT.md  this file
├─ DEPLOY.md · README.md · vercel.json · .env.example
└─ build/, review/        pipeline intermediates and QA sheets (partly git-ignored)
```

---

## 4. Content model (read-only in the app)

The types are defined in `src/data/types.ts`. `loadContent()` fetches **8 JSON files**: `cards.json`, three `osce/*.json` and four `mcq/*.json`.

`assemble()` (pure) then merges them into one `Content` object. It **throws on a duplicate ID or a missing image**; a unit test covers this.

### Subjects, kinds and sections

- `Subject` = `radiology | anaesthesia | ophthalmology | ent`.
- `Kind` = `osce | mcq | photo`. An `Item` is the union `{kind, card}`, and `content.items: Map<id, Item>` indexes everything.
- **Section IDs:**
  - Radiology OSCE keeps its V1 IDs: `70W`, `30R`, `2025`, `TIPS`, `2023` … `2014`.
  - Other OSCE sections are `"<CODE> <paper>"`, for example `ANA 2025 Trial`.
  - MCQ sections are `"<CODE> MCQ <paper>"`.
  - CODE is one of `RAD`, `ANA`, `OPH`, `ENT`.
  - Trial and bank "Set n" sections are grouped under their paper.

### Card types

**OSCE `Card`**

| Field(s) | Meaning |
|---|---|
| `images` | Shown before reveal |
| `answerImages` | Shown after reveal |
| `prompts`, `stem` | The question |
| `answer[]`, `diagnosis`, `refs` | The answer |
| `modality` | Radiology only; hidden until reveal |
| `appearsIn` / `inSections` | Repeats across papers are merged into one card and listed under each paper |
| `textOnly`, `noAnswer` | Flags |

**`McqCard`**

| Field(s) | Meaning |
|---|---|
| `options[]` | The options |
| `correct[]` | Marked in the source |
| `accepted[]` | `correct` plus any disputed alternative; any of these counts as right |
| `disputed` | `{alt, reason: "second-highlight" \| "key-differs"}` |
| `multiMarked` | The source marks more than one option |
| `noKey` | No key in the source; the student self-marks |
| `type` | `"mcq"` (tap an option) or `"recall"` (reveal and self-mark) |
| `leadIn` | Shared case text |
| `source` | `"typed"` or `"transcribed"` (hand-typed from a photo) |

**`PhotoCard`**: a photographed question (`images`) plus the paper's `answerKey`, if it has one.

**`RevisionNote`**: read-only station lists and tips. `handwritten: true` means scanned handwritten pages.

### Counts in the current build

| | OSCE cards | MCQs | Paper photos |
|---|---|---|---|
| Radiology | 220 | 247 | 12 |
| Anaesthesia | 122 | 709 | – |
| Ophthalmology | 65 | 450 | 1 |
| ENT | 26 | 303 | – |
| **Total** | **433** | **1,713** | **13** |

In addition:
- 8 revision notes (Ophthalmology and ENT);
- 2,159 study items in total;
- 497 referenced images.

---

## 5. Student data (device)

The types are defined in `src/storage/types.ts`. IndexedDB `osce-trainer` (version 1) has three stores:

| Store | Key | Value |
|---|---|---|
| `reviews` | `cardId` | `ReviewState {cardId, stage: 0\|1\|2\|"mastered", dueAt?, seen, rights, misses, lastResult?, lastSeenAt?, updatedAt?}` |
| `errors` | `id` (indexes `cardId`, `createdAt`) | `ErrorEntry {id, cardId, createdAt, kind?, tags[], rootCause, chosen?, typedAnswer?, note?}` |
| `settings` | string keys | `Settings` (theme, typedAnswerBox, shuffle, lastExportAt, backupSnoozedUntil, schemaVersion 2, subject) and `"session"` (resumable `StudySession`) |

### Error entries

- **OSCE** entries need ≥ 1 tag (error type) plus an OSCE cause.
  - Tags: `wrong-modality`, `missed-finding`, `misread-finding`, `wrong-diagnosis`, `unknown-sign`, `incomplete`.
  - Causes: `image-familiarity` (F), `knowledge-application` (A), `never-learnt` (N).
- **MCQ and photo** entries have no tags, an MCQ cause, and `chosen` = the option the student tapped.
  - Causes: `never-learnt` (N), `couldnt-recall` (R), `misread-question` (M), `narrowed-two` (T).
- **V1 entries have no `kind`.** Everywhere in the app, a missing `kind` means `"osce"`.

### Writes

- **Right/Wrong:** `recordResult()` writes the review state, the error entry and the session in **one transaction**, and stamps `updatedAt`.
- **Undo:** `undoResult()` restores the previous state with a fresh `updatedAt`. If the question had never been answered, it writes a blank record. This is deliberate: an undo must win over an answer that has already synced.
- **Change hooks:** `onLocalChange()` tells the sync engine about changes, including deleted error entries, which become tombstones.

### Spaced review

The rules live in `src/logic/schedule.ts` and are unit-tested:

| Event | Result |
|---|---|
| Wrong, at any stage | Stage 1, due in 48 h, misses + 1 |
| Right on a **due** stage-1 card | Stage 2, due in 72 h |
| Right on a **due** stage-2 card | Mastered |
| Right when the card is not due | Recorded; stage unchanged |
| Wrong on a mastered card | Back to stage 1 (relapse) |

### Backups

The code is in `src/logic/backup.ts`.

- **JSON backup.**
  - Format: `{app: "osce-trainer", schemaVersion: 2, exportedAt, reviews, errors, session}`.
  - `MIGRATIONS[1]` upgrades V1 files.
  - Import shows a **merge plan** before applying it: entries with new IDs are added, newer progress per question wins, and nothing is ever deleted.
- **CSV export.**
  - Has a UTF-8 BOM so Excel reads accents correctly.
  - Columns: Date (UTC), Subject, Type, Question, Paper, Answer / diagnosis, Modality, Root cause, Error types, Your answer, Note, Review stage, Next review (UTC), Times wrong, Times right.
- **Reminder.** A backup reminder banner appears after the first day of use, then weekly, and only when there is new progress.

---

## 6. Accounts and sync (Supabase)

### 6.1 Scope

- Signing in is **optional**. It syncs progress (`reviews`) and the error log (`errors`) across a student's devices.
- Not synced:
  - settings (theme, last subject);
  - the in-progress study session;
  - offline image caches.
- **The device stays the source of truth while offline.**
- With no Supabase env vars at build time, accounts are **off**: no header chip, no Account panel, and `#/account` explains that accounts are not switched on. The app then behaves exactly like V2.

### 6.2 Configuration

`scripts/build.mjs` reads the following and injects `__SUPABASE__ = {url, key} | null` into the bundle:

- **URL:** `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`, `VITE_SUPABASE_URL`).
- **Key:** `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
- **Sources:** the process environment (Vercel), then `.env` / `.env.local`.

The build **refuses a service-role or secret key**. The anon/publishable key is public by design; security comes from RLS.

### 6.3 Client (`src/sync/supabase.ts`)

The client uses plain `fetch` against GoTrue and PostgREST. Every request carries `apikey: <anon key>` and `Authorization: Bearer <access token or anon key>`.

| Action | Endpoint |
|---|---|
| Sign up | `POST /auth/v1/signup?redirect_to=<app url>` `{email,password}`. Returns a session if email confirmation is off, otherwise "check your email" |
| Sign in | `POST /auth/v1/token?grant_type=password` |
| Refresh | `POST /auth/v1/token?grant_type=refresh_token`. Runs automatically when the token is within 60 s of expiry; single-flight |
| Current user | `GET /auth/v1/user` |
| Change password | `PUT /auth/v1/user {password}` |
| Forgot password | `POST /auth/v1/recover?redirect_to=<app url>` |
| Sign out | `POST /auth/v1/logout` (best effort) |
| Delete account | `POST /rest/v1/rpc/delete_my_account` |

**Session.** Stored in `localStorage["osce-auth-v1"]` (`access_token`, `refresh_token`, `expires_at`, `user {id,email}`) and kept in step across tabs with the `storage` event.

**Email links (implicit flow).** Supabase redirects to `<app url>#access_token=…&refresh_token=…&type=signup|recovery`. `initAuth()` runs **before the first render**, and again on `hashchange`, because a link opened in a tab where the app is already running only changes the fragment. It:
1. reads the tokens;
2. removes them from the address bar (`#/account`);
3. fetches the user;
4. shows "Email confirmed", or the "Set a new password" form for `type=recovery`.

An error fragment (for example an expired link) shows a friendly message.

**Errors.** `friendlyError()` maps GoTrue/PostgREST error codes to plain sentences, for example `invalid_credentials` → "Wrong email or password." It is unit-tested.

### 6.4 Database (`supabase/migrations/0001_progress_sync.sql`)

**Table `public.reviews`**

| Column | Notes |
|---|---|
| `user_id` | Default `auth.uid()`; FK to `auth.users`, on delete cascade |
| `card_id` | |
| `data` | jsonb `ReviewState`, < 8 KB |
| `rev` | bigint: client change time (ms) |
| `updated_at` | Server time; used as the pull cursor |

Primary key: `(user_id, card_id)`.

**Table `public.error_entries`**

| Column | Notes |
|---|---|
| `user_id` | As above |
| `id` | |
| `card_id` | |
| `data` | jsonb `ErrorEntry`; null when deleted |
| `created_at` | bigint |
| `deleted` | bool |
| `updated_at` | Server time |

Primary key: `(user_id, id)`.

**Triggers** (rules enforced on the server):
- **`reviews`:** an update with a smaller `rev` is skipped, so the newest change wins even when two devices race.
- **`error_entries`:** a deleted row stays deleted, and its `data` is cleared.
- **Both:** `updated_at = clock_timestamp()`.

**Row-level security** on both tables: `for all to authenticated using/with check (auth.uid() = user_id)`. `anon` has no grants.

**`delete_my_account()`:** a `security definer` function, callable only by `authenticated`. It deletes the caller's `auth.users` row, and the cascade removes their data.

**Indexes:** `(user_id, updated_at)` on both tables.

### 6.5 Sync algorithm

The engine is `src/sync/sync.ts`; the planner is `src/sync/merge.ts`, which is pure and unit-tested.

**`SyncMeta`** is kept in `localStorage["osce-sync-meta"]`. It records what this device last agreed with the account:
- `userId`, `email`;
- pull cursors per table;
- `rev` per synced review;
- the set of synced error IDs;
- queued deletions (tombstones).

**One run (`syncNow`):**
1. **Pull.** For each table, fetch rows with `updated_at ≥ cursor − 5 s`, in pages of 1,000. The overlap is safe because applying a row is idempotent.
2. **Plan** (`planSync`):
   - **Reviews:** compare `rev(local) = updatedAt ?? lastSeenAt` with the remote `rev`. The newer one wins, in either direction. Local rows whose `rev` differs from the meta are pushed.
   - **Error entries:** remote rows marked deleted are deleted locally. Remote live rows that are not local and not tombstoned are added. Local entries not yet in the account are pushed. Tombstones are pushed as `deleted = true`.
   - **Unknown questions:** rows for questions not in this version of the bank are left in the account untouched.
3. **Apply locally** in one IndexedDB transaction (`applySync`). This does not trigger another upload.
4. **Push** upserts in batches of 500: `POST /rest/v1/<table>?on_conflict=…` with `Prefer: resolution=merge-duplicates,return=minimal`.
5. **Save the meta.** Deletions queued during the run stay queued for the next run.

**Triggers:**
- 2.5 s after any local change (debounced);
- on sign-in;
- on app start;
- on the `online` event;
- when the app comes to the foreground (if the last sync was more than 30 s ago);
- every 5 min while visible.

**Errors:**
- Offline → status `offline`; nothing is lost.
- Other errors → status `error`, with backoff retries (15 s doubling, up to 10 min).
- An invalid refresh token → signed out, with a notice.

**Another account on the device.** If the device holds progress synced with a *different* account, sync pauses (`status: "choose"`). The student then picks **Add it to my account** or **Remove it from this device**.

**Sign out.** The student can optionally remove their progress from the device (the "shared computer" checkbox).

**"Delete all progress" while signed in.** This deletes the account's rows first, then the device's rows. If the account cannot be reached, nothing is deleted. Other devices keep their own copy until they are reset.

### 6.6 UI

- **Header chip:** "Sign in", or a dot with Synced / Syncing… / Offline / Sync paused.
- **Settings → Account panel.**
- **`#/account`:**
  - signed out: Sign in / Create account tabs, show-password toggle, forgot password;
  - signed in: status and Sync now, the other-account choice, change password, sign out (with the clear-device option), delete account.

### 6.7 Known limits and next steps

- **Account deletion** removes the user and all their rows; the progress on the current device stays.
- **No OAuth (Google, etc.) yet.**
  - Adding it means a GoTrue `/authorize?provider=` redirect.
  - The same `#access_token` handling would then apply.
- **Settings and the in-progress session are per device.**
- **Very large accounts:** the first sync downloads at most about 2,200 reviews plus the error entries, which is a few hundred KB. Later syncs are incremental.

---

## 7. Offline, caching and updates

- **The build** (`scripts/build.mjs`) copies only the images that the question banks reference. It writes `content/images.json` (subject → image IDs) and generates `sw.js` with a precache list and a content hash.
- **Precached** (about 460 files, 8 MB): the app, all JSON, and the radiology OSCE images.
- **Other images** (about 550 files, 11 MB) go into the runtime cache `osce-img-v2`:
  - they are cached on first view;
  - **Settings → Pictures for offline use** saves them per subject (Anaesthesia 4 MB, Ophthalmology 5.3 MB, ENT 1.7 MB, Radiology MCQ 0.7 MB);
  - this cache **survives app updates**. Old `osce-<hash>` caches are deleted when the new worker activates.
- **Update flow:** the worker checks on reopen and every 6 h. When a new worker is waiting, the "A new version is ready – Reload" notice (`UpdateNotice`) appears. Progress is never affected.
- **Navigation offline** falls back to the cached `./`.
- **Requests to Supabase** are cross-origin, so the worker does not touch them.
- **`vercel.json` headers:**
  - `sw.js`, `index.html`, `manifest` and `/content/*` must revalidate;
  - hashed `/assets/*` are immutable;
  - plus `nosniff`, a referrer policy and a permissions policy.

---

## 8. Content pipeline (Python)

The pipeline is run by hand when content changes; its output (`content/`) is committed. Requirements: Python 3 with pypdfium2, Pillow, PyYAML, and pdftotext (poppler). tesseract is used only for drafts.

| Pipeline | Steps | Output |
|---|---|---|
| **Radiology OSCE (V1)** `pipeline/0[1-5]_*.py` | Layout → crop images → parse cards → build with `overrides/*.yaml` → QA sheet | `content/cards.json`, images |
| **MCQ** `pipeline/mcq/` | `01_layout` → `02_parse` → `03_build` → `04_qa_sheet` | `content/mcq/<subject>.json`, `REPORT.md` |
| **OSCE V2** `pipeline/osce2/` | `01_layout` → `02_crop` → `03_parse` → `04_build` → `05_qa_sheet` | `content/osce/<subject>.json`. Handwritten pages become notes |
| **Photographed papers** `pipeline/photos/` | `00_extract` → `01_ocr` → `02_parse` → `03_transcripts` → `04_build` → `05_report` | Drafts in `build/photos/*.draft.json`, which `mcq/03_build` merges in |

### MCQ pipeline details

- **Layout.** `pdftotext -bbox` gives the text lines; pypdfium2 gives highlight rectangles and character colours.
- **Answers.** A yellow highlight marks the answer. Cyan marks a second, disputed answer. Red key letters mean "verify".
- **Configuration.** Paper segments are defined in `segments.yaml`; hand fixes go in `overrides.yaml`, keyed by draft ID.
- **Merging.** Repeats across years are merged with fuzzy stem/option matching and a polarity-word guard (NOT/EXCEPT). Different keys across years make the card *disputed*.

### Photographed papers

- Every question was **hand-transcribed** from the photo into `transcripts/*.txt`; OCR was used only as a draft.
- Transcript format:
  - `@page N` starts a page;
  - `N. stem` is a question and `A. opt` an option;
  - `*A.` marks the ticked option;
  - `@lead … @endlead` wraps a shared lead-in;
  - `!img pP L|R|F top-bottom` places a crop.
- Unreadable questions stay as `photo_blocks.yaml` photo cards.

### QA

Each pipeline writes a self-contained HTML QA sheet (`review/…`) for checking the output against the PDFs.

### Golden rules

- **Fix content with overrides**, never by editing `content/*.json` by hand.
- **Keep IDs stable.**
- **Run `npm test` after a rebuild.** It validates every image file and every card's answerability.

---

## 9. Build, run, deploy

```bash
npm install                 # Node ≥ 20
npm run dev                 # watch + serve http://localhost:5173
npm run build               # → dist/   (prints "accounts: on/off")
npm test                    # unit tests (60)
npm run e2e                 # build + Playwright suites (needs Chromium)
npm run typecheck           # tsc --noEmit
```

**Deploy.** Push to GitHub and Vercel rebuilds; or run `npx vercel --prod`. See `DEPLOY.md`, including **"Accounts (Supabase)"** for the setup steps:
1. Create the Supabase project.
2. Run the SQL.
3. Set the env vars in Vercel.
4. Set the Site URL and Redirect URLs.
5. Choose the email-confirmation setting.

---

## 10. Tests

| Suite | What it covers |
|---|---|
| `tests/unit/schedule.test.ts` | Review rules (48 h / 72 h / mastered / relapse) |
| `progress.test.ts`, `content.test.ts`, `v2.test.ts` | Deck building, filters, `assemble()` on the real content, ID stability of V1 radiology cards |
| `backup.test.ts` | JSON round-trip, v1→v2 migration, merge plan, CSV escaping and columns |
| `insights.test.ts` | Hand-worked fixture for the error-log insights |
| `contrast.test.ts` | WCAG contrast of text, controls and all six cause colours in both themes |
| `sync.test.ts` | Merge planner (newest wins, V1 records, undo, tombstones, unknown cards, incremental no-op), friendly errors |
| `e2e/run.mjs` (35) | V1 flows end to end: browse, reveal, study, review timing (fake clock), error log, backup/import/reset, offline, phone layout |
| `e2e/flash.mjs` | The next question never renders with its answer showing |
| `e2e/update.mjs` | The new-version notice appears and Reload works |
| `e2e/v2.mjs` (11) | Subject tabs, MCQ right/wrong flow, cause sheet, review, browse, notes/photos, V1 backup into V2, per-subject offline pictures, phone light/dark |
| `e2e/accounts.mjs` (14) | Builds `dist-accounts/` with Supabase on and answers Auth/REST with an **in-memory fake that follows the SQL rules**. Covers sign up/in, wrong password, upload of signed-out progress, a second device, cross-device deletion, offline then online, token refresh, sign-out clearing, the other-account choice, confirm/recovery/expired email links, delete everything, delete account, phone layout |

**Test conventions:**
- Use accessible selectors (role/label).
- Use deterministic seeds and fake clocks.
- Save screenshots to `test-results/`, which is git-ignored.

---

## 11. Conventions and gotchas

- **Writing style in the UI.** Plain British English, short sentences, and no jargon such as "sync conflict" or "token". Error messages tell the student what to do next.
- **Accessibility:**
  - every control is keyboard-usable (MCQ keys 1–9/A–E; N/R/M/T and F/A/N in dialogs; Esc cancels; Enter saves);
  - Right/Wrong never rely on colour alone (✓/✗ text);
  - contrast is tested.
- **Phone first.** No sideways scrolling at 375 px (tested). Sticky mark bar. Bottom navigation below 720 px.
- **Typecheck.** On boxes without `@types/react`, use `tsc -p tsconfig.offline.json`, which uses a React shim. That shim has no `FormEvent` and similar types, so use structural types instead.
- **Hash router and Supabase links.** Any new auth flow that returns tokens in the fragment must go through `readLinkTokens()` in `supabase.ts`.
- **Never ship the service-role key.** The build rejects it, and RLS is the only protection the data has.
- **Adding a new subject or paper.** Extend the pipeline config (segments/sections YAML), rebuild the content, then add the subject to `SUBJECTS` and to the arrays in `scripts/build.mjs` and `content.ts`.
- **Changing the stored data shape:**
  - for IndexedDB, bump `DB_VERSION` and add an upgrade step;
  - for backups, bump `SCHEMA_VERSION` and add `MIGRATIONS[n]`;
  - for Supabase, add a new numbered migration file and never edit `0001`.

---

## 12. Attribution and sharing

The question content comes from the class *Masterpiece* PDFs. Each PDF's contributors are credited on the About page.

Get the authors' agreement before sharing the app beyond the class.
