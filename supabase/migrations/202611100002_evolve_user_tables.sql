-- EVOLVE additive user-data migration.
-- Run manually in Supabase SQL Editor. This script creates/extends tables and policies only;
-- it does not delete existing rows or drop existing tables.

create extension if not exists pgcrypto;

-- A profile belongs to exactly one Supabase Auth user.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One progress record per account. XP and level are client-maintained in this static app;
-- RLS protects other users' rows, but is not an anti-cheat mechanism for the row owner.
create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  stats jsonb not null default '{}'::jsonb,
  xp_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Habits are user-owned. Existing habits rows (if any) are preserved.
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Daily checklist items are kept separately from recurring habit definitions.
create table if not exists public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_date date not null default current_date,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '',
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Training history. This new table does not modify or remove any existing `workouts` rows.
create table if not exists public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null check (char_length(btrim(activity_type)) between 1 and 100),
  minutes integer not null check (minutes between 1 and 300),
  note text not null default '',
  activity_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists daily_tasks_user_date_idx on public.daily_tasks (user_id, task_date desc);
create index if not exists workout_logs_user_date_idx on public.workout_logs (user_id, activity_date desc);
create index if not exists habits_user_id_idx on public.habits (user_id);

alter table public.profiles enable row level security;
alter table public.user_progress enable row level security;
alter table public.habits enable row level security;
alter table public.daily_tasks enable row level security;
alter table public.workout_logs enable row level security;

-- Owner-only policies. Re-running this migration replaces only these named policies.
drop policy if exists "evolve_profiles_owner" on public.profiles;
create policy "evolve_profiles_owner" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "evolve_progress_owner" on public.user_progress;
create policy "evolve_progress_owner" on public.user_progress
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "evolve_habits_owner" on public.habits;
create policy "evolve_habits_owner" on public.habits
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "evolve_daily_tasks_owner" on public.daily_tasks;
create policy "evolve_daily_tasks_owner" on public.daily_tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "evolve_workout_logs_owner" on public.workout_logs;
create policy "evolve_workout_logs_owner" on public.workout_logs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No anonymous access. Authenticated requests are further restricted by the RLS policies above.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.user_progress, public.habits, public.daily_tasks, public.workout_logs to authenticated;
revoke all on public.profiles, public.user_progress, public.habits, public.daily_tasks, public.workout_logs from anon;

-- Ensure new Auth users receive their own profile and progress rows.
-- Existing rows are not overwritten by this trigger/backfill.
create or replace function public.handle_new_evolve_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_evolve_user() from public, anon, authenticated;
drop trigger if exists on_evolve_user_created on auth.users;
create trigger on_evolve_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_evolve_user();

-- Backfill profiles/progress for Auth users that already exist. Existing records remain intact.
insert into public.profiles (id, email, display_name)
select id, email, coalesce(raw_user_meta_data ->> 'display_name', '')
from auth.users
on conflict (id) do nothing;

insert into public.user_progress (user_id)
select id from auth.users
on conflict (user_id) do nothing;
