-- Ask Scout per-user daily quotas (added 2026-11-15).
-- Run once in the Supabase dashboard SQL editor for project
-- "alpha-scout" (ref acypvrksprubtcekabzq). One row per user per day,
-- counted server-side by lib/quotas.ts. Days run on Africa/Lagos time.
-- RLS: a signed-in user can only read and write their own rows.

create table if not exists public.ask_scout_usage (
  user_id uuid not null,
  usage_date date not null,
  questions integer not null default 0,
  listens integer not null default 0,
  transcriptions integer not null default 0,
  last_question_at timestamptz,
  primary key (user_id, usage_date)
);

alter table public.ask_scout_usage enable row level security;

create policy "Users can view their own usage"
  on public.ask_scout_usage for select
  using (auth.uid() = user_id);

create policy "Users can record their own usage"
  on public.ask_scout_usage for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own usage"
  on public.ask_scout_usage for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
