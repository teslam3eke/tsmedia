-- ============================================================
-- 105：每日登入獎勵疊加——所有人 1 愛心 + 2 拼圖解鎖；訂閱另加 2 愛心
-- （換日與探索一致：app_day_key_now = 台北時間每晚 22:00）
-- ============================================================

create or replace function public.claim_daily_member_hearts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day text := public.app_day_key_now();
  v_expires timestamptz;
  v_subscribed boolean;
  v_bal int;
  v_blur int;
  v_hearts int := 1;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select subscription_expires_at into v_expires from public.profiles where id = v_user;

  v_subscribed := v_expires is not null and v_expires > now();

  if exists (select 1 from public.daily_bonus_claims where user_id = v_user and app_day_key = v_day) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed', 'app_day_key', v_day);
  end if;

  insert into public.daily_bonus_claims (user_id, app_day_key) values (v_user, v_day);

  -- 全帳號每日基礎：1 愛心 + 2 拼圖解鎖
  v_bal := public._credit_balance(v_user, 'heart');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'heart', 1, v_bal + 1, '每日登入：愛心 x1');

  v_blur := public._credit_balance(v_user, 'blur_unlock');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'blur_unlock', 2, v_blur + 2, '每日登入：拼圖解鎖 x2');

  if v_subscribed then
    v_bal := public._credit_balance(v_user, 'heart');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_user, 'purchase', 'heart', 2, v_bal + 2, '會員每日登入：愛心 x2');
    v_hearts := 3;
  end if;

  return jsonb_build_object(
    'ok', true,
    'tier', case when v_subscribed then 'member' else 'free' end,
    'hearts', v_hearts,
    'blur_unlock', 2,
    'app_day_key', v_day
  );
end;
$$;

grant execute on function public.claim_daily_member_hearts() to authenticated;

notify pgrst, 'reload schema';
