-- Hertzspace accounts: run once in Supabase → SQL Editor.
-- Sign-in itself is handled by Supabase Auth (auth.users).
-- This table records who has Plus. Only the Worker (service role) writes to it.

create table if not exists public.entitlements (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  plus           boolean not null default false,
  stripe_session text unique,
  stripe_customer text,
  purchased_at   timestamptz not null default now()
);

alter table public.entitlements enable row level security;

-- Signed-in users can read their own row; nobody can write from the browser.
drop policy if exists "read own entitlement" on public.entitlements;
create policy "read own entitlement" on public.entitlements
  for select using (auth.uid() = user_id);
