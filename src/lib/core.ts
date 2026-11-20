export type Priority = 'high_alert' | 'high' | 'normal';
export type TaskKind = 'task' | 'daily';
export type MuseTheme = 'ocean' | 'sunset' | 'forest' | 'rose' | 'mono';
export type VoiceLang = 'en-IN' | 'hi-IN' | 'mr-IN';
export interface Project { id: number; name: string; description: string; dueDate: string | null; priority: Priority; color: string; }
export interface Task {
  id: number; title: string; notes: string; projectId: number | null;
  dueDate: string | null; dueTime: string | null; kind: TaskKind;
  priority: Priority; remindersPerDay: number; status: 'todo' | 'done';
  completedAt: string | null; dailyDoneOn: string | null;
}
export interface Profile { name: string; role: string; bio: string; museTheme: MuseTheme; }
export interface Settings {
  notificationsEnabled: boolean; reminderMinutesBefore: number;
  voiceReminders: boolean; voiceLang: VoiceLang; friendlyReminders: boolean;
  backgroundReminders: boolean; ultronEnabled: boolean;
}
export interface UltronReminder {
  id: number; title: string; taskId: number | null; date: string; time: string;
  message: string; fired: boolean; createdAt: string;
}
export interface Snooze { [taskId: number]: string } // ISO until
export interface Dismissed { [reminderKey: string]: boolean }
export interface AppData {
  projects: Project[]; tasks: Task[]; profile: Profile; settings: Settings;
  snoozedUntil: Snooze; dismissed: Dismissed; reminded: { [key: string]: string };
  completedLog: string[]; // YYYY-MM-DD dates with a completion
  ultronReminders: UltronReminder[];
}
export const STORE_KEY = 'task-reminder-standalone-v1';
export const THEMES: Record<MuseTheme, { name: string; accent: string; accent2: string }> = {
  ocean: { name: 'Ocean', accent: '#0e7c6b', accent2: '#2563eb' },
  sunset: { name: 'Sunset', accent: '#ea580c', accent2: '#db2777' },
  forest: { name: 'Forest', accent: '#15803d', accent2: '#65a30d' },
  rose: { name: 'Rose', accent: '#e11d48', accent2: '#7c3aed' },
  mono: { name: 'Mono', accent: '#334155', accent2: '#0f172a' },
};
export const VOICE_KEYWORDS = ['main task', 'today task', 'tomorrow task', 'monthly task'];
export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + n); return todayStr(d);
}
export function seedData(): AppData {
  return {
    projects: [
      { id: 1, name: 'Fitness app', description: 'Building it with Codex.', dueDate: null, priority: 'normal', color: '#0E7C6B' },
      { id: 2, name: 'E-commerce hub', description: 'E-commerce hub where multiple vendors can develop and manage their e-commerce stores.', dueDate: null, priority: 'normal', color: '#2563EB' },
      { id: 3, name: 'Sarvana Studio', description: 'My own agency — building websites and organizing social media.', dueDate: '2026-11-13', priority: 'high_alert', color: '#E62E1B' },
    ],
    tasks: [
      { id: 1, title: 'Refine the landing page of Sarvana Studio', notes: 'Make the website clearer, add more motion graphics, and make it very easy to understand what the agency does.', projectId: 3, dueDate: '2026-11-13', dueTime: null, kind: 'task', priority: 'high_alert', remindersPerDay: 3, status: 'done', completedAt: '2026-11-12T18:21:43', dailyDoneOn: null },
      { id: 2, title: 'Work on fitness app', notes: '30 minutes — 12:00 to 12:30. Added by voice: work on the fitness app (building it with Codex).', projectId: 1, dueDate: '2026-11-13', dueTime: '12:00', kind: 'task', priority: 'high', remindersPerDay: 0, status: 'done', completedAt: '2026-11-12T17:35:26', dailyDoneOn: null },
      { id: 3, title: 'Wake up', notes: 'Daily routine — wake up at 6:00 AM. Repeats every day.', projectId: null, dueDate: null, dueTime: '06:00', kind: 'daily', priority: 'high', remindersPerDay: 0, status: 'todo', completedAt: null, dailyDoneOn: '2026-11-12' },
      { id: 4, title: 'Complete Java, IoT and Math assignments', notes: 'Java CS assignment, the important IoT assignment, and Math.', projectId: null, dueDate: '2026-11-13', dueTime: null, kind: 'task', priority: 'high_alert', remindersPerDay: 3, status: 'done', completedAt: '2026-11-12T18:21:48', dailyDoneOn: null },
      { id: 5, title: 'Set up news for daily work and routine', notes: 'Task 1 and 14 — set up news for daily work and routine.', projectId: null, dueDate: '2026-11-13', dueTime: '09:00', kind: 'task', priority: 'normal', remindersPerDay: 0, status: 'todo', completedAt: null, dailyDoneOn: null },
    ],
    profile: { name: 'Pranav', role: '', bio: '', museTheme: 'ocean' },
    settings: { notificationsEnabled: true, reminderMinutesBefore: 120, voiceReminders: true, voiceLang: 'en-IN', friendlyReminders: true, backgroundReminders: true, ultronEnabled: true },
    snoozedUntil: {}, dismissed: {}, reminded: {}, completedLog: ['2026-11-12'], ultronReminders: [],
  };
}
export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const d = JSON.parse(raw) as AppData; return { ...seedData(), ...d, settings: { ...seedData().settings, ...(d.settings || {}) }, profile: { ...seedData().profile, ...(d.profile || {}) } }; }
  } catch { /* fall through to seed */ }
  return seedData();
}
/** Parse a spoken transcript into an editable draft. */
export function parseVoiceTask(text: string, projects: Project[]) {
  const lower = text.toLowerCase();
  let dueDate: string | null = null;
  const today = todayStr();
  if (lower.includes('tomorrow')) dueDate = addDaysStr(today, 1);
  else if (lower.includes('today') || lower.includes('tonight')) dueDate = today;
  else if (lower.includes('next week')) dueDate = addDaysStr(today, 7);
  else if (lower.includes('next month')) dueDate = addDaysStr(today, 30);
  let dueTime: string | null = null;
  const clock = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(o'?clock|am|pm)?/);
  if (clock) {
    let h = parseInt(clock[1], 10);
    if (lower.includes('pm') && h < 12) h += 12;
    if (lower.includes('am') && h === 12) h = 0;
    dueTime = `${String(h).padStart(2, '0')}:${clock[2] || '00'}`;
  } else if (lower.includes('evening')) dueTime = '18:00';
  else if (lower.includes('morning')) dueTime = '09:00';
  else if (lower.includes('afternoon')) dueTime = '15:00';
  else if (lower.includes('night')) dueTime = '21:00';
  let priority: Priority = 'normal';
  if (lower.includes('high alert') || lower.includes('urgent') || lower.includes('very important') || lower.includes('must do')) priority = 'high_alert';
  else if (lower.includes('important') || lower.includes('high priority')) priority = 'high';
  let projectId: number | null = null;
  for (const p of projects) if (lower.includes(p.name.toLowerCase().split(' ')[0])) { projectId = p.id; break; }
  const kind: TaskKind = lower.includes('daily') || lower.includes('every day') ? 'daily' : 'task';
  const title = text.trim().replace(/^.{0,120}/, (m) => m).split(/[.!]/)[0].trim().slice(0, 120) || 'New task';
  return { title, notes: text.trim(), dueDate, dueTime, priority, projectId, kind };
}
export function pickVoice(lang: VoiceLang): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === lang) || voices.find((v) => v.lang && v.lang.startsWith(lang.slice(0, 2))) || voices.find((v) => v.default) || voices[0] || null;
}
export function speakText(text: string, lang: VoiceLang) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const v = pickVoice(lang);
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
  return true;
}
export function stopSpeaking() { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); }
export function taskSpeechText(t: Task): string {
  return `${t.title}. ${t.notes ? t.notes + '. ' : ''}${t.dueTime ? `Due at ${t.dueTime}. ` : ''}Priority ${t.priority === 'high_alert' ? 'high alert' : t.priority}.`;
}
/** Parse a time like "2pm", "2:30 pm", "14:00", "2 o'clock" from text. Returns HH:MM or null. */
export function parseTimeOfDay(text: string): string | null {
  const lower = text.toLowerCase();
  const m = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|o'?clock)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
}
export function findTaskByWords(tasks: Task[], text: string): Task | null {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z]+/).filter((w) => w.length > 3);
  let best: Task | null = null; let bestScore = 0;
  for (const t of tasks) {
    const hay = (t.title + ' ' + t.notes).toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length + (hay.includes(lower.slice(0, 20)) ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore > 0 ? best : null;
}
