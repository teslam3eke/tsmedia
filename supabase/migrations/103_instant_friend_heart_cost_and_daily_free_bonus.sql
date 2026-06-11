-- ============================================================
-- Migration 103: 即時配對加好友（男性扣愛心／終身 2 次免費）＋免費會員每日登入獎勵
-- ============================================================

alter table public.profiles
  add column if not exists instant_friend_free_uses_consumed smallint not null default 0;

alter table public.profiles
  drop constraint if exists profiles_instant_friend_free_uses_consumed_check;

alter table public.profiles
  add constraint profiles_instant_friend_free_uses_consumed_check
  check (instant_friend_free_uses_consumed >= 0 and instant_friend_free_uses_consumed <= 2);

comment on column public.profiles.instant_friend_free_uses_consumed is
  '男性即時配對選「加為好友」已使用的終身免費次數（上限 2）';

-- ─── 每日登入：訂閱 2 愛心；免費 1 愛心 + 2 拼圖解鎖 ─────────────────────

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

  if exists (select 1 from public.daily_bonus_claims where user_id = v_user and app_day_key = v_day) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed', 'app_day_key', v_day);
  end if;

  insert into public.daily_bonus_claims (user_id, app_day_key) values (v_user, v_day);

  if v_subscribed then
    v_bal := public._credit_balance(v_user, 'heart');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_user, 'purchase', 'heart', 2, v_bal + 2, '會員每日登入：愛心 x2');

    return jsonb_build_object(
      'ok', true,
      'tier', 'member',
      'hearts', 2,
      'blur_unlock', 0,
      'app_day_key', v_day
    );
  end if;

  v_bal := public._credit_balance(v_user, 'heart');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'heart', 1, v_bal + 1, '免費會員每日登入：愛心 x1');

  v_blur := public._credit_balance(v_user, 'blur_unlock');
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_user, 'purchase', 'blur_unlock', 2, v_blur + 2, '免費會員每日登入：拼圖解鎖 x2');

  return jsonb_build_object(
    'ok', true,
    'tier', 'free',
    'hearts', 1,
    'blur_unlock', 2,
    'app_day_key', v_day
  );
end;
$$;

grant execute on function public.claim_daily_member_hearts() to authenticated;

-- ─── instant_session_decide：男性 friend 扣愛心（終身前 2 次免費）────────────────

create or replace function public.instant_session_decide(p_session_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sess public.instant_sessions;
  v_chat_end timestamptz;
  ua uuid;
  ub uuid;
  v_match uuid;
  v_prev_msg int := 0;
  v_my_decision text;
  v_gender text;
  v_free_used smallint;
  v_heart int;
  v_used_free boolean := false;
  v_heart_spent boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_choice not in ('friend', 'pass') then
    raise exception 'invalid choice';
  end if;

  select * into v_sess from public.instant_sessions where id = p_session_id limit 1;
  if not found then raise exception 'session not found'; end if;

  if v_sess.user_a <> v_uid and v_sess.user_b <> v_uid then
    raise exception 'forbidden';
  end if;

  if v_sess.aborted_at is not null then
    raise exception 'session ended';
  end if;

  v_chat_end := v_sess.created_at + interval '7 minutes';
  if now() < v_chat_end then
    raise exception 'decisions open after chat window ends';
  end if;

  if now() > v_chat_end + interval '2 minutes' then
    raise exception 'decision window closed';
  end if;

  if v_sess.promoted_match_id is not null then
    return jsonb_build_object('final', true, 'match_id', v_sess.promoted_match_id);
  end if;

  if v_uid = v_sess.user_a then
    v_my_decision := v_sess.decision_a;
  else
    v_my_decision := v_sess.decision_b;
  end if;

  if v_my_decision <> 'pending' then
    raise exception 'already decided';
  end if;

  if p_choice = 'friend' then
    select gender, instant_friend_free_uses_consumed
    into v_gender, v_free_used
    from public.profiles
    where id = v_uid;

    if v_gender = 'male' then
      if coalesce(v_free_used, 0) < 2 then
        update public.profiles
        set
          instant_friend_free_uses_consumed = coalesce(instant_friend_free_uses_consumed, 0) + 1,
          updated_at = now()
        where id = v_uid;
        v_used_free := true;
      else
        v_heart := public._credit_balance(v_uid, 'heart');
        if v_heart < 1 then
          raise exception '愛心不足，無法加為好友。';
        end if;
        insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
        values (v_uid, 'spend', 'heart', -1, v_heart - 1, '即時配對：加為好友');
        v_heart_spent := true;
      end if;
    end if;
  end if;

  if v_uid = v_sess.user_a then
    update public.instant_sessions set decision_a = p_choice where id = p_session_id;
  else
    update public.instant_sessions set decision_b = p_choice where id = p_session_id;
  end if;

  select * into v_sess from public.instant_sessions where id = p_session_id limit 1;

  if v_sess.decision_a <> 'friend' or v_sess.decision_b <> 'friend' then
    if v_sess.decision_a <> 'pending' and v_sess.decision_b <> 'pending' then
      update public.instant_match_queue set session_id = null
      where user_id in (v_sess.user_a, v_sess.user_b);
    end if;
    return jsonb_build_object(
      'final', v_sess.decision_a <> 'pending' and v_sess.decision_b <> 'pending',
      'mutual_friend', false,
      'used_free_instant_friend', v_used_free,
      'heart_spent', v_heart_spent
    );
  end if;

  ua := v_sess.user_a;
  ub := v_sess.user_b;

  insert into public.matches (user_a, user_b)
  values (ua, ub)
  on conflict (user_a, user_b) do nothing;

  select id into v_match from public.matches where user_a = ua and user_b = ub limit 1;

  select count(*) into v_prev_msg from public.messages where match_id = v_match;
  if v_prev_msg = 0 then
    insert into public.messages (match_id, sender_id, body, created_at)
    select v_match, m.sender_id, m.body, m.created_at
    from public.instant_session_messages m
    where m.session_id = p_session_id
    order by m.created_at asc;
  end if;

  update public.matches
  set
    instant_carry_session_id = p_session_id,
    instant_carry_matched_at = v_sess.created_at
  where id = v_match;

  update public.instant_sessions
    set promoted_match_id = v_match
  where id = p_session_id;

  update public.instant_match_queue set session_id = null
  where user_id in (ua, ub);

  insert into public.app_notifications (user_id, kind, title, body)
  values
    (ua, 'match_created', '即時配對成功', '你們在七分鐘聊天後互相加為好友，已開通一般聊天。'),
    (ub, 'match_created', '即時配對成功', '你們在七分鐘聊天後互相加為好友，已開通一般聊天。');

  return jsonb_build_object(
    'final', true,
    'mutual_friend', true,
    'match_id', v_match,
    'used_free_instant_friend', v_used_free,
    'heart_spent', v_heart_spent
  );
end;
$$;

grant execute on function public.instant_session_decide(uuid, text) to authenticated;

notify pgrst, 'reload schema';
