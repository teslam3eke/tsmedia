-- ============================================================
-- 080：會員管理 — 取消訂閱、道具包購買入帳（TapPay / 模擬）
-- ============================================================

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

-- ─── 取消會員（不再享有會員權益；不自動續扣需另接 TapPay 定期授權） ─────────

create or replace function public.cancel_membership_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_expires timestamptz;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select subscription_expires_at into v_expires
  from public.profiles
  where id = v_user;

  if v_expires is null or v_expires <= now() then
    return jsonb_build_object('ok', false, 'reason', 'not_subscribed');
  end if;

  update public.profiles
  set subscription_expires_at = null,
      updated_at = now()
  where id = v_user;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.cancel_membership_subscription() to authenticated;

-- ─── 道具包入帳（service_role：TapPay 成功後） ─────────────────────────────

create or replace function public.grant_credit_pack_for_user(p_user_id uuid, p_pack_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super int;
  v_blur int;
  v_amount int;
  v_desc text;
begin
  if p_user_id is null then
    raise exception 'User required';
  end if;

  if p_pack_key = 'super_like_5' then
    v_amount := 5;
    v_super := public._credit_balance(p_user_id, 'super_like');
    insert into public.credit_transactions (
      user_id, kind, credit_type, amount, balance_after, description, related_ref
    )
    values (
      p_user_id,
      'purchase',
      'super_like',
      v_amount,
      v_super + v_amount,
      '加購道具：超級喜歡 x5',
      'pack:super_like_5'
    );
    return jsonb_build_object('ok', true, 'pack_key', p_pack_key, 'super_like', v_amount);
  elsif p_pack_key = 'blur_unlock_16' then
    v_amount := 16;
    v_blur := public._credit_balance(p_user_id, 'blur_unlock');
    insert into public.credit_transactions (
      user_id, kind, credit_type, amount, balance_after, description, related_ref
    )
    values (
      p_user_id,
      'purchase',
      'blur_unlock',
      v_amount,
      v_blur + v_amount,
      '加購道具：解除拼圖 x16',
      'pack:blur_unlock_16'
    );
    return jsonb_build_object('ok', true, 'pack_key', p_pack_key, 'blur_unlock', v_amount);
  else
    raise exception 'Invalid pack';
  end if;
end;
$$;

revoke all on function public.grant_credit_pack_for_user(uuid, text) from public;
grant execute on function public.grant_credit_pack_for_user(uuid, text) to service_role;

-- ─── 模擬購買道具（無 TapPay 時；與 complete_monthly_membership 同模式） ───

create or replace function public.purchase_credit_pack(p_pack_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if p_pack_key not in ('super_like_5', 'blur_unlock_16') then
    raise exception 'Invalid pack';
  end if;

  return public.grant_credit_pack_for_user(v_user, p_pack_key);
end;
$$;

grant execute on function public.purchase_credit_pack(text) to authenticated;

notify pgrst, 'reload schema';
