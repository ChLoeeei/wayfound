-- Wayfound — v2 feature A: per-user travel memory
-- One row per signed-in user holding the structured TravelMemory blob
-- (src/lib/memory.ts). Guests keep the same blob in localStorage and it is
-- copied here on their first login (src/lib/memoryStore.ts). Owner-only RLS:
-- nothing but the user's own session can read or change it, and no server
-- code path reads this table, so it never feeds the shared experience library.

create table if not exists public.user_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  memory jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_memory enable row level security;

drop policy if exists "owners can read own memory" on public.user_memory;
create policy "owners can read own memory"
  on public.user_memory for select
  using (auth.uid() = user_id);

drop policy if exists "owners can insert own memory" on public.user_memory;
create policy "owners can insert own memory"
  on public.user_memory for insert
  with check (auth.uid() = user_id);

drop policy if exists "owners can update own memory" on public.user_memory;
create policy "owners can update own memory"
  on public.user_memory for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owners can delete own memory" on public.user_memory;
create policy "owners can delete own memory"
  on public.user_memory for delete
  using (auth.uid() = user_id);

-- Reuses set_updated_at() from 0001_itineraries.sql
drop trigger if exists user_memory_set_updated_at on public.user_memory;
create trigger user_memory_set_updated_at
  before update on public.user_memory
  for each row execute function public.set_updated_at();
