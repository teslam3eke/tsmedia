-- ============================================================
-- 095：綠界 ECPay 訂單（PaymentInfoURL 入帳冪等；B 方案單次付清）
-- ============================================================

create table if not exists public.ecpay_orders (
  id uuid primary key default gen_random_uuid(),
  merchant_trade_no text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  product_type text not null check (product_type in ('membership', 'credit_pack')),
  pack_key text,
  amount_ntd int not null check (amount_ntd > 0),
  item_desc text not null,
  status public.newebpay_order_status not null default 'pending',
  ecpay_trade_no text,
  raw_result jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ecpay_orders_user_created_idx
  on public.ecpay_orders (user_id, created_at desc);

alter table public.ecpay_orders enable row level security;

drop policy if exists "ecpay_orders: no user access" on public.ecpay_orders;
create policy "ecpay_orders: no user access"
  on public.ecpay_orders for all
  using (false)
  with check (false);

notify pgrst, 'reload schema';
