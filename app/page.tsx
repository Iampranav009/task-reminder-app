'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppData, MuseTheme, Priority, Project, Settings, Task, THEMES, UltronReminder, VOICE_KEYWORDS, findTaskByWords, parseTimeOfDay, parseVoiceTask, seedData, taskSpeechText, todayStr, addDaysStr } from '../src/lib/core';
import { checkMicrophonePermission, checkNativeNotificationPermission, isNativeApp, openTtsInstall, requestMicrophonePermission, requestNativeNotificationPermission, rescheduleNativeReminders, sendTestNativeNotification, speakAloud, stopAloud, type NativeReminder } from '../src/lib/native';
import { debouncedSaveToSupabase, loadFromSupabase, supabaseConfigured } from '../src/lib/supabase';
import Avatar, { type AvatarState } from '@/components/ui/components-primitives-avatar';
import { Bell, Calendar, CalendarDays, ChevronLeft, ChevronRight, Home as HomeIcon, Mic, Pencil, Plus, Search, Send, Square, Trash2, User, Volume2, X } from 'lucide-react';

type View = 'today' | 'schedule' | 'calendar' | 'reminders' | 'profile';
const LANGS = [{ v: 'en-IN', l: 'English' }, { v: 'hi-IN', l: 'हिन्दी · Hindi' }, { v: 'mr-IN', l: 'मराठी · Marathi' }] as const;

export default function Home() {
  const [data, setData] = useState<AppData>(() => seedData());
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>('today');
  const [search, setSearch] = useState('');
  const [schedTab, setSchedTab] = useState<'monthly' | 'weekly' | 'daily'>('daily');
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState({ title: '', notes: '', projectId: '', dueDate: '', dueTime: '', kind: 'task' as 'task' | 'daily', priority: 'normal' as Priority });
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projForm, setProjForm] = useState({ name: '', description: '', dueDate: '', priority: 'normal' as Priority, color: '#0E7C6B' });
  // Mic sessions: the recogniser must keep listening until Stop is tapped.
  // Web Speech fires onend after a pause / ~60s, so the session flag +
  // auto-restart below keeps it going instead of closing after ~1 second.
  const voiceSessionRef = useRef(false);
  const ultronSessionRef = useRef(false);
  const ultronRestartRef = useRef<number | null>(null);
  const [micHint, setMicHint] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ultronOpen, setUltronOpen] = useState(false);
  const [ultronMsgs, setUltronMsgs] = useState<{ role: 'user' | 'ultron'; text: string }[]>([{ role: 'ultron', text: 'Hey Pranav, I am Ultron. Ask me about your day or your week, or say “remind me at 2pm with a voice reminder”.' }]);
  const [ultronInput, setUltronInput] = useState('');
  const [ultronListening, setUltronListening] = useState(false);
  const [ultronSpeaking, setUltronSpeaking] = useState(false);
  const ultronSpeakTimerRef = useRef<number | null>(null);
  // Avatar face: listening while the mic hears Pranav, speaking while
  // Ultron's reply is being spoken aloud, idle otherwise.
  const ultronAvatarState: AvatarState = ultronListening ? 'listening' : ultronSpeaking ? 'speaking' : 'idle';
  const [notifState, setNotifState] = useState('unknown');
  // Microphone permission, shown in Profile > Settings next to Notifications.
  // 'granted' | 'denied' | 'prompt' (not asked yet) | 'unknown'.
  const [micState, setMicState] = useState('unknown');
  // Where the data lives: Supabase is the ONLY store (user decision,
  // 20 Nov 2026 — no localStorage any more). 'unconfigured' = the app
  // was built without the Supabase URL/anon key; 'supabase-error' =
  // configured but the cloud could not be reached, so nothing is
  // saved rather than risk overwriting the cloud with seed data.
  const [dataSource, setDataSource] = useState<'supabase' | 'unconfigured' | 'supabase-error'>('unconfigured');
  const [cloudReady, setCloudReady] = useState(false);
  const recogRef = useRef<unknown>(null);
  // Ultron conversation context — what he remembers from this chat so
  // follow-ups like "mark it done", "move it to tomorrow", "remind me
  // at 2pm" or just "yes" work without repeating the task name.
  const ultronCtxRef = useRef<{ lastTaskId: number | null; lastTaskTitle: string | null; lastOffer: 'reminder' | null }>({ lastTaskId: null, lastTaskTitle: null, lastOffer: null });
  const awaitingTimeForRef = useRef<number | null>(null);
  // Live voice capture: what Ultron is hearing right now (interim) and
  // the final transcript so far. A final result auto-sends (see the
  // pendingVoiceSend effect) so speaking alone gets a reply.
  const [ultronHeard, setUltronHeard] = useState<string | null>(null);
  const [pendingVoiceSend, setPendingVoiceSend] = useState<string | null>(null);
  const finalTranscriptRef = useRef('');
  const autoSendRef = useRef<number | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const ultronInputRef = useRef<HTMLTextAreaElement | null>(null);

  async function loadCloud(): Promise<boolean> {
    if (!supabaseConfigured()) { setDataSource('unconfigured'); setCloudReady(false); return false; }
    const remote = await loadFromSupabase().catch(() => null);
    if (!remote) { setDataSource('supabase-error'); setCloudReady(false); return false; }
    // Supabase is the source of truth — even empty tables replace the
    // in-memory seed data, so the phone never invents tasks the cloud
    // does not have.
    setData((d) => ({
      ...d,
      projects: remote.projects ?? [],
      tasks: remote.tasks ?? [],
      ultronReminders: remote.ultronReminders ?? [],
      ...(remote.settings ? { settings: { ...d.settings, ...remote.settings } } : {}),
      ...(remote.profile ? { profile: { ...d.profile, ...remote.profile } } : {}),
    }));
    setDataSource('supabase');
    setCloudReady(true);
    return true;
  }

  useEffect(() => {
    // In-memory seed defaults only until the cloud answers. Nothing is
    // read from or written to this phone's storage.
    loadCloud().catch(() => { setDataSource('supabase-error'); setCloudReady(false); }).finally(() => setLoaded(true));
  }, []);
  // Save every change to Supabase — and only after the cloud has loaded,
  // so seed defaults can never overwrite real cloud data.
  useEffect(() => { if (loaded && cloudReady) debouncedSaveToSupabase(data); }, [data, loaded, cloudReady]);
  // Scroll the Ultron chat to the newest message.
  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [ultronMsgs, ultronOpen]);
  // Shrink the Ultron input back to one line once it is sent / cleared.
  useEffect(() => { if (!ultronInput) growUltronInput(ultronInputRef.current); }, [ultronInput]);
  // A spoken final transcript auto-sends once Ultron has heard it, so
  // talking alone gets a reply — no need to tap Send. Runs after
  // re-render, so handleUltronSend sees the latest task data.
  useEffect(() => {
    if (!pendingVoiceSend) return;
    const text = pendingVoiceSend;
    setPendingVoiceSend(null);
    setUltronInput('');
    setUltronHeard(null);
    handleUltronSend(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVoiceSend]);
  // Apple normal mode: --accent is white, no red anywhere. Ultron mode
  // (sheet open): --accent/--accent2 switch to crimson/ember and the
  // body gets .ultron-mode, so the red gradient + red buttons appear
  // only while Ultron is open. The saved Profile theme never forces red.
  useEffect(() => {
    const root = document.documentElement;
    if (ultronOpen) {
      root.style.setProperty('--accent', '#e1061f');
      root.style.setProperty('--accent2', '#ff6a1a');
      document.body.classList.add('ultron-mode');
    } else {
      root.style.setProperty('--accent', '#f5f5f7');
      root.style.setProperty('--accent2', '#a1a1aa');
      document.body.classList.remove('ultron-mode');
    }
    return () => document.body.classList.remove('ultron-mode');
  }, [ultronOpen]);
  // Native Android app: no service worker, no PWA install prompt.
  // Read the real notification permission on start so Settings shows it.
  useEffect(() => {
    (async () => {
      if (isNativeApp()) {
        const p = await checkNativeNotificationPermission();
        if (p) setNotifState(p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default');
      } else if ('Notification' in window) {
        setNotifState(Notification.permission);
      }
      // Microphone: navigator.permissions in the WebView reports the
      // real RECORD_AUDIO state once the manifest declares it.
      setMicState(await checkMicrophonePermission());
    })();
    return () => {
      voiceSessionRef.current = false;
      ultronSessionRef.current = false;
      if (ultronRestartRef.current) window.clearTimeout(ultronRestartRef.current);
      (recogRef.current as { stop?: () => void } | null)?.stop?.();
    };
  }, []);
  // Reminder checker: every minute while the app is open.
  useEffect(() => {
    if (!loaded) return;
    const check = () => {
      const now = new Date(); const today = todayStr(now);
      // Ultron-scheduled voice reminders (stored in Supabase, not on the phone).
      if (data.settings.backgroundReminders) {
        for (const r of data.ultronReminders.filter((x) => !x.fired)) {
          const at = new Date(`${r.date}T${r.time}:00`).getTime();
          if (now.getTime() >= at && now.getTime() < at + 5 * 60 * 1000) {
            const msg = `Hey ${data.profile.name || 'Pranav'}, ${r.message}`;
            setToast(msg);
            if (data.settings.voiceReminders) void speakAloud(msg, data.settings.voiceLang);
            if (data.settings.notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') { try { new Notification('Ultron reminder', { body: msg, icon: '/icon-192.png' }); } catch { /* ignore */ } }
            setData((d) => ({ ...d, ultronReminders: d.ultronReminders.map((x) => x.id === r.id ? { ...x, fired: true } : x) }));
          }
        }
      }
      if (!data.settings.backgroundReminders || !data.settings.notificationsEnabled) return;
      const beforeMs = data.settings.reminderMinutesBefore * 60 * 1000;
      const open = data.tasks.filter((t) => t.status === 'todo' && !(data.snoozedUntil[t.id] && new Date(data.snoozedUntil[t.id]) > now));
      for (const t of open) {
        const due = t.dueDate || (t.kind === 'daily' ? today : null);
        if (!due || due !== today) continue;
        const dueAt = new Date(`${due}T${t.dueTime || '09:00'}:00`).getTime();
        const key = `${t.id}-${due}-${t.dueTime || ''}`;
        const inWindow = now.getTime() >= dueAt - beforeMs && now.getTime() <= dueAt + 2 * 60 * 60 * 1000;
        const missed = now.getTime() > dueAt && now.getTime() <= dueAt + 2 * 60 * 60 * 1000;
        if (!inWindow && !missed) continue;
        if (data.reminded[key]) continue;
        const msg = missed
          ? `Hey ${data.profile.name || 'Pranav'}, you haven't done “${t.title}” yet — it was due at ${t.dueTime || 'today'}. Have you done it? Want me to mark it done or move it?`
          : `Hey ${data.profile.name || 'Pranav'}, “${t.title}” is due at ${t.dueTime || 'today'}. Have you got it ready?`;
        setToast(msg);
        if (data.settings.voiceReminders) void speakAloud(msg, data.settings.voiceLang);
        if (data.settings.notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
          try { new Notification('Task Reminder', { body: msg, icon: '/icon-192.png' }); } catch { /* ignore */ }
        }
        setData((d) => ({ ...d, reminded: { ...d.reminded, [key]: new Date().toISOString() } }));
      }
    };
    check(); const id = setInterval(check, 60000); return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, data.tasks, data.settings, data.profile.name, data.ultronReminders]);

  const save = (fn: (d: AppData) => AppData) => setData((d) => fn(d));

  // Native Android: hand upcoming reminders to the device's AlarmManager
  // via Capacitor LocalNotifications, so they fire even when the app is
  // closed. No-op on the web / PWA (isNativeApp() is false there).
  // Re-schedules only when the list of upcoming reminders actually changes.
  const nativeSigRef = useRef('');
  useEffect(() => {
    if (!loaded || !isNativeApp()) return;
    if (!data.settings.backgroundReminders || !data.settings.notificationsEnabled) return;
    const now = Date.now();
    const list: NativeReminder[] = [];
    const lead = data.settings.reminderMinutesBefore * 60 * 1000;
    for (const t of data.tasks.filter((x) => x.status === 'todo' && x.dueDate && x.dueTime)) {
      const at = new Date(`${t.dueDate}T${t.dueTime}:00`).getTime() - lead;
      if (at > now) list.push({ id: t.id, title: 'Task Reminder', body: `Hey ${data.profile.name || 'Pranav'}, “${t.title}” is due at ${t.dueTime}. Have you done it yet?`, at: new Date(at) });
    }
    for (const r of data.ultronReminders.filter((x) => !x.fired)) {
      const at = new Date(`${r.date}T${r.time}:00`).getTime();
      if (at > now) list.push({ id: 100000 + r.id, title: 'Ultron reminder', body: `Hey ${data.profile.name || 'Pranav'}, ${r.message}`, at: new Date(at) });
    }
    const sig = JSON.stringify(list.map((x) => [x.id, x.at.getTime()]));
    if (sig === nativeSigRef.current) return;
    nativeSigRef.current = sig;
    rescheduleNativeReminders(list).catch(() => {});
  }, [loaded, data.tasks, data.ultronReminders, data.settings, data.profile.name]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.tasks.filter((t) => !q || t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
  }, [data.tasks, search]);
  const today = todayStr();
  const todayTasks = filtered.filter((t) => t.status === 'todo' && (t.kind === 'daily' || t.dueDate === today || (t.dueDate && t.dueDate < today)));
  const doneToday = data.tasks.filter((t) => t.status === 'done').length;
  const reminders = useMemo(() => {
    const now = new Date();
    const list: { key: string; kind: string; text: string; task: Task }[] = [];
    for (const t of data.tasks) {
      if (t.status === 'done') continue;
      if (data.snoozedUntil[t.id] && new Date(data.snoozedUntil[t.id]) > now) continue;
      if (t.dueDate && t.dueDate < today) list.push({ key: `overdue-${t.id}`, kind: 'Overdue', text: `Overdue since ${t.dueDate}: “${t.title}”.`, task: t });
      else if (t.dueDate === today) list.push({ key: `today-${t.id}`, kind: 'Due today', text: `Due today${t.dueTime ? ` at ${t.dueTime}` : ''}: “${t.title}”.`, task: t });
      if (t.kind === 'daily' && t.dailyDoneOn !== today) list.push({ key: `daily-${t.id}`, kind: 'Daily', text: `Daily task not done yet today: “${t.title}”.`, task: t });
      if (t.priority === 'high_alert') list.push({ key: `alert-${t.id}`, kind: 'High alert', text: `High alert: “${t.title}” — ${t.remindersPerDay || 3} reminders a day.`, task: t });
    }
    return list.filter((r) => !data.dismissed[r.key]);
  }, [data, today]);

  function toggleTask(t: Task) {
    save((d) => {
      const tasks = d.tasks.map((x) => {
        if (x.id !== t.id) return x;
        if (x.kind === 'daily') return { ...x, dailyDoneOn: x.dailyDoneOn === today ? null : today };
        const done = x.status !== 'done';
        return { ...x, status: (done ? 'done' : 'todo') as Task['status'], completedAt: done ? new Date().toISOString() : null };
      });
      const log = t.status === 'done' ? d.completedLog : [...new Set([...d.completedLog, today])];
      return { ...d, tasks, completedLog: log };
    });
  }
  function openNewTask() { setEditing(null); setForm({ title: '', notes: '', projectId: '', dueDate: '', dueTime: '', kind: 'task', priority: 'normal' }); setShowTaskForm(true); }
  function openEditTask(t: Task) { setEditing(t); setForm({ title: t.title, notes: t.notes, projectId: t.projectId ? String(t.projectId) : '', dueDate: t.dueDate || '', dueTime: t.dueTime || '', kind: t.kind, priority: t.priority }); setShowTaskForm(true); }
  function saveTaskForm() {
    if (!form.title.trim()) return;
    save((d) => {
      if (editing) return { ...d, tasks: d.tasks.map((x) => x.id === editing.id ? { ...x, title: form.title.trim(), notes: form.notes, projectId: form.projectId ? Number(form.projectId) : null, dueDate: form.dueDate || null, dueTime: form.dueTime || null, kind: form.kind, priority: form.priority } : x) };
      const id = Math.max(0, ...d.tasks.map((x) => x.id)) + 1;
      return { ...d, tasks: [...d.tasks, { id, title: form.title.trim(), notes: form.notes, projectId: form.projectId ? Number(form.projectId) : null, dueDate: form.dueDate || null, dueTime: form.dueTime || null, kind: form.kind, priority: form.priority, remindersPerDay: form.priority === 'high_alert' ? 3 : 0, status: 'todo', completedAt: null, dailyDoneOn: null }] };
    });
    setShowTaskForm(false);
  }
  function snoozeTask(t: Task, when: 'hour' | 'evening' | 'morning') {
    const until = new Date();
    if (when === 'hour') until.setHours(until.getHours() + 1);
    else if (when === 'evening') { until.setHours(18, 0, 0, 0); if (until.getTime() < Date.now()) until.setDate(until.getDate() + 1); }
    else { until.setDate(until.getDate() + 1); until.setHours(8, 0, 0, 0); }
    save((d) => ({ ...d, snoozedUntil: { ...d.snoozedUntil, [t.id]: until.toISOString() } }));
  }
  async function checkNotifStatus() {
    if (isNativeApp()) {
      const p = await checkNativeNotificationPermission();
      if (p) setNotifState(p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default');
      return;
    }
    if ('Notification' in window) setNotifState(Notification.permission);
  }
  async function checkMicStatus() {
    setMicState(await checkMicrophonePermission());
  }
  async function askMicrophone() {
    // The getUserMedia warm-up triggers Android's system prompt
    // ("Allow Task Reminder to record audio?") via MainActivity's
    // WebChromeClient. If the user taps Allow, Microphone then appears
    // under Allowed in Android Settings > Apps > Task Reminder.
    const ok = await requestMicrophonePermission();
    setMicState(ok ? 'granted' : await checkMicrophonePermission());
    if (ok) {
      setToast('Microphone on — tap Ultron and speak, I will keep listening until you tap Stop.');
    } else {
      setToast('Microphone was not allowed. Go to Android Settings > Apps > Task Reminder > Permissions > Microphone > Allow — no need to reinstall — then tap Re-check.');
    }
  }
  async function sendTestNotification() {
    if (isNativeApp()) {
      if (await sendTestNativeNotification()) { setToast('Test notification sent — check your notification shade.'); return; }
      setToast('Could not send a test notification. Check that notifications are allowed for this app.');
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Task Reminder — test', { body: 'Notifications are on. Ultron will remind you here.', icon: '/icon-192.png' }); setToast('Test notification sent.'); } catch { setToast('Could not send a test notification.'); }
    } else setToast('Notifications are not allowed yet — tap Allow notifications first.');
  }
  async function askNotifications() {
    if (isNativeApp()) {
      const ok = await requestNativeNotificationPermission();
      setNotifState(ok ? 'granted' : 'denied');
      // Save the result: notifications toggle follows the real permission.
      save((d) => ({ ...d, settings: { ...d.settings, notificationsEnabled: ok } }));
      if (ok) {
        setToast('Notifications on — reminders are scheduled on your phone, so they fire even when the app is closed.');
        await sendTestNativeNotification();
      } else {
        setToast('Notification permission was not granted. Turn it on in Android Settings > Apps > Task Reminder > Notifications, then tap Re-check.');
      }
      return;
    }
    if (!('Notification' in window)) { setToast('Notifications are not supported in this browser.'); return; }
    const p = await Notification.requestPermission(); setNotifState(p);
    save((d) => ({ ...d, settings: { ...d.settings, notificationsEnabled: p === 'granted' } }));
    if (p === 'granted') { setToast('Notifications on — I will remind you 2 hours before a task is due, and again if you miss it.'); await sendTestNotification(); }
    else setToast('Notification permission was not granted. You can turn it on in Settings, or in your browser site settings.');
  }
  async function listen(text: string, id: string) {
    if (speaking === id) { await stopAloud(); setSpeaking(null); return; }
    // Native Android TTS first, Web Speech fallback — never the old
    // sync check that said "not available" while a voice existed.
    const ok = await speakAloud(text, data.settings.voiceLang);
    if (ok) { setSpeaking(id); return; }
    setToast('Speech is not available on this device — no voice engine answered. Check that Google Text-to-Speech is installed and enabled (Android Settings > Apps), then try again.');
    if (isNativeApp()) { await openTtsInstall(); }
  }
  async function testVoice() {
    const ok = await speakAloud('Hey Pranav, this is Ultron. Your voice is working.', data.settings.voiceLang);
    if (ok) setToast('Voice is working — you should have heard Ultron speak.');
    else {
      setToast('No voice engine answered. Opening the Android TTS installer — install the voice data, then try again.');
      await openTtsInstall();
    }
  }
  function listenToday() {
    const items = todayTasks.filter((t) => t.status === 'todo');
    if (!items.length) { setToast('No open tasks for today to read out.'); return; }
    listen(items.map((t) => taskSpeechText(t)).join(' '), 'today');
  }
  // Speak an Ultron reply aloud (only when Voice reminders is ON).
  // Native Android TTS speaks promptly in the chosen language
  // (en-IN / hi-IN / mr-IN); the avatar shows "speaking" while it
  // talks, and the safety net clears it if the engine never reports back.
  async function speakUltron(text: string) {
    if (typeof window === 'undefined') return;
    if (!data.settings.voiceReminders) return;
    if (ultronSpeakTimerRef.current) clearTimeout(ultronSpeakTimerRef.current);
    setUltronSpeaking(true);
    try {
      // Race the engine against a time budget so a silent engine can
      // never leave the avatar stuck in "speaking".
      const budget = Math.min(60000, Math.max(4000, text.length * 90));
      await Promise.race([speakAloud(text, data.settings.voiceLang), new Promise((r) => { ultronSpeakTimerRef.current = window.setTimeout(r, budget); })]);
    } catch { /* a silent reply is better than a stuck speaking state */ }
    if (ultronSpeakTimerRef.current) { clearTimeout(ultronSpeakTimerRef.current); ultronSpeakTimerRef.current = null; }
    setUltronSpeaking(false);
  }
  function ultronReply(text: string) { setUltronMsgs((m) => [...m, { role: 'ultron', text }]); speakUltron(text); }
  function handleUltronSend(raw: string) {
    const text = raw.trim(); if (!text) return;
    setUltronMsgs((m) => [...m, { role: 'user', text }]); setUltronInput('');
    if (!data.settings.ultronEnabled) { ultronReply('Ultron is switched off in Settings. Turn Ultron on there and I will help you again.'); return; }
    const lower = text.toLowerCase();
    const open = data.tasks.filter((t) => t.status === 'todo');
    const todayOpen = open.filter((t) => t.kind === 'daily' || t.dueDate === today || (t.dueDate && t.dueDate < today));
    // --- Conversation context: remember the task just talked about, so
    // "mark it done", "move it to tomorrow", "remind me at 2pm" (no
    // name) and a plain "yes" all act on the right task. ---
    const ctx = ultronCtxRef.current;
    const rememberTask = (t: Task | null) => { if (t) { ctx.lastTaskId = t.id; ctx.lastTaskTitle = t.title; } };
    const resolveTask = (list: Task[] = data.tasks): Task | null => {
      const named = findTaskByWords(list, text);
      if (named) return named;
      // No name in this message — "it", "that one", or a bare action
      // ("mark it done", "move it") means the task we just discussed.
      if (ctx.lastTaskId) return list.find((t) => t.id === ctx.lastTaskId) || data.tasks.find((t) => t.id === ctx.lastTaskId) || null;
      return null;
    };
    // Ultron just asked "what time?" for a reminder — a bare time
    // ("2pm", "tomorrow at 9") answers that question.
    if (awaitingTimeForRef.current) {
      const time = parseTimeOfDay(text);
      if (time) {
        const taskId = awaitingTimeForRef.current;
        awaitingTimeForRef.current = null;
        const task = data.tasks.find((t) => t.id === taskId);
        const date = lower.includes('tomorrow') ? addDaysStr(today, 1) : today;
        const title = task ? task.title : ctx.lastTaskTitle || 'your task';
        const id = Math.max(0, ...data.ultronReminders.map((r) => r.id)) + 1;
        const msg = `this is your reminder for “${title}” at ${time}. Have you done it yet? Want me to mark it done or move it?`;
        save((d) => ({ ...d, ultronReminders: [...d.ultronReminders, { id, title, taskId: task ? task.id : null, date, time, message: msg, fired: false, createdAt: new Date().toISOString() }] }));
        ctx.lastOffer = null;
        ultronReply(`Done, Pranav. I have set a friendly voice reminder for “${title}” at ${time} on ${date}. I will notify you and speak it aloud then.`);
        return;
      }
    }
    // A plain "yes" accepts Ultron's last offer (e.g. "Want me to set
    // a voice reminder for it?") — then he asks what time.
    if (/^(yes|yeah|yep|ok|okay|sure|do it|please|haan|ha)\b/.test(lower) && ctx.lastOffer === 'reminder' && ctx.lastTaskId) {
      awaitingTimeForRef.current = ctx.lastTaskId;
      ultronReply(`Great — what time should I remind you about “${ctx.lastTaskTitle}”? Say it like “2pm” or “tomorrow at 9”.`);
      return;
    }
    if (/^(no|nope|not now|later)\b/.test(lower) && ctx.lastOffer) {
      ctx.lastOffer = null; awaitingTimeForRef.current = null;
      ultronReply('No problem, Pranav. Tell me whenever you are ready.');
      return;
    }
    // Remind me at <time> [with a voice reminder] [for <task>]
    if (lower.includes('remind')) {
      const time = parseTimeOfDay(text);
      const date = lower.includes('tomorrow') ? addDaysStr(today, 1) : today;
      if (!time) { ultronReply('Of course. What time should I remind you? Say it like “remind me at 2pm with a voice reminder”.'); return; }
      const task = resolveTask(data.tasks);
      const title = task ? task.title : text.replace(/remind me( at)?/i, '').replace(/\d{1,2}(:\d{2})?\s*(am|pm|o'clock)?/i, '').replace(/with a (voice )?reminder/i, '').replace(/for /i, '').trim() || 'your task';
      const id = Math.max(0, ...data.ultronReminders.map((r) => r.id)) + 1;
      const msg = `this is your reminder for “${title}” at ${time}. Have you done it yet? Want me to mark it done or move it?`;
      save((d) => ({ ...d, ultronReminders: [...d.ultronReminders, { id, title, taskId: task ? task.id : null, date, time, message: msg, fired: false, createdAt: new Date().toISOString() }] }));
      rememberTask(task); ctx.lastOffer = null;
      ultronReply(`Done, Pranav. I have set a friendly voice reminder for “${title}” at ${time} on ${date}. I will notify you and speak it aloud then — as long as the app has been opened recently, and Background reminders and Voice reminders are on in Settings.`);
      return;
    }
    if (lower.includes('mark') && lower.includes('done')) {
      const task = resolveTask(open);
      if (!task) { ultronReply('Which task should I mark done? Tell me its name, for example “mark Wake up done”.'); return; }
      toggleTask(task); rememberTask(task); ctx.lastOffer = null;
      ultronReply(`Done — “${task.title}” is marked done. Nice work, Pranav.`);
      return;
    }
    // "move / reschedule / push" moves a task. A bare "tomorrow"
    // ("what's tomorrow?") is a summary question, not a move — it
    // falls through to the Tomorrow branch below. The tomorrow check
    // uses the NAMED match only, so a discussed task is never moved
    // by accident when Pranav just asks about tomorrow.
    if (lower.includes('move') || lower.includes('reschedule') || lower.includes('push') || (lower.includes('tomorrow') && findTaskByWords(data.tasks, text))) {
      const task = resolveTask(data.tasks);
      const date = lower.includes('tomorrow') ? addDaysStr(today, 1) : lower.includes('next week') ? addDaysStr(today, 7) : today;
      if (!task) { ultronReply('Which task should I move? Tell me its name and the new day, for example “move Set up news to tomorrow”.'); return; }
      save((d) => ({ ...d, tasks: d.tasks.map((x) => x.id === task.id ? { ...x, dueDate: date } : x) }));
      rememberTask(task); ctx.lastOffer = null;
      ultronReply(`Moved “${task.title}” to ${date}. I will remind you before then.`);
      return;
    }
    if (lower.includes('create') || lower.includes('add') || lower.includes('new task')) {
      const draft0 = parseVoiceTask(text.replace(/^(create|add|new task)\s*/i, ''), data.projects);
      const newId = Math.max(0, ...data.tasks.map((x) => x.id)) + 1;
      save((d) => ({ ...d, tasks: [...d.tasks, { id: newId, title: draft0.title, notes: draft0.notes, projectId: draft0.projectId, dueDate: draft0.dueDate, dueTime: draft0.dueTime, kind: draft0.kind, priority: draft0.priority, remindersPerDay: draft0.priority === 'high_alert' ? 3 : 0, status: 'todo', completedAt: null, dailyDoneOn: null }] }));
      rememberTask({ ...draft0, id: newId } as Task); ctx.lastOffer = null;
      ultronReply(`Created “${draft0.title}”${draft0.dueDate ? ` for ${draft0.dueDate}` : ''}${draft0.dueTime ? ` at ${draft0.dueTime}` : ''}. You can edit it from Home.`);
      return;
    }
    // --- Summaries grounded in real data (never invented) ---
    const fmt = (t: Task) => `“${t.title}”${t.dueTime ? ` at ${t.dueTime}` : ''}${t.dueDate && t.dueDate !== today ? ` on ${t.dueDate}` : ''}${t.priority === 'high_alert' ? ' (high alert)' : ''}`;
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
    const doneCount = data.tasks.filter((t) => t.status === 'done').length;
    // This week: today through 7 days ahead, plus daily tasks.
    if (lower.includes('week') || lower.includes('this week') || lower.includes('next 7') || lower.includes('coming days')) {
      const weekEnd = addDaysStr(today, 7);
      const weekTasks = open.filter((t) => (t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd) || t.kind === 'daily');
      const byDay: Record<string, Task[]> = {};
      for (const t of weekTasks) { const d = t.dueDate || today; (byDay[d] = byDay[d] || []).push(t); }
      const days = Object.keys(byDay).sort();
      if (!weekTasks.length) { ultronReply(`Your week looks clear, Pranav — no open tasks dated ${today} to ${weekEnd}, and nothing overdue. Want me to add something for this week?`); return; }
      const lines = days.map((d) => `${d === today ? 'Today' : d}: ${byDay[d].map(fmt).join(', ')}`).join(' — ');
      ultronReply(`Here is your week, ${today} to ${weekEnd}: ${weekTasks.length} open task${weekTasks.length > 1 ? 's' : ''}. ${lines}. ${overdue.length ? `${overdue.length} of those are already overdue — tackle those first. ` : ''}Want me to read the busiest day aloud, or set a reminder for one of them?`);
      return;
    }
    // Tomorrow
    if (lower.includes('tomorrow')) {
      const tm = addDaysStr(today, 1);
      const tmTasks = open.filter((t) => t.dueDate === tm || t.kind === 'daily');
      if (!tmTasks.length) { ultronReply(`Nothing scheduled for tomorrow (${tm}) yet, Pranav. Want me to move something there, or create a task for tomorrow?`); return; }
      ultronReply(`Tomorrow (${tm}) you have ${tmTasks.length} task${tmTasks.length > 1 ? 's' : ''}: ${tmTasks.map(fmt).join(', ')}. Want a reminder for any of them?`);
      return;
    }
    // Progress / how am I doing
    if (lower.includes('how am i') || lower.includes('how i am') || lower.includes('progress') || lower.includes('how many') || lower.includes('how much')) {
      const pct = data.tasks.length ? Math.round((doneCount / data.tasks.length) * 100) : 0;
      ultronReply(`You have done ${doneCount} of ${data.tasks.length} tasks in this app (${pct}%). ${open.length} still open, ${overdue.length} overdue, ${todayOpen.length} due today. Your busiest project is ${data.projects.map((p) => ({ p, n: open.filter((t) => t.projectId === p.id).length })).sort((a, b) => b.n - a.n)[0]?.p.name || 'none'} — want me to focus you on one task at a time?`);
      return;
    }
    // What's next / most important
    if (lower.includes('next') || lower.includes('first') || lower.includes('most important') || lower.includes('priority')) {
      const sorted = [...open].sort((a, b) => (a.priority === 'high_alert' ? 0 : a.priority === 'high' ? 1 : 2) - (b.priority === 'high_alert' ? 0 : b.priority === 'high' ? 1 : 2) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      if (!sorted.length) { ultronReply('Nothing left open — you are done, Pranav.'); return; }
      // Remember this task + the offer, so a follow-up "yes" works.
      rememberTask(sorted[0]); ctx.lastOffer = 'reminder';
      ultronReply(`Your most important next task is ${fmt(sorted[0])}. After that: ${sorted.slice(1, 3).map(fmt).join(', ') || 'nothing else scheduled'}. Want me to set a voice reminder for it?`);
      return;
    }
    // A specific project
    const namedProject = data.projects.find((p) => lower.includes(p.name.toLowerCase()));
    if (namedProject && (lower.includes('project') || lower.includes('about') || lower.includes('how') || lower.includes('what'))) {
      const pt = data.tasks.filter((t) => t.projectId === namedProject.id);
      const po = pt.filter((t) => t.status === 'todo');
      ultronReply(`${namedProject.name}: ${pt.length} task${pt.length === 1 ? '' : 's'} in total, ${po.length} still open${po.length ? ` — ${po.map(fmt).join(', ')}` : ''}. ${namedProject.description || ''}`);
      return;
    }
    if (lower.includes('today') || (lower.includes('what') && lower.includes('do'))) {
      if (!todayOpen.length) { ultronReply('Nothing open for today, Pranav. You are all caught up.'); return; }
      ultronReply(`Today you have ${todayOpen.length} open task${todayOpen.length > 1 ? 's' : ''}: ${todayOpen.map((t) => `“${t.title}”${t.dueTime ? ` at ${t.dueTime}` : ''}`).join(', ')}. Shall I read them aloud, or mark one done?`);
      return;
    }
    if (lower.includes('pending') || lower.includes('overdue') || lower.includes('summary') || lower.includes('left')) {
      const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
      ultronReply(`Here is where things stand, Pranav: ${open.length} task${open.length === 1 ? ' is' : 's are'} still open, ${overdue.length} overdue${overdue.length ? ` — ${overdue.map((t) => `“${t.title}”`).join(', ')}` : ''}, and ${todayOpen.length} due today. Tell me one to tackle first and I will help you finish it.`);
      return;
    }
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
      ultronReply(`Hey Pranav. You have ${todayOpen.length} task${todayOpen.length === 1 ? '' : 's'} open today. Want the list, or shall I remind you about one at a time?`);
      return;
    }
    // Named-task fallback only — no context fallback here, or any
    // unrecognised sentence would "find" the last-discussed task.
    const found = findTaskByWords(data.tasks, text);
    if (found) { rememberTask(found); ultronReply(`I found “${found.title}” — ${found.status === 'done' ? 'already done' : 'still open'}${found.dueDate ? `, due ${found.dueDate}` : ''}${found.dueTime ? ` at ${found.dueTime}` : ''}, priority ${found.priority}. Want me to mark it done, move it, or remind you about it?`); return; }
    // General Q&A fallback — answer from real data, never invent.
    const nextDue = [...open].filter((t) => t.dueDate && t.dueDate >= today).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0];
    ultronReply(`Here is what I know right now, Pranav: ${open.length} task${open.length === 1 ? ' is' : 's are'} open, ${overdue.length} overdue, ${todayOpen.length} due today, and ${doneCount} already done. ${nextDue ? `Your next dated task is ${fmt(nextDue)}.` : 'No dated tasks are coming up.'} Ask me things like “what's my week look like?”, “what's overdue?”, “how am I doing?”, “what's next?”, “remind me at 2pm with a voice reminder”, or name a task or a project and I will tell you about it.`);
  }
  // Auto-growing Ultron input: grows to ~5 lines as he types, then
  // scrolls inside the box instead of growing forever.
  function growUltronInput(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24;
    el.style.height = Math.min(el.scrollHeight, lineHeight * 5) + 'px';
  }
  function stopUltronListening() {
    ultronSessionRef.current = false;
    if (ultronRestartRef.current) { window.clearTimeout(ultronRestartRef.current); ultronRestartRef.current = null; }
    if (autoSendRef.current) { window.clearTimeout(autoSendRef.current); autoSendRef.current = null; }
    (recogRef.current as { stop?: () => void } | null)?.stop?.();
    setUltronListening(false);
    setUltronHeard(null);
  }
  async function ultronMic() {
    // Tap again while listening = Stop. The mic stays on until Stop is tapped.
    if (ultronListening) { stopUltronListening(); return; }
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) { setToast('Voice is not supported in this browser. You can type to Ultron instead.'); return; }
    // Warm up the mic FIRST: SpeechRecognition on its own does not
    // reliably fire the WebView permission request in Android — it
    // just fails with not-allowed and closes after ~1 second. A short
    // getUserMedia call does fire it, so Android shows the system
    // "Allow Task Reminder to record audio?" prompt (via MainActivity)
    // and only then do we start listening.
    if (!(await requestMicrophonePermission())) {
      setMicState('denied');
      setMicHint('Microphone permission is blocked. Allow the mic in Android Settings > Apps > Task Reminder > Permissions > Microphone, then tap the mic again. No need to reinstall.');
      return;
    }
    setMicState('granted');
    const rec = new SR() as { continuous: boolean; interimResults: boolean; lang: string; maxAlternatives: number; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
    // Accuracy + speed: listen in the language Pranav chose in
    // Settings (en-IN / hi-IN / mr-IN), keep listening until Stop,
    // and show interim words live as they are heard.
    rec.continuous = true; rec.interimResults = true; rec.lang = data.settings.voiceLang; rec.maxAlternatives = 1;
    ultronSessionRef.current = true;
    finalTranscriptRef.current = '';
    setMicHint(null);
    setUltronHeard('Listening… speak now.');
    rec.onresult = (e) => {
      let interim = '';
      let finalPart = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalPart += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalPart.trim()) {
        finalTranscriptRef.current = (finalTranscriptRef.current ? finalTranscriptRef.current + ' ' : '') + finalPart.trim();
      }
      // Live transcript: what Ultron heard so far, final + interim.
      const heard = (finalTranscriptRef.current + (interim ? (finalTranscriptRef.current ? ' ' : '') + interim : '')).trim();
      if (heard) { setUltronInput(heard); setUltronHeard(`Heard: “${heard}”`); }
      setMicHint(null);
      // Act only on the FINAL transcript — and act on it automatically.
      // Before this fix speaking filled the box but nothing happened
      // until Send was tapped, so Ultron seemed to ignore Pranav.
      if (finalPart.trim()) {
        if (autoSendRef.current) window.clearTimeout(autoSendRef.current);
        autoSendRef.current = window.setTimeout(() => {
          const t = finalTranscriptRef.current.trim();
          if (!t) return;
          finalTranscriptRef.current = '';
          stopUltronListening();
          setPendingVoiceSend(t);
        }, 900);
      }
    };
    rec.onerror = (ev) => {
      const err = (ev as { error?: string }).error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        ultronSessionRef.current = false;
        setUltronListening(false);
        setMicState('denied');
        setMicHint('Microphone permission is blocked. Allow the mic in Android Settings > Apps > Task Reminder > Permissions > Microphone, then tap the mic again. No need to reinstall.');
      } else if (err === 'no-speech') {
        setMicHint('No speech heard yet — I am still listening, keep talking.');
      }
      // Other errors (e.g. network/aborted): do not close — onend below restarts.
    };
    rec.onend = () => {
      // Web Speech ends the session after a pause or ~60s. While the
      // session is active, restart it so listening continues until Stop.
      if (!ultronSessionRef.current) { setUltronListening(false); return; }
      ultronRestartRef.current = window.setTimeout(() => {
        try { rec.start(); } catch { setUltronListening(false); }
      }, 300);
    };
    void stopAloud(); setUltronSpeaking(false);
    recogRef.current = rec;
    try { rec.start(); } catch { setToast('Could not start the microphone. Try again.'); return; }
    setUltronListening(true);
  }
  const projectName = (id: number | null) => data.projects.find((p) => p.id === id)?.name || 'No project';

  // Calendar data
  const [cy, cm] = calMonth.split('-').map(Number);
  const firstDay = new Date(cy, cm - 1, 1).getDay();
  const daysInMonth = new Date(cy, cm, 0).getDate();
  const calCells: (string | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${cy}-${String(cm).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)];
  const calStatus = (date: string) => {
    if (date > today) return '';
    const due = data.tasks.filter((t) => t.dueDate === date);
    if (!due.length) return '';
    const done = due.filter((t) => t.status === 'done').length;
    if (done === due.length) return 'green';
    if (done === 0) return 'red';
    return 'yellow';
  };
  const schedList = schedTab === 'daily'
    ? filtered.filter((t) => t.kind === 'daily')
    : schedTab === 'weekly'
      ? filtered.filter((t) => { const d = new Date(); const w = addDaysStr(today, 7); return t.dueDate && t.dueDate >= today && t.dueDate <= w; })
      : filtered.filter((t) => t.dueDate && t.dueDate.slice(0, 7) === calMonth);
  const weeks: string[][] = [];
  for (let i = 0; i < 12; i++) weeks.push(data.completedLog.filter((d0) => { const dt = new Date(d0 + 'T12:00:00'); const now = new Date(); const start = new Date(now); start.setDate(now.getDate() - (11 - i) * 7); return dt >= start && dt < new Date(start.getTime() + 7 * 864e5); }).map(() => 'x'));
  const priorityLabel = (p: Priority) => p === 'high_alert' ? 'High alert' : p === 'high' ? 'Urgent' : p === 'normal' ? 'Normal' : 'Very normal';
  const taskRow = (t: Task) => (
    <div key={t.id} className="glass card">
      <div className="row">
        <input type="checkbox" checked={t.kind === 'daily' ? t.dailyDoneOn === today : t.status === 'done'} onChange={() => toggleTask(t)} aria-label="Mark done" />
        <div style={{ flex: 1 }}>
          <strong style={{ textDecoration: (t.kind === 'daily' ? t.dailyDoneOn === today : t.status === 'done') ? 'line-through' : 'none' }}>{t.title}</strong>
          <div className="muted">{projectName(t.projectId)}{t.dueDate ? ` · ${t.dueDate}` : ''}{t.dueTime ? ` ${t.dueTime}` : ''}</div>
          {t.notes && <div className="muted">{t.notes}</div>}
        </div>
        <span className="priowrap"><span className={`dot ${t.priority}`} aria-label={priorityLabel(t.priority)} /><span className={`pill ${t.priority}`}>{priorityLabel(t.priority)}</span></span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn ghost small" onClick={() => listen(taskSpeechText(t), `task-${t.id}`)}>{speaking === `task-${t.id}` ? <><Square size={14} /> Stop</> : <><Volume2 size={14} /> Listen</>}</button>
        <button className="btn ghost small" onClick={() => openEditTask(t)}><Pencil size={14} /> Edit</button>
        <button className="btn ghost small" onClick={() => save((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }))}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="searchwrap"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" aria-label="Search tasks" /></div>
        <button className="btn ghost small iconbtn" onClick={() => setView('reminders')} aria-label="Reminders"><Bell size={18} /> {reminders.length}</button>
      </div>
      <h1 style={{ margin: '4px 0' }}>Task Reminder App</h1>
      <p className="muted">Hey {data.profile.name || 'Pranav'} — {todayTasks.length} open for today · {doneToday} done overall</p>

      {view === 'today' && (
        <div>
          <div className="home-actions">
            <button className="btn" onClick={openNewTask}><Plus size={18} /> Add task</button>
            <button className="btn ghost" onClick={() => void listenToday()} aria-label="Read today's tasks aloud" title="Read today's tasks aloud">{speaking === 'today' ? <Square size={18} /> : <Volume2 size={18} />} Listen</button>
          </div>
          <h3>Today</h3>
          {todayTasks.length ? todayTasks.map(taskRow) : <p className="muted">Nothing open for today. Add a task, or speak one.</p>}
          <h3>Main projects</h3>
          {data.projects.map((p) => (
            <div key={p.id} className="glass card"><div className="row"><span style={{ width: 12, height: 12, borderRadius: '50%', background: p.color }} /> <strong>{p.name}</strong> <span className="priowrap"><span className={`dot ${p.priority}`} /><span className={`pill ${p.priority}`}>{priorityLabel(p.priority)}</span></span></div><div className="muted">{p.description}</div><div className="muted">{data.tasks.filter((t) => t.projectId === p.id && t.status === 'todo').length} open tasks</div></div>
          ))}
          <button className="btn ghost" onClick={() => setShowProjectForm(true)}><Plus size={18} /> Add project</button>
        </div>
      )}

      {view === 'schedule' && (
        <div>
          <h3>Scheduled tasks</h3>
          <div className="segmented">{(['monthly', 'weekly', 'daily'] as const).map((t) => <button key={t} className={schedTab === t ? 'active' : ''} onClick={() => setSchedTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
          {schedList.length ? schedList.map(taskRow) : <p className="muted">No {schedTab} tasks.</p>}
        </div>
      )}

      {view === 'calendar' && (
        <div>
          <h3>Calendar</h3>
          <div className="row"><button className="btn ghost small iconbtn" onClick={() => setCalMonth(addDaysStr(calMonth + '-01', -30).slice(0, 7))}><ChevronLeft size={16} /> Prev</button><strong>{calMonth}</strong><button className="btn ghost small iconbtn" onClick={() => setCalMonth(addDaysStr(calMonth + '-01', 30).slice(0, 7))}>Next <ChevronRight size={16} /></button></div>
          <p className="muted">Past dates: green = all done · red = remaining · yellow = half done</p>
          <div className="cal">{calCells.map((d, i) => d ? <div key={d} className={`calcell ${calStatus(d)}`}>{Number(d.slice(8))}<br /><span>{data.tasks.filter((t) => t.dueDate === d).length || ''}</span></div> : <div key={i} />)}</div>
        </div>
      )}

      {view === 'reminders' && (
        <div>
          <h3>Reminders</h3>
          {reminders.length ? reminders.map((r) => (
            <div key={r.key} className="glass card"><strong>{r.kind}</strong><div>{r.text}</div>
              <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn ghost small" onClick={() => listen(taskSpeechText(r.task), `rem-${r.key}`)}><Volume2 size={14} /> Listen</button>
                <button className="btn ghost small" onClick={() => snoozeTask(r.task, 'hour')}>Snooze 1h</button>
                <button className="btn ghost small" onClick={() => snoozeTask(r.task, 'evening')}>This evening</button>
                <button className="btn ghost small" onClick={() => snoozeTask(r.task, 'morning')}>Tomorrow morning</button>
                <button className="btn ghost small" onClick={() => save((d) => ({ ...d, dismissed: { ...d.dismissed, [r.key]: true } }))}>Dismiss</button>
              </div>
            </div>
          )) : <p className="muted">No reminders right now. You are all caught up.</p>}
        </div>
      )}

      {view === 'profile' && (
        <div>
          <h3>Profile</h3>
          <div className="glass card">
            <input className="field" value={data.profile.name} onChange={(e) => save((d) => ({ ...d, profile: { ...d.profile, name: e.target.value } }))} placeholder="Name" />
            <input className="field" value={data.profile.role} onChange={(e) => save((d) => ({ ...d, profile: { ...d.profile, role: e.target.value } }))} placeholder="Role / headline" />
            <textarea className="field" value={data.profile.bio} onChange={(e) => save((d) => ({ ...d, profile: { ...d.profile, bio: e.target.value } }))} placeholder="Short bio" />
            <div className="row" style={{ flexWrap: 'wrap' }}>{(Object.keys(THEMES) as MuseTheme[]).map((k) => <button key={k} className="btn ghost small" style={{ background: data.profile.museTheme === k ? THEMES[k].accent : undefined }} onClick={() => save((d) => ({ ...d, profile: { ...d.profile, museTheme: k } }))}>{THEMES[k].name}</button>)}</div>
          </div>
          <div className="glass card"><strong>Progress</strong><div style={{ marginTop: 8 }}>{weeks.map((w, i) => <span key={i}>{w.length ? <span className="sq" style={{ background: '#22c55e' }} /> : <span className="sq" />}</span>)}</div><div className="muted">Green squares = days you completed something, like GitHub contributions.</div></div>
          <div className="glass card"><strong>Voice keywords</strong><div className="muted">Say these so voice capture files the task right:</div>{VOICE_KEYWORDS.map((k) => <span key={k} className="pill" style={{ margin: 3 }}>{k}</span>)}</div>
          <h3>Settings — Account / Profile</h3>
          <div className="glass card">
            <label className="row"><input type="checkbox" checked={data.settings.backgroundReminders} onChange={(e) => save((d) => ({ ...d, settings: { ...d.settings, backgroundReminders: e.target.checked } }))} /> Background reminders</label>
            <label className="row"><input type="checkbox" checked={data.settings.ultronEnabled} onChange={(e) => save((d) => ({ ...d, settings: { ...d.settings, ultronEnabled: e.target.checked } }))} /> Ultron assistant</label>
            <label className="row"><input type="checkbox" checked={data.settings.notificationsEnabled} onChange={(e) => save((d) => ({ ...d, settings: { ...d.settings, notificationsEnabled: e.target.checked } }))} /> Notifications on</label>
            <label className="row"><input type="checkbox" checked={data.settings.voiceReminders} onChange={(e) => save((d) => ({ ...d, settings: { ...d.settings, voiceReminders: e.target.checked } }))} /> Speak reminders out loud (free phone voice)</label>
            <label className="row"><input type="checkbox" checked={data.settings.friendlyReminders} onChange={(e) => save((d) => ({ ...d, settings: { ...d.settings, friendlyReminders: e.target.checked } }))} /> Friendly reminder wording</label>
            <div style={{ marginTop: 8 }}>Remind me <select value={data.settings.reminderMinutesBefore} onChange={(e) => save((d) => ({ ...d, settings: { ...d.settings, reminderMinutesBefore: Number(e.target.value) } }))}><option value={30}>30 minutes before</option><option value={60}>1 hour before</option><option value={120}>2 hours before</option></select> a task is due.</div>
            <div style={{ marginTop: 8 }}>Voice language: <select value={data.settings.voiceLang} onChange={(e) => save((d) => ({ ...d, settings: { ...d.settings, voiceLang: e.target.value as Settings['voiceLang'] } }))}>{LANGS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}</select></div>
            <div style={{ marginTop: 8 }}>
              <div className="row"><strong>Notifications</strong><span className={`pill ${notifState === 'granted' ? 'normal' : notifState === 'denied' ? 'high_alert' : 'very_normal'}`}>{notifState === 'granted' ? 'Allowed' : notifState === 'denied' ? 'Blocked' : notifState === 'default' ? 'Not asked yet' : 'Unknown'}</span></div>
              <p className="muted">Permission: {notifState}.{notifState === 'denied' ? ' Blocked — turn it on in Android Settings > Apps > Task Reminder > Notifications, then tap Re-check.' : notifState === 'granted' ? ' Reminders will show as Android notifications.' : ' Tap Allow notifications and accept the Android permission prompt.'}</p>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn small" onClick={askNotifications}>{notifState === 'granted' ? 'Send test notification' : 'Allow notifications'}</button>
                {notifState !== 'granted' && <button className="btn ghost small" onClick={checkNotifStatus}>Re-check permission</button>}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="row"><strong>Microphone</strong><span className={`pill ${micState === 'granted' ? 'normal' : micState === 'denied' ? 'high_alert' : 'very_normal'}`}>{micState === 'granted' ? 'Allowed' : micState === 'denied' ? 'Blocked' : micState === 'prompt' ? 'Not asked yet' : 'Unknown'}</span></div>
              <p className="muted">Permission: {micState}.{micState === 'denied' ? ' Blocked — go to Android Settings > Apps > Task Reminder > Permissions > Microphone > Allow (no need to reinstall), then tap Re-check.' : micState === 'granted' ? ' Ultron will hear you — tap the mic and speak, it stays listening until you tap Stop.' : ' Tap Allow microphone and accept the Android permission prompt. Without this, the mic closes after about 1 second.'}</p>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn small" onClick={askMicrophone}>{micState === 'granted' ? 'Test microphone' : 'Allow microphone'}</button>
                {micState !== 'granted' && <button className="btn ghost small" onClick={checkMicStatus}>Re-check permission</button>}
              </div>
            </div>
            <p className="muted">Data: {!loaded ? 'loading your data from Supabase…' : dataSource === 'supabase'
              ? 'saved in Supabase (cloud). Nothing is stored on this phone.'
              : dataSource === 'supabase-error'
                ? 'Supabase is configured but could not be reached — nothing is being saved right now, so your cloud data is safe. Check your connection and tap Retry below.'
                : 'Supabase is NOT connected — this build has no Supabase URL/key, so your data lives only in this session and is lost when the app closes. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY as GitHub repo secrets and rebuild the APK.'}</p>
            {dataSource !== 'supabase' && (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn small" onClick={async () => { setLoaded(false); const ok = await loadCloud(); setLoaded(true); setToast(ok ? 'Connected to Supabase — your cloud data is loaded.' : 'Still cannot reach Supabase. Check the secrets and your connection, then try again.'); }}>Retry Supabase</button>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <div className="row"><strong>Voice (Listen / Ultron speech)</strong></div>
              <p className="muted">Speaks with your phone's own text-to-speech engine, in the voice language chosen above. If you hear nothing, tap Test voice — it will say so, and open the Android installer for missing voice data.</p>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn small" onClick={() => void testVoice()}>Test voice</button>
              </div>
            </div>
            <p className="muted">This is the native Android app: reminders are scheduled on your phone with Capacitor LocalNotifications, so the notification fires even when the app is closed. The voice speaks when the app opens (or when you tap the notification) — Android does not let a WebView app speak out loud from a fully closed state. While the app is open, it checks every minute and will notify, show and speak the reminder. If Background reminders are OFF, nothing is scheduled or notified. If Voice reminders are OFF, you get text notifications only, no speech.</p>
          </div>
        </div>
      )}

      {showTaskForm && (
        <div className="glass card"><h3>{editing ? 'Edit task' : 'New task'}</h3>
          <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" />
          <textarea className="field" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Sub-description / notes" />
          <div className="row"><input className="field" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /><input className="field" type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} /></div>
          <div className="row"><select className="field" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">No project</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className="field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}><option value="very_normal">Very normal</option><option value="normal">Normal</option><option value="high">Urgent</option><option value="high_alert">High alert</option></select>
          <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'task' | 'daily' })}><option value="task">Task</option><option value="daily">Daily</option></select></div>
          <div className="row"><button className="btn" onClick={saveTaskForm}>Save task</button><button className="btn ghost" onClick={() => setShowTaskForm(false)}>Cancel</button></div>
        </div>
      )}
      {showProjectForm && (
        <div className="glass card"><h3>New project</h3>
          <input className="field" value={projForm.name} onChange={(e) => setProjForm({ ...projForm, name: e.target.value })} placeholder="Project name" />
          <textarea className="field" value={projForm.description} onChange={(e) => setProjForm({ ...projForm, description: e.target.value })} placeholder="Description" />
          <div className="row"><button className="btn" onClick={() => { if (!projForm.name.trim()) return; save((d) => ({ ...d, projects: [...d.projects, { id: Math.max(0, ...d.projects.map((p) => p.id)) + 1, name: projForm.name.trim(), description: projForm.description, dueDate: projForm.dueDate || null, priority: projForm.priority, color: projForm.color }] })); setShowProjectForm(false); }}>Save project</button><button className="btn ghost" onClick={() => setShowProjectForm(false)}>Cancel</button></div>
        </div>
      )}
      {toast && <div className="glass toast">{toast}<div style={{ textAlign: 'right' }}><button className="btn ghost small" onClick={() => setToast(null)}>OK</button></div></div>}
      <nav className="nav">
        <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}><HomeIcon size={22} />Home</button>
        <button className={view === 'schedule' ? 'active' : ''} onClick={() => setView('schedule')}><CalendarDays size={22} />Schedule</button>
        <button onClick={() => setUltronOpen(true)} aria-label="Ultron assistant" title="Ultron — your AI assistant" style={{ color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center' }}><Avatar size="md" color="blue" state="idle" />Ultron</button>
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><Calendar size={22} />Calendar</button>
        <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}><User size={22} />Profile</button>
      </nav>
      {ultronOpen && (
        <div className="ultron-full">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Ultron</strong>
            <button className="btn ghost small iconbtn" onClick={() => { stopUltronListening(); void stopAloud(); setUltronSpeaking(false); setUltronOpen(false); }} aria-label="Close Ultron"><X size={16} /> Close</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16 }}>
            <Avatar size="xl" color="blue" state={ultronAvatarState} onClick={ultronMic} />
            <div className="muted" style={{ marginTop: 10, textAlign: 'center' }}>
              {ultronListening ? 'Listening… tap Ultron again or Stop to finish.' : ultronSpeaking ? 'Speaking…' : 'Tap Ultron to talk, or type below.'}
            </div>
            {micHint && <div className="muted" style={{ marginTop: 6, textAlign: 'center' }}>{micHint}</div>}
          </div>
          <div className="ultron-chat" ref={chatRef}>
            {ultronMsgs.map((m, i) => <div key={i} style={{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }}><span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 14, background: m.role === 'user' ? 'var(--accent)' : 'rgba(255,255,255,.14)', color: '#fff', maxWidth: '88%' }}>{m.text}</span></div>)}
          </div>
          <div className="ultron-inputbar">
            <button className={`mic ${ultronListening ? 'listening' : ''}`} style={{ width: 52, height: 52, flexShrink: 0, alignSelf: 'flex-end' }} onClick={() => void ultronMic()} aria-label={ultronListening ? 'Stop listening' : 'Speak to Ultron'}>{ultronListening ? <Square size={20} /> : <Mic size={22} />}</button>
            <textarea
              ref={ultronInputRef}
              className="field ultron-input"
              rows={1}
              value={ultronInput}
              onChange={(e) => { setUltronInput(e.target.value); growUltronInput(e.target); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleUltronSend(ultronInput); } }}
              placeholder="Talk to Ultron…"
            />
            <button className="btn ultron-send" style={{ alignSelf: 'flex-end' }} onClick={() => handleUltronSend(ultronInput)}><Send size={16} /> Send</button>
          </div>
          {ultronHeard && <div className="muted" style={{ marginTop: 8, textAlign: 'center' }}>{ultronHeard}</div>}
          {ultronListening && <div style={{ textAlign: 'center', marginTop: 8 }}><button className="btn ghost small" onClick={stopUltronListening}>Stop listening</button></div>}
        </div>
      )}
    </div>
  );
}
