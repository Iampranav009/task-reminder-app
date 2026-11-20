-- Task Reminder App — migration 002 (20 Nov 2026)
-- Add the 4th priority level 'very_normal' (muted dot) alongside
-- high_alert (red), high/urgent (blue) and normal (green).
-- Run this in Supabase SQL Editor if 001_init.sql was already applied.
alter table public.projects drop constraint if exists projects_priority_check;
alter table public.projects add constraint projects_priority_check
  check (priority in ('high_alert', 'high', 'normal', 'very_normal'));
alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check
  check (priority in ('high_alert', 'high', 'normal', 'very_normal'));
