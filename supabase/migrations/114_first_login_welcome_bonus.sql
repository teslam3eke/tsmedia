-- ============================================================
-- 114：首次進入主 App 一次性歡迎禮（額外 3 愛心 + 2 拼圖解鎖，與每日登入疊加）
-- ============================================================

alter table public.profiles
  add column if not exists first_login_bonus_granted_at timestamptz;

comment on column public.profiles.first_login_bonus_granted_at is
  '首次進入主 App 歡迎禮已發放時間（每帳號一次）';

-- 114 上線前已存在的帳號不回補歡迎禮
update public.profiles
set first_login_bonus_granted_at = now()
where first_login_bonus_granted_at is null;

create or replace function public.claim_first_login_welcome_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_updated uuid;
  v_bal int;
  v_blur int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
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

grant execute on function public.claim_first_login_welcome_bonus() to authenticated;

notify pgrst, 'reload schema';
