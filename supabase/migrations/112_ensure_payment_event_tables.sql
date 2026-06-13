-- 112：補齊金流稽核表（部分環境有 110 但未跑 015／080 時 fulfill 會失敗）

create table if not exists public.subscription_payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'tappay',
  amount_ntd int not null,
  rec_trade_id text,
  gateway_status int,
  created_at timestamptz not null default now()
);

alter table public.subscription_payment_events enable row level security;

drop policy if exists "subscription_payment_events: no user access" on public.subscription_payment_events;
create policy "subscription_payment_events: no user access"
  on public.subscription_payment_events for all
  using (false)
  with check (false);

create table if not exists public.credit_pack_payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pack_key text not null,
  provider text not null default 'tappay',
  amount_ntd int not null,
  rec_trade_id text,
  gateway_status int,
  created_at timestamptz not null default now()
);

alter table public.credit_pack_payment_events enable row level security;

drop policy if exists "credit_pack_payment_events: no user access" on public.credit_pack_payment_events;
create policy "credit_pack_payment_events: no user access"
  on public.credit_pack_payment_events for all
  using (false)
  with check (false);

notify pgrst, 'reload schema';
