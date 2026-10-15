-- Feedback messages from the site's "Feedback" window.
-- Anyone (signed in or not) can send one; nobody can read them through the website.
-- Read them in the Supabase dashboard: Table Editor -> feedback.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null default 'idea' check (kind in ('idea', 'bug', 'other')),
  message text not null check (char_length(message) between 3 and 2000),
  contact text check (contact is null or char_length(contact) <= 200),
  page text check (page is null or char_length(page) <= 40),
  game text check (game is null or game in ('vanilla', 'sve')),
  user_id uuid default auth.uid()
);

alter table public.feedback enable row level security;

-- sending only: no select, update or delete policies, so the website can't read anything back
grant insert on public.feedback to anon, authenticated;
drop policy if exists "anyone can send feedback" on public.feedback;
create policy "anyone can send feedback" on public.feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
