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
- **Data** — everything is stored in the browser's `localStorage`
  (`task-reminder-standalone-v1`). No account, no server, no sync.

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
- `public/manifest.json`, `public/sw.js`, `public/icon-*.png` — PWA
- `next.config.js` — `output: 'export'` (static, no server)
