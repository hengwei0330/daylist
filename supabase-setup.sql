-- =========================================================
-- Daylist — database setup
--
-- Run this ONCE in your Supabase project:
--   supabase.com → your project → SQL Editor → New query
--   → paste all of this → Run
--
-- It creates the table the app stores tasks in, and the rules
-- that stop one account from reading another account's tasks.
-- =========================================================

-- ---------- the table ----------
create table if not exists public.tasks (
  id           uuid        primary key default gen_random_uuid(),

  -- which account this row belongs to. auth.users is Supabase's own
  -- account table; deleting an account deletes that person's tasks.
  user_id      uuid        not null default auth.uid()
                           references auth.users (id) on delete cascade,

  text         text        not null,
  done         boolean     not null default false,
  due          date,                       -- null means "no due date"
  priority     smallint    not null default 0,   -- 0 none, 1 "!", 2 "!!"
  list         text,                       -- the #tag, or null
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- Makes "show me my tasks, newest first" fast once there are many rows.
create index if not exists tasks_user_id_created_at_idx
  on public.tasks (user_id, created_at);

-- ---------- the security rules ----------
-- THIS IS THE IMPORTANT PART. Without it, the public API key in
-- supabase-config.js would let anyone read the whole table.
--
-- Row Level Security means: every query is automatically filtered,
-- inside the database, to rows the requester is allowed to touch.
-- auth.uid() is the id of whoever is signed in on that request.

alter table public.tasks enable row level security;

drop policy if exists "read own tasks"   on public.tasks;
drop policy if exists "insert own tasks" on public.tasks;
drop policy if exists "update own tasks" on public.tasks;
drop policy if exists "delete own tasks" on public.tasks;

create policy "read own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "insert own tasks"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "update own tasks"
  on public.tasks for update
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);
