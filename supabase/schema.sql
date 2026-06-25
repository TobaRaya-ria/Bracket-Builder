-- Bracket Builder Supabase schema
-- Run this in Supabase Dashboard → SQL Editor.

create table if not exists public.tourney_projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  format_type text,
  team_count integer not null default 0,
  folder_id text,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.tourney_folders (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  project_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists tourney_projects_user_updated_idx
  on public.tourney_projects (user_id, updated_at desc);

create index if not exists tourney_folders_user_updated_idx
  on public.tourney_folders (user_id, updated_at desc);

alter table public.tourney_projects enable row level security;
alter table public.tourney_folders enable row level security;

drop policy if exists "Users can read own tourney projects" on public.tourney_projects;
drop policy if exists "Users can insert own tourney projects" on public.tourney_projects;
drop policy if exists "Users can update own tourney projects" on public.tourney_projects;
drop policy if exists "Users can delete own tourney projects" on public.tourney_projects;

create policy "Users can read own tourney projects"
on public.tourney_projects for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own tourney projects"
on public.tourney_projects for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own tourney projects"
on public.tourney_projects for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own tourney projects"
on public.tourney_projects for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own tourney folders" on public.tourney_folders;
drop policy if exists "Users can insert own tourney folders" on public.tourney_folders;
drop policy if exists "Users can update own tourney folders" on public.tourney_folders;
drop policy if exists "Users can delete own tourney folders" on public.tourney_folders;

create policy "Users can read own tourney folders"
on public.tourney_folders for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own tourney folders"
on public.tourney_folders for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own tourney folders"
on public.tourney_folders for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own tourney folders"
on public.tourney_folders for delete
to authenticated
using (auth.uid() = user_id);
