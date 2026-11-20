# Task Reminder App — Standalone PWA

A phone-first reminder app, rebuilt as a standalone Next.js app so it can be
hosted on its own and installed on a phone as a PWA. It is the same core
app as the Muse version (artifact `task-reminder-app`), with no server,
no API keys and no Muse dependency.

## What it does

- **Projects (main tasks)** — Fitness app, E-commerce hub, Sarvana Studio
  (starter data), plus add your own, with name, description, due date,
  priority and colour.
- **Tasks** — title, sub-description, project, due date/time, daily or
  one-off, priority `high_alert` / `high` / `normal`, reminders per day.
- **Home** — active daily reminders and today's open tasks.
- **Schedule** — separate Monthly / Weekly / Daily views.
- **Calendar** — month view with task counts; past dates are green
  (all done), red (remaining) or yellow (half done).
- **Reminders inbox** — overdue, due-today, daily and high-alert items,
  with Snooze (1 hour / this evening / tomorrow morning) and Dismiss.
- **Voice capture** — tap the mic, speak (Web Speech API, live dictation),
  then **Understand my task** parses it into an editable draft
  (title, notes, due date/time like “2 o'clock” / “evening”, priority,
  project). You review and edit before saving.
- **Listen / read aloud** — a small speaker 🔊 button on Home reads
  today's tasks aloud, plus per-task Listen, using the phone's free
  `speechSynthesis` voices. Language picker:
  English / Hindi / Marathi (`en-IN` / `hi-IN` / `mr-IN`, default fallback).
- **Ultron — AI assistant** — the 🤖 icon in the centre of the bottom
  navigation. Warm, calm, precise like Jarvis / Vision (helpful, NOT
  villainous, despite the name). Ultron is the main brain of the app:
  chat (type or speak, English / Hinglish / Hindi / Marathi), grounded
  only in your real local tasks/projects — it never invents tasks.
  It can list today's tasks, summarise what is pending/overdue, create
  a task, mark a task done, and move/reschedule a task. Say
  “remind me at 2pm with a voice reminder” and Ultron parses the time,
  creates a scheduled reminder stored locally, confirms it friendly,
  and that reminder later triggers a browser Notification + speaks
  aloud with `speechSynthesis` when the app can run it. Telling
  Ultron IS the scheduling — no separate setup needed.
  Ultron also answers free-form questions about your day and week
  from your real data: “what's my week look like?” (day-by-day for
  the next 7 days), “what do I have tomorrow?”, “what's overdue?”,
  “how am I doing?” (done / open / overdue counts and %), “what's
  next?” (most important open task), and questions about a project
  (“how is Sarvana Studio going?”). If it does not know, it says so
  from your actual counts instead of guessing.
- **Settings (Account / Profile)** — clear on/off toggles, all ON by
  default, stored in `localStorage`: Background reminders, Voice
  reminders, Ultron assistant, Notifications, plus Voice language
  (English / Hindi / Marathi) and Reminder lead time (default 2 hours
  before due). Background reminders OFF = nothing is scheduled or
  notified. Voice reminders OFF = text notifications only, no speech.
- **Profile** — name, role/headline, bio, Muse colour themes, progress
  shown as GitHub-style green contribution squares, and the voice
  keyword list (`main task`, `today task`, `tomorrow task`, `monthly task`).
- **Settings** — defaults ON: notifications enabled, background
  reminders on, voice reminders on, Ultron assistant on, reminder
  **2 hours before** a task is due, friendly voice reminders on, voice
  language English. It asks for Notification permission and explains
  the limit below.
- **Data** — by default everything is stored in the browser's
  `localStorage` (`task-reminder-standalone-v1`). When Supabase is
  configured (see below), tasks/projects/reminders also sync to
  Supabase, so they are not only on the phone. No account, no server
  of our own.

## Data: Supabase (cloud) or localStorage (phone only)

Pranav's rule: **do not save tasks/memory only on the phone** — phone
storage is not optimised for that much data. So Supabase is the
backend when it is configured, and localStorage is only the offline
fallback.

**Where data lives in each mode:**
- **Supabase configured:** on app start the app loads projects,
  tasks, Ultron reminders, settings and profile from Supabase, and
  every change is saved there (debounced, ~800 ms) as well as to
  localStorage. localStorage stays as an offline cache.
- **Supabase NOT configured:** everything lives only in the phone's
  localStorage, exactly as before. The app still works offline, and
  the Settings screen says “saved only on this phone”.

**Set it up (no real keys in this repo — placeholders only):**
1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase dashboard: **SQL Editor → New query**, paste
   `supabase/migrations/001_init.sql` from this repo and Run it.
   It creates `projects`, `tasks`, `ultron_reminders` and
   `app_settings` (with starter projects), enables RLS with a
   permissive anon policy for v1, and adds indexes.
3. Copy your project's URL and anon key from
   **Project Settings → API**.
4. Locally, create `.env.local` (never commit it — it is gitignored):
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   ```
5. For the GitHub Actions APK build, add the same two values as
   GitHub repo secrets named `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Settings → Secrets and variables
   → Actions). The workflow passes them to the build; if they are
   absent, the build still passes and the APK falls back to
   localStorage only.

**v1 security note:** RLS is ON, but the policy allows the anon key
full access so the single-user app works without login. Proper
per-user auth (Supabase Auth + RLS scoped to `auth.uid()`) is the
next step — do not use the v1 policy for a multi-user app.

## Native Android app (APK)

The same web app is wrapped with **Capacitor** (`android/`,
app id `com.pranav.taskreminder`) so it installs as a real Android
app instead of only a PWA.

**How the APK is built:** GitHub Actions
(`.github/workflows/android-release.yml`) runs on every push to
`main` and on manual dispatch: `npm ci` → `npm run build` (static
export) → `npx cap sync android` → Gradle `assembleDebug` → the
APK is uploaded as a workflow artifact and attached to the
**v1.0.0 GitHub Release**. No signing keystore is invented — this
is a **debug-signed APK for testing**; release signing comes later.

**Install it:** download `app-debug.apk` from the v1.0.0 release,
tap it, allow installing from this source, open Task Reminder and
allow Notifications when asked.

**Native vs PWA:**
- Native: reminders are scheduled on the phone with Capacitor
  LocalNotifications (exact alarms), so the notification fires
  even when the app is closed. Voice uses the phone's free voices
  (`en-IN` / `hi-IN` / `mr-IN`) in the WebView.
- PWA: notifications work best when the app was opened recently;
  it cannot guarantee an exact background alarm when fully closed.
- Honest limit (both): the voice speaks when the app opens or
  when you tap the notification — Android does not let a WebView
  app speak out loud from a fully closed state without a
  foreground service.

**Build the APK locally (needs Java 17 + Android SDK, not
installed in this workspace):**
```bash
npm run build
npx cap sync android
./android/gradlew -p android assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # static export → out/
```

## Deploy to Vercel

1. Push this folder to GitHub.
2. In Vercel: **Add New → Project → Import** the repo.
3. Framework preset: **Next.js**. No build command override needed
   (`npm run build`); output directory is `out/` (static export).
4. Deploy. The site is static — no server functions, no env vars.

GitHub Pages also works: `npm run build`, then publish the `out/`
folder (note: `manifest.json` / `sw.js` paths are root-relative, so
serve from the domain root or a custom domain, not a `/repo/` sub-path).

## Install as a PWA on Android

1. Open the deployed site in Chrome on your phone.
2. Tap **⋮ → Add to Home screen** (or **Install app** if Chrome offers it).
3. It opens full-screen, works offline after the first visit
   (service worker in `public/sw.js`), and appears in the app drawer.

## Notifications & background — honest limitation

While the app is **open**, it checks every minute and, 2 hours before a
task is due (or if you miss it), it shows a browser Notification **and**
an in-app friendly reminder — *“Hey Pranav, you haven't done X yet,
have you done it? Want me to mark it done or move it?”* — and speaks
it with the phone's free voice if voice reminders are on.

A PWA on Android Chrome **cannot guarantee an exact background voice
alarm when fully closed**. Notifications work best when the app has
been opened recently; the browser/OS may delay or suppress them when
the app has been closed for a long time, and a voice note cannot
auto-play out loud by itself. This app does **not** claim to be a
native alarm. For a guaranteed ringing voice alarm, a native Android
app would be needed.

## Files

- `app/` — Next.js App Router (`layout.tsx`, `page.tsx`, `globals.css`)
- `src/lib/core.ts` — types, seed data, localStorage, voice parsing,
  speech helpers
- `src/lib/native.ts` — Capacitor bridge: scheduled local
  notifications on Android (no-op on web/PWA)
- `src/lib/supabase.ts` — Supabase client + sync layer
  (load from / save to Supabase, debounced; localStorage fallback)
- `supabase/migrations/001_init.sql` — Postgres schema for
  `projects`, `tasks`, `ultron_reminders`, `app_settings` (+ RLS)
- `android/` — Capacitor Android project (app id
  `com.pranav.taskreminder`); `android/app/src/main/AndroidManifest.xml`
  declares notification / exact-alarm / boot permissions
- `.github/workflows/android-release.yml` — GitHub Actions: build
  the web app, sync Capacitor, build the debug APK, publish it
  to the v1.0.0 GitHub Release
- `public/manifest.json`, `public/sw.js`, `public/icon-*.png` — PWA
- `next.config.js` — `output: 'export'` (static, no server)
