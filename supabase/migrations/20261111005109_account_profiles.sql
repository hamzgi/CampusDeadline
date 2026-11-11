-- A minimal account record; assignment data is added in the next stage.
create table public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.account_profiles enable row level security;

revoke all on table public.account_profiles from public, anon, authenticated;
grant select on table public.account_profiles to authenticated;
grant insert (user_id) on table public.account_profiles to authenticated;

create policy "account_profiles_select_own"
  on public.account_profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "account_profiles_insert_own"
  on public.account_profiles
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
