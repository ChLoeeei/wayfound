-- Wayfound — itineraries table + RLS policies
-- Run this in Supabase SQL Editor, or via `supabase db push` if using the CLI.

create table if not exists public.itineraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists itineraries_user_id_idx on public.itineraries (user_id);
create index if not exists itineraries_updated_at_idx on public.itineraries (updated_at desc);

alter table public.itineraries enable row level security;

-- Owner can do anything to their own rows
drop policy if exists "owners can read own" on public.itineraries;
create policy "owners can read own"
  on public.itineraries for select
  using (auth.uid() = user_id);

drop policy if exists "owners can insert own" on public.itineraries;
create policy "owners can insert own"
  on public.itineraries for insert
  with check (auth.uid() = user_id);

drop policy if exists "owners can update own" on public.itineraries;
create policy "owners can update own"
  on public.itineraries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owners can delete own" on public.itineraries;
create policy "owners can delete own"
  on public.itineraries for delete
  using (auth.uid() = user_id);

-- Anyone (including anon) can read public itineraries via share link
drop policy if exists "anyone can read public" on public.itineraries;
create policy "anyone can read public"
  on public.itineraries for select
  using (is_public = true);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists itineraries_set_updated_at on public.itineraries;
create trigger itineraries_set_updated_at
  before update on public.itineraries
  for each row execute function public.set_updated_at();
