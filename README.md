# Task Reminder App — Native Android app

A phone-first reminder app as a real native Android app (Capacitor +
Next.js static export). It is the same core app as the Muse version
(artifact `task-reminder-app`), with no server, no API keys and no
Muse dependency. It is NOT a PWA — no manifest, no service worker,
no install prompt.

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
- **Voice capture** — only via the centre **Ultron** mic in the bottom nav (no separate “Say a task” button anywhere). Tap Ultron's mic, speak (Web Speech API, continuous listening until you tap Stop), and Ultron understands it — create a task, set a reminder, mark done, or move it. Ultron's chat also parses typed text the same way.
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
- **Data** — everything lives ONLY in Supabase (cloud). Nothing is
  saved on the phone — no localStorage at all. In-memory state only
  while the app runs; every change is saved to Supabase.

## Data: Supabase only (no local storage)

Pranav's rule: **do not save tasks/memory on the phone at all** —
phone storage is not optimised for that much data. Supabase is the
only store. There is no localStorage in the app any more.

**Where data lives in each mode:**
- **Supabase configured:** on app start the app loads projects,
  tasks, Ultron reminders, settings and profile from Supabase, and
  every change is saved there (debounced, ~800 ms). Nothing is
  written to the phone.
- **Supabase NOT configured:** the app shows "Supabase is NOT
  connected" in Profile, data lives only in memory for that session
  and is lost when the app closes. Nothing is silently saved locally.

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
   → Actions). The workflow passes them to the build; **without these
   secrets the APK cannot use Supabase at all** — it will show
   "Supabase is NOT connected" and keep data only in memory.

**v1 security note:** RLS is ON, but the policy allows the anon key
full access so the single-user app works without login. Proper
per-user auth (Supabase Auth + RLS scoped to `auth.uid()`) is the
next step — do not use the v1 policy for a multi-user app.

## Native Android app (APK)

The same web app is wrapped with **Capacitor** (`android/`,
app id `com.pranav.taskreminder`) so it installs as a real Android
app, not as a PWA.

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

**Native Android (no PWA):**
- Reminders are scheduled on the phone with Capacitor
  LocalNotifications (exact alarms), so the notification fires
  even when the app is closed. Voice uses the phone's free voices
  (`en-IN` / `hi-IN` / `mr-IN`) in the WebView.
- Honest limit: the voice speaks when the app opens or
  when you tap the notification — Android does not let a WebView
  app speak out loud from a fully closed state without a
  foreground service.

**Build the APK locally (needs Java 21 + Android SDK, Capacitor 8):**
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

## Notifications & background — honest limitation

While the app is **open**, it checks every minute and, 2 hours before a
task is due (or if you miss it), it shows a browser Notification **and**
an in-app friendly reminder — *“Hey Pranav, you haven't done X yet,
have you done it? Want me to mark it done or move it?”* — and speaks
it with the phone's free voice if voice reminders are on.

The native app schedules exact alarms with Android, so notifications
fire even when the app is closed. A voice note cannot auto-play out
loud by itself from a fully closed state — the voice speaks when the
app opens or when you tap the notification.

## Files

- `app/` — Next.js App Router (`layout.tsx`, `page.tsx`, `globals.css`)
- `src/lib/core.ts` — types, seed data, voice parsing,
  speech helpers (async Web Speech voices)
- `src/lib/native.ts` — Capacitor bridge: scheduled local
  notifications on Android (no-op on web), native text-to-speech
  via @capacitor-community/text-to-speech
- `src/lib/supabase.ts` — Supabase client + sync layer
  (load from / save to Supabase, debounced; Supabase is the only store)
- `supabase/migrations/001_init.sql` + `002_priority_very_normal.sql` — Postgres schema for
  `projects`, `tasks`, `ultron_reminders`, `app_settings` (+ RLS). Run 002 as well if 001 was already applied.
- `android/` — Capacitor Android project (app id
  `com.pranav.taskreminder`); `android/app/src/main/AndroidManifest.xml`
  declares notification / exact-alarm / boot permissions
- `.github/workflows/android-release.yml` — GitHub Actions: build
  the web app, sync Capacitor, build the debug APK, publish it
  to the v1.0.0 GitHub Release
- `public/icon-*.png` — app icons (no PWA manifest / service worker — this is a native Android app)
- `next.config.js` — `output: 'export'` (static, no server)
