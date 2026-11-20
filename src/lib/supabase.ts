/**
 * Supabase backend for the Task Reminder App.
 *
 * Data lives in Supabase (Postgres) when the app is configured with
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * When those env vars are missing, the app does NOT fall back to
 * local storage — it shows "Supabase not connected" and keeps data
 * in memory only for that session (user decision, 20 Nov 2026).
 *
 * No real URL or key is stored in this repo — placeholders only.
 * See README.md ("Data: Supabase") for setup.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppData, Project, Task, UltronReminder } from './core';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export function supabaseConfigured(): boolean {
  return (
    URL.startsWith('http') &&
    !URL.includes('YOUR_SUPABASE_URL') &&
    ANON_KEY.length > 10 &&
    !ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY')
  );
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  if (!client) {
    try {
      client = createClient(URL, ANON_KEY);
    } catch {
      return null;
    }
  }
  return client;
}

/* ---------- Row mapping: Supabase snake_case <-> AppData camelCase ---------- */

type ProjectRow = { id: number; name: string; description: string | null; due_date: string | null; priority: Project['priority']; color: string };
type TaskRow = { id: number; title: string; notes: string | null; project_id: number | null; due_date: string | null; due_time: string | null; kind: Task['kind']; priority: Task['priority']; status: Task['status']; reminders_per_day: number; completed_at: string | null; daily_done_on: string | null };
type ReminderRow = { id: number; title: string; task_id: number | null; date: string; time: string; message: string | null; fired: boolean };

const toProject = (r: ProjectRow): Project => ({ id: r.id, name: r.name, description: r.description || '', dueDate: r.due_date, priority: r.priority, color: r.color });
const fromProject = (p: Project): ProjectRow => ({ id: p.id, name: p.name, description: p.description, due_date: p.dueDate, priority: p.priority, color: p.color });
const toTask = (r: TaskRow): Task => ({ id: r.id, title: r.title, notes: r.notes || '', projectId: r.project_id, dueDate: r.due_date, dueTime: r.due_time, kind: r.kind, priority: r.priority, status: r.status, remindersPerDay: r.reminders_per_day, completedAt: r.completed_at, dailyDoneOn: r.daily_done_on });
const fromTask = (t: Task): TaskRow => ({ id: t.id, title: t.title, notes: t.notes, project_id: t.projectId, due_date: t.dueDate, due_time: t.dueTime, kind: t.kind, priority: t.priority, status: t.status, reminders_per_day: t.remindersPerDay, completed_at: t.completedAt, daily_done_on: t.dailyDoneOn });
const toReminder = (r: ReminderRow): UltronReminder => ({ id: r.id, title: r.title, taskId: r.task_id, date: r.date, time: r.time, message: r.message || '', fired: r.fired, createdAt: '' });
const fromReminder = (r: UltronReminder): ReminderRow => ({ id: r.id, title: r.title, task_id: r.taskId, date: r.date, time: r.time, message: r.message, fired: r.fired });

/* ---------- Load ---------- */

/** Load projects/tasks/reminders/settings from Supabase. Null = not configured or failed. */
export async function loadFromSupabase(): Promise<Partial<AppData> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const [projects, tasks, reminders, settings] = await Promise.all([
      sb.from('projects').select('*').order('id'),
      sb.from('tasks').select('*').order('id'),
      sb.from('ultron_reminders').select('*').order('id'),
      sb.from('app_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (projects.error || tasks.error || reminders.error) return null;
    // Supabase is the source of truth: return the real rows, even when
    // a table is empty ([]), so the app never falls back to seed/demo
    // data when the cloud is empty.
    const out: Partial<AppData> = {
      projects: (projects.data as ProjectRow[]).map(toProject),
      tasks: (tasks.data as TaskRow[]).map(toTask),
      ultronReminders: (reminders.data as ReminderRow[]).map(toReminder),
    };
    if (!settings.error && settings.data) {
      if (settings.data.settings) out.settings = settings.data.settings as AppData['settings'];
      if (settings.data.profile) out.profile = settings.data.profile as AppData['profile'];
    }
    return out;
  } catch {
    return null;
  }
}

/* ---------- Save (debounced) ---------- */

async function saveOnce(data: AppData): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    // Upsert everything, then delete rows that no longer exist locally.
    const up = async (table: string, rows: Record<string, unknown>[]) => {
      if (!rows.length) return;
      const { error } = await sb.from(table).upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    };
    await up('projects', data.projects.map(fromProject));
    await up('tasks', data.tasks.map(fromTask));
    await up('ultron_reminders', data.ultronReminders.map(fromReminder));
    const { error: sErr } = await sb.from('app_settings').upsert(
      { id: 1, settings: data.settings, profile: data.profile },
      { onConflict: 'id' },
    );
    if (sErr) throw sErr;
    // Prune deleted rows (best effort; never blocks the save).
    const prune = async (table: string, keep: number[]) => {
      const { data: rows } = await sb.from(table).select('id');
      const gone = (rows || []).map((r) => (r as { id: number }).id).filter((id) => !keep.includes(id));
      if (gone.length) await sb.from(table).delete().in('id', gone);
    };
    await prune('projects', data.projects.map((p) => p.id));
    await prune('tasks', data.tasks.map((t) => t.id));
    await prune('ultron_reminders', data.ultronReminders.map((r) => r.id));
    return true;
  } catch {
    return false;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced save — call on every data change; saves at most once per 800 ms. */
export function debouncedSaveToSupabase(data: AppData): void {
  if (!supabaseConfigured()) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveOnce(data).catch(() => {});
  }, 800);
}
