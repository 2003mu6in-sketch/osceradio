-- Masterpiece OSCE & MCQ Trainer – progress sync (run once in Supabase: SQL Editor → New query → Run).
-- Two tables hold each student's progress. Row-level security means a signed-in student can only ever
-- read or write their own rows; the anon key on its own can read nothing.

-- ---------------------------------------------------------------- tables

-- One row per question the student has answered: the app's ReviewState, stored as JSON.
create table if not exists public.reviews (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  card_id    text        not null check (char_length(card_id) between 1 and 80),
  data       jsonb       not null check (pg_column_size(data) < 8192),
  rev        bigint      not null,                     -- client time (ms) of the last change; newest wins
  updated_at timestamptz not null default clock_timestamp(),   -- server time; used as the pull cursor
  primary key (user_id, card_id)
);

-- One row per error-log entry. Deleted entries stay as tombstones (deleted = true, data = null)
-- so the deletion reaches the student's other devices.
create table if not exists public.error_entries (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) between 1 and 80),
  card_id    text        not null check (char_length(card_id) between 1 and 80),
  data       jsonb       check (pg_column_size(data) < 16384),
  created_at bigint      not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  check (deleted or data is not null)
);

create index if not exists reviews_user_updated_idx       on public.reviews       (user_id, updated_at);
create index if not exists error_entries_user_updated_idx on public.error_entries (user_id, updated_at);

-- ---------------------------------------------------------------- write rules (enforced on the server)

-- reviews: an older change never overwrites a newer one (two devices syncing at once).
create or replace function public.reviews_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.rev < old.rev then
    return null;                      -- keep the newer row; skip this update
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists reviews_before_write on public.reviews;
create trigger reviews_before_write before insert or update on public.reviews
  for each row execute function public.reviews_before_write();

-- error_entries: once deleted, an entry stays deleted.
create or replace function public.error_entries_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.deleted then
    return null;
  end if;
  if new.deleted then
    new.data := null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists error_entries_before_write on public.error_entries;
create trigger error_entries_before_write before insert or update on public.error_entries
  for each row execute function public.error_entries_before_write();

-- ---------------------------------------------------------------- row-level security

alter table public.reviews       enable row level security;
alter table public.error_entries enable row level security;

drop policy if exists "own reviews" on public.reviews;
create policy "own reviews" on public.reviews
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own error entries" on public.error_entries;
create policy "own error entries" on public.error_entries
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.reviews, public.error_entries from anon;
grant select, insert, update, delete on public.reviews, public.error_entries to authenticated;

-- ---------------------------------------------------------------- delete my account

-- Called from the app's Account page. Deletes the signed-in user; their rows go with it (on delete cascade).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
