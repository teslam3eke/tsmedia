-- Web Push 訂閱（每裝置一列 endpoint；發送由 Vercel + WEB_PUSH_* + SERVICE_ROLE 執行）

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions select own" on public.push_subscriptions;
create policy "push_subscriptions select own"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions insert own" on public.push_subscriptions;
create policy "push_subscriptions insert own"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions update own" on public.push_subscriptions;
create policy "push_subscriptions update own"
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions delete own" on public.push_subscriptions;
create policy "push_subscriptions delete own"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
