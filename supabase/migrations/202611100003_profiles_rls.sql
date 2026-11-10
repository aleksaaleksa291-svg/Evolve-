-- EVOLVE profiles table linked to Supabase Auth users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Keep profile access restricted to the authenticated owner.
drop policy if exists "profile owner access" on public.profiles;
drop policy if exists "evolve_profiles_owner" on public.profiles;
create policy "evolve_profiles_owner" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
revoke all on public.profiles from anon;
