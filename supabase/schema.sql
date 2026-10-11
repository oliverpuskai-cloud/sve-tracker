-- SVE Fish Log: cloud save for signed-in players.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One row per player. `data` holds the same JSON the site keeps in localStorage
-- (all farms, ticked fish, bundles, settings).

create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security: every player can only see and change their own row.
alter table public.progress enable row level security;

drop policy if exists "read own progress"   on public.progress;
drop policy if exists "insert own progress" on public.progress;
drop policy if exists "update own progress" on public.progress;
drop policy if exists "delete own progress" on public.progress;

create policy "read own progress"   on public.progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own progress" on public.progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own progress" on public.progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own progress" on public.progress for delete to authenticated using ((select auth.uid()) = user_id);
