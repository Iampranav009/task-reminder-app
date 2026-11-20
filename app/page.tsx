'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppData, MuseTheme, Priority, Project, Settings, Task, THEMES, UltronReminder, VOICE_KEYWORDS, findTaskByWords, loadData, parseTimeOfDay, parseVoiceTask, pickVoice, seedData, speakText, stopSpeaking, STORE_KEY, taskSpeechText, todayStr, addDaysStr } from '../src/lib/core';

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
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [draft, setDraft] = useState<ReturnType<typeof parseVoiceTask> | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ultronOpen, setUltronOpen] = useState(false);
  const [ultronMsgs, setUltronMsgs] = useState<{ role: 'user' | 'ultron'; text: string }[]>([{ role: 'ultron', text: 'Good to see you, Pranav. I am Ultron — the main brain of this app. I know your tasks, projects and deadlines. Ask me to list today, create a task, mark one done, move one, or say “remind me at 2pm with a voice reminder” and I will schedule it.' }]);
  const [ultronInput, setUltronInput] = useState('');
  const [ultronListening, setUltronListening] = useState(false);
  const [notifState, setNotifState] = useState('unknown');
  const [installEvt, setInstallEvt] = useState<unknown>(null);
  const recogRef = useRef<unknown>(null);

  useEffect(() => { setData(loadData()); setLoaded(true); }, []);
  useEffect(() => { if (loaded) localStorage.setItem(STORE_KEY, JSON.stringify(data)); }, [data, loaded]);
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', THEMES[data.profile.museTheme].accent);
    document.documentElement.style.setProperty('--accent2', THEMES[data.profile.museTheme].accent2);
  }, [data.profile.museTheme]);
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if ('Notification' in window) setNotifState(Notification.permission);
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  // Reminder checker: every minute while the app is open.
  useEffect(() => {
    if (!loaded) return;
    const check = () => {
      const now = new Date(); const today = todayStr(now);
      // Ultron-scheduled voice reminders (stored locally, no server).
      if (data.settings.backgroundReminders) {
        for (const r of data.ultronReminders.filter((x) => !x.fired)) {
          const at = new Date(`${r.date}T${r.time}:00`).getTime();
          if (now.getTime() >= at && now.getTime() < at + 5 * 60 * 1000) {
            const msg = `Hey ${data.profile.name || 'Pranav'}, ${r.message}`;
            setToast(msg);
            if (data.settings.voiceReminders) speakText(msg, data.settings.voiceLang);
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
        if (data.settings.voiceReminders) speakText(msg, data.settings.voiceLang);
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
  async function askNotifications() {
    if (!('Notification' in window)) { setToast('Notifications are not supported in this browser.'); return; }
    const p = await Notification.requestPermission(); setNotifState(p);
    if (p === 'granted') setToast('Notifications on — I will remind you 2 hours before a task is due, and again if you miss it.');
    else setToast('Notification permission was not granted. You can turn it on in Settings, or in your browser site settings.');
  }
  function startListening() {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) { setToast('Voice capture is not supported in this browser. You can type the task instead.'); return; }
    const rec = new SR() as { continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-IN';
    rec.onresult = (e) => { let txt = ''; for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript; setTranscript(txt); };
    rec.onerror = () => setListening(false); rec.onend = () => setListening(false);
    recogRef.current = rec; rec.start(); setListening(true);
  }
  function stopListening() { (recogRef.current as { stop?: () => void } | null)?.stop?.(); setListening(false); }
  function understandTask() {
    stopListening();
    if (!transcript.trim()) return;
    setDraft(parseVoiceTask(transcript, data.projects));
  }
  function saveDraft() {
    if (!draft) return;
    save((d) => {
      const id = Math.max(0, ...d.tasks.map((x) => x.id)) + 1;
      return { ...d, tasks: [...d.tasks, { id, title: draft.title, notes: draft.notes, projectId: draft.projectId, dueDate: draft.dueDate, dueTime: draft.dueTime, kind: draft.kind, priority: draft.priority, remindersPerDay: draft.priority === 'high_alert' ? 3 : 0, status: 'todo', completedAt: null, dailyDoneOn: null }] };
    });
    setDraft(null); setTranscript(''); setVoiceOpen(false); setToast('Task saved from your voice.');
  }
  function listen(text: string, id: string) {
    if (speaking === id) { stopSpeaking(); setSpeaking(null); return; }
    if (speakText(text, data.settings.voiceLang)) setSpeaking(id); else setToast('Speech is not available on this device.');
    setTimeout(() => setSpeaking((s) => (s === id ? null : s)), 30000);
  }
  function listenToday() {
    const items = todayTasks.filter((t) => t.status === 'todo');
    if (!items.length) { setToast('No open tasks for today to read out.'); return; }
    listen(items.map((t) => taskSpeechText(t)).join(' '), 'today');
  }
  function ultronReply(text: string) { setUltronMsgs((m) => [...m, { role: 'ultron', text }]); }
  function handleUltronSend(raw: string) {
    const text = raw.trim(); if (!text) return;
    setUltronMsgs((m) => [...m, { role: 'user', text }]); setUltronInput('');
    if (!data.settings.ultronEnabled) { ultronReply('Ultron is switched off in Settings. Turn Ultron on there and I will help you again.'); return; }
    const lower = text.toLowerCase();
    const open = data.tasks.filter((t) => t.status === 'todo');
    const todayOpen = open.filter((t) => t.kind === 'daily' || t.dueDate === today || (t.dueDate && t.dueDate < today));
    // Remind me at <time> [with a voice reminder] [for <task>]
    if (lower.includes('remind')) {
      const time = parseTimeOfDay(text);
      const date = lower.includes('tomorrow') ? addDaysStr(today, 1) : today;
      if (!time) { ultronReply('Of course. What time should I remind you? Say it like “remind me at 2pm with a voice reminder”.'); return; }
      const task = findTaskByWords(data.tasks, text);
      const title = task ? task.title : text.replace(/remind me( at)?/i, '').replace(/\d{1,2}(:\d{2})?\s*(am|pm|o'clock)?/i, '').replace(/with a (voice )?reminder/i, '').replace(/for /i, '').trim() || 'your task';
      const id = Math.max(0, ...data.ultronReminders.map((r) => r.id)) + 1;
      const msg = `this is your reminder for “${title}” at ${time}. Have you done it yet? Want me to mark it done or move it?`;
      save((d) => ({ ...d, ultronReminders: [...d.ultronReminders, { id, title, taskId: task ? task.id : null, date, time, message: msg, fired: false, createdAt: new Date().toISOString() }] }));
      ultronReply(`Done, Pranav. I have set a friendly voice reminder for “${title}” at ${time} on ${date}. I will notify you and speak it aloud then — as long as the app has been opened recently, and Background reminders and Voice reminders are on in Settings.`);
      return;
    }
    if (lower.includes('mark') && lower.includes('done')) {
      const task = findTaskByWords(open, text);
      if (!task) { ultronReply('Which task should I mark done? Tell me its name, for example “mark Wake up done”.'); return; }
      toggleTask(task); ultronReply(`Done — “${task.title}” is marked done. Nice work, Pranav.`);
      return;
    }
    if (lower.includes('move') || lower.includes('reschedule') || lower.includes('push') || lower.includes('tomorrow')) {
      const task = findTaskByWords(data.tasks, text);
      const date = lower.includes('tomorrow') ? addDaysStr(today, 1) : lower.includes('next week') ? addDaysStr(today, 7) : today;
      if (!task) { ultronReply('Which task should I move? Tell me its name and the new day, for example “move Set up news to tomorrow”.'); return; }
      save((d) => ({ ...d, tasks: d.tasks.map((x) => x.id === task.id ? { ...x, dueDate: date } : x) }));
      ultronReply(`Moved “${task.title}” to ${date}. I will remind you before then.`);
      return;
    }
    if (lower.includes('create') || lower.includes('add') || lower.includes('new task')) {
      const draft0 = parseVoiceTask(text.replace(/^(create|add|new task)\s*/i, ''), data.projects);
      save((d) => { const id = Math.max(0, ...d.tasks.map((x) => x.id)) + 1; return { ...d, tasks: [...d.tasks, { id, title: draft0.title, notes: draft0.notes, projectId: draft0.projectId, dueDate: draft0.dueDate, dueTime: draft0.dueTime, kind: draft0.kind, priority: draft0.priority, remindersPerDay: draft0.priority === 'high_alert' ? 3 : 0, status: 'todo', completedAt: null, dailyDoneOn: null }] }; });
      ultronReply(`Created “${draft0.title}”${draft0.dueDate ? ` for ${draft0.dueDate}` : ''}${draft0.dueTime ? ` at ${draft0.dueTime}` : ''}. You can edit it from Home.`);
      return;
    }
    if (lower.includes('today') || lower.includes('what') && lower.includes('do')) {
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
    const found = findTaskByWords(data.tasks, text);
    if (found) { ultronReply(`I found “${found.title}” — ${found.status === 'done' ? 'already done' : 'still open'}${found.dueDate ? `, due ${found.dueDate}` : ''}${found.dueTime ? ` at ${found.dueTime}` : ''}, priority ${found.priority}. Want me to mark it done, move it, or remind you about it?`); return; }
    ultronReply('I can help with your tasks, Pranav — I only use what is actually in this app, so I will not guess. Try “list today”, “create a task to call the gym at 6pm”, “mark Wake up done”, “move Set up news to tomorrow”, or “remind me at 2pm with a voice reminder”.');
  }
  function ultronMic() {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) { setToast('Voice is not supported in this browser. You can type to Ultron instead.'); return; }
    const rec = new SR() as { continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
    rec.continuous = false; rec.interimResults = true; rec.lang = data.settings.voiceLang;
    rec.onresult = (e) => { let txt = ''; for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript; setUltronInput(txt); };
    rec.onerror = () => setUltronListening(false); rec.onend = () => setUltronListening(false);
    rec.start(); setUltronListening(true);
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
  const taskRow = (t: Task) => (
    <div key={t.id} className="glass card">
      <div className="row">
        <input type="checkbox" checked={t.kind === 'daily' ? t.dailyDoneOn === today : t.status === 'done'} onChange={() => toggleTask(t)} aria-label="Mark done" />
        <div style={{ flex: 1 }}>
          <strong style={{ textDecoration: (t.kind === 'daily' ? t.dailyDoneOn === today : t.status === 'done') ? 'line-through' : 'none' }}>{t.title}</strong>
          <div className="muted">{projectName(t.projectId)}{t.dueDate ? ` · ${t.dueDate}` : ''}{t.dueTime ? ` ${t.dueTime}` : ''}</div>
          {t.notes && <div className="muted">{t.notes}</div>}
        </div>
        <span className={`pill ${t.priority}`}>{t.priority === 'high_alert' ? 'High alert' : t.priority}</span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn ghost small" onClick={() => listen(taskSpeechText(t), `task-${t.id}`)}>{speaking === `task-${t.id}` ? '⏹ Stop' : '🔊 Listen'}</button>
        <button className="btn ghost small" onClick={() => openEditTask(t)}>Edit</button>
        <button className="btn ghost small" onClick={() => save((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== t.id) }))}>Delete</button>
      </div>
    </div>
  );

  return (
    <div className="wrap">
      <div className="topbar">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…" aria-label="Search tasks" />
        <button className="btn ghost small" onClick={() => setView('reminders')}>🔔 {reminders.length}</button>
      </div>
      <h1 style={{ margin: '4px 0' }}>Task Reminder App</h1>
      <p className="muted">Hey {data.profile.name || 'Pranav'} — {todayTasks.length} open for today · {doneToday} done overall</p>

      {view === 'today' && (
        <div>
          <div className="glass card">
            <div className="row"><strong>🎙 Say a task</strong><span className="muted">Tap the mic, speak, then Understand my task</span></div>
            <div style={{ textAlign: 'center', padding: 12 }}>
              <button className={`mic ${listening ? 'listening' : ''}`} onClick={() => { setVoiceOpen(true); startListening(); }} aria-label="Say a task">🎙</button>
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn ghost" style={{ borderRadius: '50%', width: 44, height: 44, padding: 0, fontSize: 20 }} onClick={listenToday} aria-label="Read today's tasks aloud" title="Read today's tasks aloud">{speaking === 'today' ? '⏹' : '🔊'}</button>
              <button className="btn ghost" onClick={openNewTask}>+ Add task</button>
            </div>
            <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
              <span className="muted">Voice: </span>
              {LANGS.map((l) => <button key={l.v} className="btn ghost small" style={{ background: data.settings.voiceLang === l.v ? 'var(--accent)' : undefined }} onClick={() => save((d) => ({ ...d, settings: { ...d.settings, voiceLang: l.v } }))}>{l.l}</button>)}
            </div>
          </div>
          <h3>Today</h3>
          {todayTasks.length ? todayTasks.map(taskRow) : <p className="muted">Nothing open for today. Add a task, or speak one.</p>}
          <h3>Main projects</h3>
          {data.projects.map((p) => (
            <div key={p.id} className="glass card"><div className="row"><span style={{ width: 12, height: 12, borderRadius: '50%', background: p.color }} /> <strong>{p.name}</strong> <span className={`pill ${p.priority}`}>{p.priority}</span></div><div className="muted">{p.description}</div><div className="muted">{data.tasks.filter((t) => t.projectId === p.id && t.status === 'todo').length} open tasks</div></div>
          ))}
          <button className="btn ghost" onClick={() => setShowProjectForm(true)}>+ Add project</button>
        </div>
      )}

      {view === 'schedule' && (
        <div>
          <h3>Scheduled tasks</h3>
          <div className="row">{(['monthly', 'weekly', 'daily'] as const).map((t) => <button key={t} className="btn small" style={{ background: schedTab === t ? 'var(--accent)' : 'rgba(255,255,255,.14)' }} onClick={() => setSchedTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
          {schedList.length ? schedList.map(taskRow) : <p className="muted">No {schedTab} tasks.</p>}
        </div>
      )}

      {view === 'calendar' && (
        <div>
          <h3>Calendar</h3>
          <div className="row"><button className="btn ghost small" onClick={() => setCalMonth(addDaysStr(calMonth + '-01', -30).slice(0, 7))}>‹ Prev</button><strong>{calMonth}</strong><button className="btn ghost small" onClick={() => setCalMonth(addDaysStr(calMonth + '-01', 30).slice(0, 7))}>Next ›</button></div>
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
                <button className="btn ghost small" onClick={() => listen(taskSpeechText(r.task), `rem-${r.key}`)}>🔊 Listen</button>
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
            <p className="muted">Notification permission: {notifState}. <button className="btn small" onClick={askNotifications}>Allow notifications</button></p>
            <p className="muted">Honest note: this is a PWA, not a native app. On Android Chrome, notifications and voice reminders work best when the app has been opened recently / is installed. It cannot guarantee an exact background voice alarm when fully closed — that would need a native alarm app. While the app is open, it checks every minute and will notify, show and speak the reminder. If Background reminders are OFF, nothing is scheduled or notified. If Voice reminders are OFF, you get text notifications only, no speech. Ultron-scheduled reminders are stored locally on this phone only.</p>
            {installEvt ? <button className="btn" onClick={() => (installEvt as { prompt: () => void }).prompt()}>Install app on this phone</button> : null}
          </div>
        </div>
      )}

      {showTaskForm && (
        <div className="glass card"><h3>{editing ? 'Edit task' : 'New task'}</h3>
          <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" />
          <textarea className="field" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Sub-description / notes" />
          <div className="row"><input className="field" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /><input className="field" type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} /></div>
          <div className="row"><select className="field" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">No project</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className="field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}><option value="normal">Normal</option><option value="high">High</option><option value="high_alert">High alert</option></select>
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
      {voiceOpen && (
        <div className="glass card"><h3>Say a task</h3>
          <div className="field" style={{ minHeight: 60, background: '#fff' }}>{transcript || 'Tap the mic and speak…'}</div>
          <div className="row"><button className={`mic ${listening ? 'listening' : ''}`} style={{ width: 56, height: 56, fontSize: 24 }} onClick={() => (listening ? stopListening() : startListening())}>🎙</button>
          <button className="btn" onClick={understandTask}>Understand my task</button><button className="btn ghost" onClick={() => { stopListening(); setVoiceOpen(false); }}>Close</button></div>
          {draft && <div style={{ marginTop: 10 }}>
            <input className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea className="field" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            <div className="row"><input className="field" type="date" value={draft.dueDate || ''} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })} /><input className="field" type="time" value={draft.dueTime || ''} onChange={(e) => setDraft({ ...draft, dueTime: e.target.value || null })} />
            <select className="field" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}><option value="normal">Normal</option><option value="high">High</option><option value="high_alert">High alert</option></select></div>
            <div className="muted">Project: {projectName(draft.projectId)} · Kind: {draft.kind}</div>
            <button className="btn" onClick={saveDraft}>Save task</button>
          </div>}
        </div>
      )}
      {toast && <div className="glass toast">{toast}<div style={{ textAlign: 'right' }}><button className="btn ghost small" onClick={() => setToast(null)}>OK</button></div></div>}
      <nav className="nav">
        <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}>🏠<br />Home</button>
        <button className={view === 'schedule' ? 'active' : ''} onClick={() => setView('schedule')}>📅<br />Schedule</button>
        <button onClick={() => setUltronOpen(true)} aria-label="Ultron assistant" title="Ultron — your AI assistant" style={{ color: '#fff' }}><span style={{ display: 'inline-block', width: 48, height: 48, lineHeight: '48px', borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, var(--accent2), var(--accent))', fontSize: 22, boxShadow: '0 0 0 5px rgba(255,255,255,.15)' }}>🤖</span><br />Ultron</button>
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>🗓<br />Calendar</button>
        <button className={view === 'reminders' ? 'active' : ''} onClick={() => setView('reminders')}>🔔<br />Reminders</button>
        <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}>👤<br />Profile</button>
      </nav>
      {ultronOpen && (
        <div className="glass card" style={{ position: 'fixed', left: 12, right: 12, bottom: 86, zIndex: 50, maxHeight: '62vh', display: 'flex', flexDirection: 'column' }}>
          <div className="row"><strong>🤖 Ultron</strong><span className="muted">Your AI assistant — warm, calm, precise. I only use your real tasks.</span><button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => setUltronOpen(false)}>Close</button></div>
          <div style={{ overflowY: 'auto', flex: 1, marginTop: 8 }}>
            {ultronMsgs.map((m, i) => <div key={i} style={{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }}><span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: 14, background: m.role === 'user' ? 'var(--accent)' : 'rgba(255,255,255,.14)', color: '#fff', maxWidth: '88%' }}>{m.text}</span></div>)}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn ghost small" onClick={ultronMic} aria-label="Speak to Ultron">{ultronListening ? '● Listening…' : '🎙'}</button>
            <input className="field" style={{ flex: 1, margin: 0 }} value={ultronInput} onChange={(e) => setUltronInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleUltronSend(ultronInput); }} placeholder="Talk to Ultron — English, Hinglish, Hindi or Marathi…" />
            <button className="btn small" onClick={() => handleUltronSend(ultronInput)}>Send</button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>Try: “list today” · “remind me at 2pm with a voice reminder” · “mark Wake up done” · “move Set up news to tomorrow”</div>
          {data.ultronReminders.filter((r) => !r.fired).length > 0 && <div className="muted" style={{ marginTop: 6 }}>Scheduled voice reminders: {data.ultronReminders.filter((r) => !r.fired).map((r) => `“${r.title}” ${r.date} ${r.time}`).join(' · ')}</div>}
        </div>
      )}
    </div>
  );
}
