-- Server-only grant after verified payment (e.g. TapPay webhook / Vercel API with service role).
-- Revokes direct client "simulate payment" to reduce abuse when going live (use migration 016 or manual mock RPC if needed for dev).

create or replace function public.grant_monthly_membership_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gender text;
  v_price int;
  v_expires timestamptz;
  v_welcome timestamptz;
  v_h int; v_s int; v_b int;
begin
  if p_user_id is null then
    raise exception 'User required';
  end if;

  select gender, subscription_expires_at, membership_welcome_granted_at
  into v_gender, v_expires, v_welcome
  from public.profiles where id = p_user_id;

  if v_gender is null then
    raise exception 'Profile gender required';
  end if;

  v_price := case when v_gender = 'male' then 399 else 299 end;

  v_expires := greatest(coalesce(v_expires, now()), now()) + interval '30 days';

  update public.profiles
  set subscription_expires_at = v_expires,
      updated_at = now()
  where id = p_user_id;

  if v_welcome is null then
    v_h := public._credit_balance(p_user_id, 'heart');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (p_user_id, 'purchase', 'heart', 3, v_h + 3, '會員開通禮：愛心 x3');

    v_s := public._credit_balance(p_user_id, 'super_like');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (p_user_id, 'purchase', 'super_like', 1, v_s + 1, '會員開通禮：超級喜歡 x1');

    v_b := public._credit_balance(p_user_id, 'blur_unlock');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (p_user_id, 'purchase', 'blur_unlock', 10, v_b + 10, '會員開通禮：解除拼圖模糊 x10');

    update public.profiles
    set membership_welcome_granted_at = now(), updated_at = now()
    where id = p_user_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'price_ntd', v_price,
    'subscription_expires_at', v_expires
  );
end;
$$;

revoke all on function public.grant_monthly_membership_for_user(uuid) from public;
grant execute on function public.grant_monthly_membership_for_user(uuid) to service_role;

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

-- No user SELECT: billing ops use service_role only.
drop policy if exists "subscription_payment_events: no user access" on public.subscription_payment_events;
create policy "subscription_payment_events: no user access"
  on public.subscription_payment_events for all
  using (false)
  with check (false);
