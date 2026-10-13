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

## Check after each production deploy (5 minutes, on real phones)

1. **Android – Chrome** and **iPhone – Safari**: open the link, study 2–3 questions, mark one Wrong.
2. Menu → **Add to Home Screen** / **Install app**, then open it from the home screen.
3. Settings → "Offline use" should say **Ready**. Turn on aeroplane mode, reopen the app, browse and study.
4. Settings → **Save backup file**: the file should download (Files app on iPhone, Downloads on Android).

## Notes for students (put these in your class announcement)

- **Add it to your home screen.** On iPhone, Safari can clear data for websites you haven't opened for about a week;
  apps added to the home screen are not affected.
- **Your progress is only on your phone.** Use Settings → *Save backup file* now and then (the app reminds you weekly),
  and *Import a backup* on a new phone.
- No sign-up and no tracking: Vercel only serves the files; nothing you do in the app is sent anywhere.

## Before sharing publicly

The questions and images come from *MASTERPIECE – OSCE RADIOLOGY* (HUMBLE_PHD, Kpanjen MD and contributors,
credited on the About page). Get the authors' agreement before sharing the link beyond your class.
