-- Wayfound — Sprint 6 share-link migration
-- Allow anonymous (no auth) inserts when is_public = true so users
-- can generate share links without signing in. Owner policies for
-- private rows remain unchanged.

-- 1. Make user_id nullable (anonymous shares have no owner)
alter table public.itineraries
  alter column user_id drop not null;

-- 2. Drop the existing owner-only insert policy and replace it with
--    one that lets anyone insert as long as the row is public.
drop policy if exists "owners can insert own" on public.itineraries;

create policy "owners can insert own"
  on public.itineraries for insert
  with check (auth.uid() = user_id);

create policy "anyone can insert public"
  on public.itineraries for insert
  with check (is_public = true and user_id is null);

-- 3. Public read policy already exists from 0001 — re-affirm here.
drop policy if exists "anyone can read public" on public.itineraries;
create policy "anyone can read public"
  on public.itineraries for select
  using (is_public = true);
