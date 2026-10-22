# Project AGENTS.md — Masterpiece OSCE and MCQ Trainer

Consolidated V1 + V2 (accounts). Auto-loaded by OpenCode for this project.

Universal rules live in AGENTS.global.md at the workspace root (and ~/.config/opencode/AGENTS.md).
This file holds only project-specific facts. Do not duplicate the global operating system here.

Project root: osce-trainer-v2-accounts/   (V1 reference: radiology-osce/, already deployed)

---

## 1. What this project is

A static, offline-first study PWA for medical students preparing for OSCE and MCQ exams.
Subjects: Radiology, Anaesthesia, Ophthalmology, ENT. Content comes from the class Masterpiece PDFs
via a Python pipeline and is committed to content/.

Study flow: the student looks at an OSCE card or MCQ, answers in their head or types it, then reveals.
OSCE and recall items are self-marked Right/Wrong. MCQs are marked from the source key, and disputed
keys accept either answer. Every Wrong creates an error-log entry with error types and a root cause.
Questions then follow a spaced review schedule: 48 h, then 72 h, then mastered. A wrong answer at any
point restarts the cycle.

### Non-negotiables

- Works offline and on phones. Radiology OSCE images are precached; other subject images are cached on
  first view or per subject from Settings.
- No LLM and no server-side logic for studying. Insights are fixed rules in src/logic/insights.ts.
- Student data belongs to the student: IndexedDB locally, JSON backup, CSV error log. Signing in is
  optional and used only to sync progress between devices.
- Never reveal an answer early. Modality, diagnosis and alt text stay hidden until reveal. Regression
  test tests/e2e/flash.mjs guards this.
- Card IDs are permanent. Never renumber or rename an existing ID; new content gets new IDs.

---

## 2. Stack and architecture (inferred from the repo — correct if it drifts)

- UI: React 19 + TypeScript, hand-written CSS in src/ui/styles.css. No UI framework. Themes are CSS
  custom properties.
- Routing: custom hash router in src/lib/router.ts. Routes look like #/study?subject=ent&kind=mcq.
- State: small stores built on useSyncExternalStore.
- Persistence: IndexedDB database osce-trainer v1, stores settings, reviews, errors (src/storage/db.ts).
- Offline: service worker src/sw.ts, versioned cache osce-<hash>, runtime image cache osce-img-v2.
- Build: esbuild via scripts/build.mjs, one hashed ESM bundle, output dist/. Build prints accounts: on/off.
- Hosting: Vercel static hosting, configured by vercel.json.
- Accounts: Supabase Auth (email + password) + PostgREST over plain fetch, no SDK, in src/sync/.
  Optional: when env vars are missing, accounts are off and the app behaves like V2 without accounts.
- Content pipeline: Python 3 (pypdfium2, Pillow, PyYAML, pdftotext). Run by hand; output is committed.
- Tests: node:test + tsx for unit; Playwright for e2e (run, flash, update, v2, accounts).

Project type: full-stack app (global 6.2). Use Strict Planner for auth, database and health-adjacent data.
Run the Audit agent before any production deploy.

---

## 3. Commands

    npm install
    npm run dev        # watch and serve on http://localhost:5173
    npm run build      # output to dist/
    npm test           # unit tests
    npm run e2e        # build then Playwright suites
    npm run typecheck  # tsc --noEmit

Node >= 20.

---

## 4. Delegated agents this project needs

- Design Director: yes. Any major UI work, new pages, redesigns or visual polish goes through it first.
- Audit: yes. Required before shipping auth, Supabase, database or health-adjacent changes, and before
  any production deploy.
- Standards Check: only when Ibrahim invokes it explicitly.
- Intake: for new features whose scope is unclear.

---

## 5. Performance Budget

Shared contract. Design Director reads this before proposing directions; Audit checks against it.

- Icons: inline SVG in src/ui/icons.tsx only. No icon library, no icon font, no icon CDN.
- Images: pipeline output only (content/img, WebP full size plus thumbnails). No external image host, no
  new CDN, and no new image format without approval.
- Precache budget: about 8 MB for the app plus radiology OSCE images. Keep the runtime image cache
  under about 12 MB.
- Fonts: system font stack only. No webfonts, no Google Fonts, no font files added to the repo.
- Dependencies: runtime dependencies are capped at react and react-dom. No new runtime dependency
  without explicit approval; devDependency additions also need approval.
- Bundle: prefer existing modules and hand-written CSS over new libraries. Keep the JS bundle small.

---

## 6. Security and privacy notes

- Accounts are Supabase Auth (email + password). RLS is the only protection: it is enabled on both
  tables (reviews, error_entries) with explicit auth.uid() = user_id policies. anon has no grants.
- Never ship the service-role key. The build rejects it. Only the anon or publishable key is injected
  as __SUPABASE__.
- Identity comes from the authenticated session, never from the request body. Tokens live in
  localStorage key osce-auth-v1.
- Email links use the implicit fragment flow. Any new auth flow that returns tokens in the fragment must
  go through readLinkTokens() in src/sync/supabase.ts.
- Data is educational progress plus an error log tied to a student. Treat as sensitive: no analytics,
  no third-party telemetry, and never log answers or email addresses.
- SQL: add a new numbered file in supabase/migrations. Never edit 0001_progress_sync.sql.
- Stored-shape changes: bump DB_VERSION plus an upgrade step for IndexedDB, bump SCHEMA_VERSION plus
  MIGRATIONS[n] for backups, and add a new migration for Supabase.

---

## 7. Conventions and gotchas

- UI copy: plain British English, short sentences, no jargon such as token or sync conflict. Error
  messages tell the student what to do next.
- Accessibility: every control is keyboard-usable; Right/Wrong never rely on colour alone; contrast is
  tested (tests/unit/contrast.test.ts).
- Phone first: no sideways scrolling at 375 px, sticky mark bar, bottom navigation below 720 px.
- Content: fix with overrides, never edit content JSON by hand. Keep IDs stable. Run npm test after a
  content rebuild.
- Compatibility: V1 backup files must keep importing (MIGRATIONS[1] in src/logic/backup.ts).
- Golden regression: the next question never renders with its answer showing (tests/e2e/flash.mjs).

---

Last reviewed: 2026-10-22. Facts marked inferred were read from the repo and PROJECT_CONTEXT.md;
correct them if they drift.
