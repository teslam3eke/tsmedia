-- ============================================================
-- Migration 013: 會員訂閱 / 每日登入獎勵（愛心、超級喜歡消耗）
-- 每日切換：Asia/Taipei 晚上 22:00 起算新的一天（app_day_key）
-- ============================================================

alter table public.profiles
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists membership_welcome_granted_at timestamptz;

create table if not exists public.daily_bonus_claims (
  user_id      uuid references auth.users on delete cascade not null,
  app_day_key  text not null,
  claimed_at   timestamptz not null default now(),
  primary key (user_id, app_day_key)
);

alter table public.daily_bonus_claims enable row level security;

drop policy if exists "daily_bonus: own read" on public.daily_bonus_claims;
create policy "daily_bonus: own read"
  on public.daily_bonus_claims for select
  using (user_id = auth.uid());

drop policy if exists "daily_bonus: own insert" on public.daily_bonus_claims;
create policy "daily_bonus: own insert"
  on public.daily_bonus_claims for insert
  with check (user_id = auth.uid());

-- ── Helpers ─────────────────────────────────────────────────

create or replace function public._credit_balance(p_user uuid, p_type text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::int
  from public.credit_transactions
  where user_id = p_user and credit_type = p_type;
$$;

-- App day key: (Asia/Taipei local moment - 22 hours) → calendar date text YYYY-MM-DD
create or replace function public.app_day_key_now()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select to_char(
    ((current_timestamp at time zone 'Asia/Taipei') - interval '22 hours')::date,
    'YYYY-MM-DD'
  );
$$;

-- ── Complete monthly membership (simulate payment until Stripe exists) ──

create or replace function public.complete_monthly_membership()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_gender text;
  v_price int;
  v_expires timestamptz;
  v_welcome timestamptz;
  v_h int; v_s int; v_b int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select gender, subscription_expires_at, membership_welcome_granted_at
  into v_gender, v_expires, v_welcome
  from public.profiles where id = v_user;
  if v_gender is null then
    raise exception 'Profile gender required';
  end if;

  v_price := case when v_gender = 'male' then 399 else 299 end;

  v_expires := greatest(coalesce(v_expires, now()), now()) + interval '30 days';

  update public.profiles
  set subscription_expires_at = v_expires,
      updated_at = now()
  where id = v_user;

  if v_welcome is null then
    v_h := public._credit_balance(v_user, 'heart');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_user, 'purchase', 'heart', 3, v_h + 3, '會員開通禮：愛心 x3');

    v_s := public._credit_balance(v_user, 'super_like');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_user, 'purchase', 'super_like', 1, v_s + 1, '會員開通禮：超級喜歡 x1');

    v_b := public._credit_balance(v_user, 'blur_unlock');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_user, 'purchase', 'blur_unlock', 10, v_b + 10, '會員開通禮：解除拼圖模糊 x10');

    update public.profiles
    set membership_welcome_granted_at = now(), updated_at = now()
    where id = v_user;
  end if;

  return jsonb_build_object(
    'ok', true,
    'price_ntd', v_price,
    'subscription_expires_at', v_expires
  );
end;
$$;

grant execute on function public.complete_monthly_membership() to authenticated;

-- ── Daily 2 hearts for active members (once per app_day_key) ──

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
  v_bal int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select subscription_expires_at into v_expires from public.profiles where id = v_user;

  if v_expires is null or v_expires <= now() then
    return jsonb_build_object('ok', false, 'reason', 'not_subscribed');
  end if;

  if exists (select 1 from public.daily_bonus_claims where user_id = v_user and app_day_key = v_day) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed', 'app_day_key', v_day);
  end if;

  insert into public.daily_bonus_claims (user_id, app_day_key) values (v_user, v_day);

  v_bal := public._credit_balance(v_user, 'heart');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'heart', 2, v_bal + 2, '會員每日登入：愛心 x2');

  return jsonb_build_object('ok', true, 'hearts', 2, 'app_day_key', v_day);
end;
$$;

grant execute on function public.claim_daily_member_hearts() to authenticated;

-- ── record_profile_interaction: spend hearts / super_like ──

create or replace function public.record_profile_interaction(
  p_target_profile_key text,
  p_action text,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_matched boolean := false;
  v_user_a uuid;
  v_user_b uuid;
  v_heart int;
  v_super int;
  v_new_bal int;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_action not in ('pass', 'like', 'super_like') then
    raise exception 'Invalid action';
  end if;

  if p_action = 'like' then
    v_heart := public._credit_balance(v_actor, 'heart');
    if v_heart < 1 then
      raise exception 'INSUFFICIENT_HEART';
    end if;
    v_new_bal := v_heart - 1;
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_actor, 'spend', 'heart', -1, v_new_bal, '探索：送出愛心');
  elsif p_action = 'super_like' then
    v_super := public._credit_balance(v_actor, 'super_like');
    if v_super < 1 then
      raise exception 'INSUFFICIENT_SUPER_LIKE';
    end if;
    v_new_bal := v_super - 1;
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_actor, 'spend', 'super_like', -1, v_new_bal, '探索：超級喜歡');
  end if;

  insert into public.profile_interactions (
    actor_user_id, target_user_id, target_profile_key, action
  )
  values (
    v_actor, p_target_user_id, p_target_profile_key, p_action
  )
  on conflict (actor_user_id, target_profile_key)
  do update set
    target_user_id = excluded.target_user_id,
    action = excluded.action,
    created_at = now();

  if p_action = 'super_like' and p_target_user_id is not null and p_target_user_id <> v_actor then
    insert into public.app_notifications (user_id, kind, title, body)
    values (
      p_target_user_id,
      'super_like_received',
      '有人對你按了超級喜歡',
      '對方使用超級喜歡讓你知道他對你有興趣。'
    );
  end if;

  if p_target_user_id is not null
     and p_target_user_id <> v_actor
     and p_action in ('like', 'super_like')
     and exists (
       select 1
       from public.profile_interactions i
       where i.actor_user_id = p_target_user_id
         and i.target_user_id = v_actor
         and i.action in ('like', 'super_like')
     )
  then
    v_user_a := least(v_actor, p_target_user_id);
    v_user_b := greatest(v_actor, p_target_user_id);

    insert into public.matches (user_a, user_b)
    values (v_user_a, v_user_b)
    on conflict (user_a, user_b) do nothing;

    v_matched := true;

    insert into public.app_notifications (user_id, kind, title, body)
    values
      (v_actor, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
      (p_target_user_id, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
  end if;

  return jsonb_build_object('matched', v_matched);
end;
$$;

grant execute on function public.record_profile_interaction(text, text, uuid) to authenticated;
