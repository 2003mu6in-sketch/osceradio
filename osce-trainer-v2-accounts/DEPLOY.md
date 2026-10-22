# Deploying to Vercel

The app is plain static files. Vercel runs `npm run build` and serves `dist/`. Everything is already set in
`vercel.json` (framework "Other", build command, output folder, cache headers), so you don't need to change
any settings in the Vercel dashboard.

## First deploy (no GitHub needed)

1. Install **Node.js 20 or newer** (the LTS version from nodejs.org).
2. Unzip the project and open a terminal **in the `radiology-osce` folder**.
3. Log in once:
   ```bash
   npx vercel login
   ```
4. Create the project and a preview deploy:
   ```bash
   npx vercel
   ```
   Answer the questions:
   - Set up and deploy? **Yes**
   - Which scope? your account
   - Link to an existing project? **No**
   - Project name: `radiology-osce-trainer` (or any name; this becomes the web address)
   - In which directory is your code located? **./**
   - Want to modify these settings? **No** (they come from `vercel.json`)

   Vercel prints a preview link. Open it and check it works.
5. Publish to the main address:
   ```bash
   npx vercel --prod
   ```
   The app is now at `https://<project-name>.vercel.app`. Share that link.

## With GitHub instead (redeploys on every push)

Push the repository to GitHub, then in Vercel choose **Add New… → Project → Import** the repository.
Vercel reads `vercel.json`, so accept the defaults and click **Deploy**.

## Updating

| Change | What to do |
|---|---|
| App code (`src/`) | `npm test && npm run e2e`, then `npx vercel --prod` |
| Question content | edit `pipeline/overrides/*.yaml` → `python3 pipeline/04_build.py` → `npm run build` → check → `npx vercel --prod` |

Students who have the app open see **"A new version is ready – Reload"**. Their progress is stored separately
and is never affected by an update. Card IDs never change, so error-log entries keep pointing at the right question.

## Accounts (Supabase) – optional sign-in and progress sync

Without these steps the app works exactly as before (no sign-in). With them, students can create an account
(email + password) and their progress and error log follow them between phone and computer.

1. **Create a project** at supabase.com → *New project* (any name; choose the region closest to your students,
   e.g. *West EU* or *South Africa*). Wait until it is ready.
2. **Create the tables.** *SQL Editor → New query*, paste all of `supabase/migrations/0001_progress_sync.sql`,
   click **Run**. You should see "Success. No rows returned". (Safe to run again.)
3. **Point email links at your app.** *Authentication → URL Configuration*:
   - **Site URL**: `https://<your-project>.vercel.app/`
   - **Redirect URLs**: add `https://<your-project>.vercel.app/**` (and `http://localhost:5173/**` for local testing).
4. **Choose email confirmation.** *Authentication → Sign In / Providers → Email*:
   - *Confirm email* **on** (default): new students get a link and must open it before signing in. Safer.
   - *Confirm email* **off**: sign-up signs them in straight away. Simpler for a class.
   Supabase's built-in email sender only allows a few emails per hour – fine for testing; for a whole class set up
   custom SMTP (*Project Settings → Authentication → SMTP*) or turn confirmation off.
5. **Give Vercel the keys.** Supabase *Project Settings → API* (or the **Connect** button): copy the **Project URL**
   and the **anon / publishable** key – *never* the `service_role` / secret key (the build refuses it).
   Vercel → your project → *Settings → Environment Variables*: add `SUPABASE_URL` and `SUPABASE_ANON_KEY`
   (Production and Preview). The Supabase–Vercel integration's `NEXT_PUBLIC_SUPABASE_*` names also work.
6. **Redeploy** (*Deployments → … → Redeploy*, or push a commit). The build log prints
   `accounts: on (<ref>.supabase.co)`. A **Sign in** button appears top right.

Local testing: copy `.env.example` to `.env.local`, fill in the two values, `npm run dev`.

Check: create an account on your phone, answer a question wrongly, then sign in on a computer – the error log entry
should be there within a few seconds. In Supabase *Table Editor* you can see the `reviews` and `error_entries` rows
(students can only ever read their own, enforced by row-level security).

## Check after each production deploy (5 minutes, on real phones)

1. **Android – Chrome** and **iPhone – Safari**: open the link, study 2–3 questions, mark one Wrong.
2. Menu → **Add to Home Screen** / **Install app**, then open it from the home screen.
3. Settings → "Offline use" should say **Ready**. Turn on aeroplane mode, reopen the app, browse and study.
4. Settings → **Save backup file**: the file should download (Files app on iPhone, Downloads on Android).

## Notes for students (put these in your class announcement)

- **Add it to your home screen.** On iPhone, Safari can clear data for websites you haven't opened for about a week;
  apps added to the home screen are not affected.
- **Your progress is saved on your phone.** To use the app on more than one device, tap **Sign in** (top right) and
  create an account – your progress and error log then sync. Without an account, use Settings → *Save backup file*
  now and then and *Import a backup* on a new phone.
- No tracking. Without an account nothing you do is sent anywhere; with one, only your progress and error log are
  stored in your account, and only you can read them.

## Before sharing publicly

The questions and images come from *MASTERPIECE – OSCE RADIOLOGY* (HUMBLE_PHD, Kpanjen MD and contributors,
credited on the About page). Get the authors' agreement before sharing the link beyond your class.
