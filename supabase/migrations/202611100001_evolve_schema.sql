-- EVOLVE Supabase schema. Run in Supabase SQL Editor as project owner.
-- No secrets are stored here. Every client-accessible table has RLS enabled.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  stats jsonb not null default '{}'::jsonb,
  xp_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null,
  minutes integer not null check (minutes between 1 and 300),
  note text not null default '',
  activity_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.habit_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  checked_on date not null,
  primary key (user_id, habit_id, checked_on)
);

-- A versioned, per-account snapshot preserves legacy localStorage structures (notes, tasks,
-- moods, challenges, badges, preferences) while normalized feature tables are adopted.
create table if not exists public.evolve_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_progress enable row level security;
alter table public.workouts enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.habits enable row level security;
alter table public.habit_checks enable row level security;
alter table public.evolve_snapshots enable row level security;

-- Remove broad/old policies before installing the owner-only policies.
do $$ declare t text; p record; begin
  foreach t in array array['profiles','user_progress','workouts','lesson_progress','habits','habit_checks','evolve_snapshots'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I',p.policyname,t);
    end loop;
  end loop;
end $$;

create policy "profile owner access" on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "progress owner access" on public.user_progress for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "workout owner access" on public.workouts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "lesson owner access" on public.lesson_progress for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "habit owner access" on public.habits for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "habit check owner access" on public.habit_checks for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "snapshot owner access" on public.evolve_snapshots for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Create a profile and initial progress row for every newly registered account.
create or replace function public.handle_new_evolve_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do update set email = excluded.email;
  insert into public.user_progress (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_evolve_user() from public, anon, authenticated;
drop trigger if exists on_evolve_user_created on auth.users;
create trigger on_evolve_user_created after insert on auth.users for each row execute procedure public.handle_new_evolve_user();

-- Set grants explicitly; RLS still filters every row to its owner.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.user_progress, public.workouts, public.lesson_progress, public.habits, public.habit_checks, public.evolve_snapshots to authenticated;
revoke all on public.profiles, public.user_progress, public.workouts, public.lesson_progress, public.habits, public.habit_checks, public.evolve_snapshots from anon;
