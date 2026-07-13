-- 132：取消免費會員登入獎勵；僅有效訂閱（subscription_expires_at > now()）可領每日／首次禮

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
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select subscription_expires_at into v_expires from public.profiles where id = v_user;

  v_subscribed := v_expires is not null and v_expires > now();

  if not v_subscribed then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_subscribed',
      'tier', 'free',
      'app_day_key', v_day
    );
  end if;

  if exists (select 1 from public.daily_bonus_claims where user_id = v_user and app_day_key = v_day) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed', 'app_day_key', v_day);
  end if;

  insert into public.daily_bonus_claims (user_id, app_day_key) values (v_user, v_day);

  v_bal := public._credit_balance(v_user, 'heart');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'heart', 1, v_bal + 1, '每日登入：愛心 x1');

  v_blur := public._credit_balance(v_user, 'blur_unlock');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'blur_unlock', 2, v_blur + 2, '每日登入：拼圖解鎖 x2');

  v_bal := public._credit_balance(v_user, 'heart');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'heart', 2, v_bal + 2, '會員每日登入：愛心 x2');

  return jsonb_build_object(
    'ok', true,
    'tier', 'member',
    'hearts', 3,
    'blur_unlock', 2,
    'app_day_key', v_day
  );
end;
$$;

create or replace function public.claim_first_login_welcome_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_expires timestamptz;
  v_updated uuid;
  v_bal int;
  v_blur int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select subscription_expires_at into v_expires from public.profiles where id = v_user;

  if v_expires is null or v_expires <= now() then
    return jsonb_build_object('ok', false, 'reason', 'not_subscribed');
  end if;

  update public.profiles
  set first_login_bonus_granted_at = now(),
      updated_at = now()
  where id = v_user
    and first_login_bonus_granted_at is null
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  v_bal := public._credit_balance(v_user, 'heart');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'heart', 3, v_bal + 3, '首次登入禮：愛心 x3');

  v_blur := public._credit_balance(v_user, 'blur_unlock');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'blur_unlock', 2, v_blur + 2, '首次登入禮：拼圖解鎖 x2');

  return jsonb_build_object(
    'ok', true,
    'hearts', 3,
    'blur_unlock', 2
  );
end;
$$;

grant execute on function public.claim_daily_member_hearts() to authenticated;
grant execute on function public.claim_first_login_welcome_bonus() to authenticated;

notify pgrst, 'reload schema';
