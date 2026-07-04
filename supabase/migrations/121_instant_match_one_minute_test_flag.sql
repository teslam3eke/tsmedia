-- 121：測試用 — instant_match_one_minute_test=true 時即時聊天 1 分鐘（預設 7 分鐘）
-- 恢復：update app_feature_flags set enabled = false where key = 'instant_match_one_minute_test';

insert into public.app_feature_flags (key, enabled)
values ('instant_match_one_minute_test', true)
on conflict (key) do update set enabled = excluded.enabled;

create or replace function public.instant_match_chat_duration_interval()
returns interval
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(
      (select f.enabled from public.app_feature_flags f where f.key = 'instant_match_one_minute_test'),
      false
    ) then interval '1 minute'
    else interval '7 minutes'
  end;
$$;

comment on function public.instant_match_chat_duration_interval() is
  '即時房聊天長度；instant_match_one_minute_test 旗標為 true 時 1 分鐘。';


create or replace function public.instant_match_poll(p_enqueue boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_sess public.instant_sessions%rowtype;
  v_peer uuid;
  v_chat_end timestamptz;
  v_phase text := 'waiting';
  v_have_session boolean;
  v_gender text;
  v_free_used smallint;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_sess
  from public.instant_sessions s
  where v_me in (s.user_a, s.user_b)
    and s.created_at > now() - interval '36 hours'
    and not (p_enqueue and s.promoted_match_id is not null)
    and (
      s.aborted_at is not null
      or s.promoted_match_id is not null
      or now() <= s.created_at + public.instant_match_chat_duration_interval()
      or (
        now() > s.created_at + public.instant_match_chat_duration_interval()
        and (s.decision_a = 'pending' or s.decision_b = 'pending')
      )
      or (
        not p_enqueue
        and now() > s.created_at + public.instant_match_chat_duration_interval()
        and s.decision_a <> 'pending'
        and s.decision_b <> 'pending'
        and not (s.decision_a = 'friend' and s.decision_b = 'friend')
        and s.aborted_at is null
        and s.promoted_match_id is null
      )
    )
  order by s.created_at desc
  limit 1;

  v_have_session := found;

  if v_have_session and v_sess.aborted_at is not null and p_enqueue then
    v_have_session := false;
  end if;

  if v_have_session then
    if v_sess.promoted_match_id is not null then
      return jsonb_build_object(
        'status', 'done',
        'session_id', v_sess.id,
        'promoted_match_id', v_sess.promoted_match_id,
        'mutual_friend', true
      );
    end if;

    if v_sess.aborted_at is not null then
      return jsonb_build_object(
        'status', 'done',
        'session_id', v_sess.id,
        'mutual_friend', false,
        'instant_end_reason',
          case when v_sess.abort_initiator = v_me then 'self_left' else 'peer_left' end
      );
    end if;

    v_chat_end := v_sess.created_at + public.instant_match_chat_duration_interval();

    if v_sess.aborted_at is null
      and v_sess.promoted_match_id is null
      and now() > v_chat_end + interval '2 minutes'
      and (v_sess.decision_a = 'pending' or v_sess.decision_b = 'pending') then
      update public.instant_sessions
        set decision_a = case when decision_a = 'pending' then 'pass' else decision_a end,
            decision_b = case when decision_b = 'pending' then 'pass' else decision_b end
      where id = v_sess.id;
      select * into v_sess from public.instant_sessions where id = v_sess.id;
    end if;

    v_peer := case when v_sess.user_a = v_me then v_sess.user_b else v_sess.user_a end;

    if now() <= v_chat_end then
      v_phase := 'chat';
    elsif v_sess.decision_a = 'pending' or v_sess.decision_b = 'pending' then
      v_phase := 'decide';
    else
      v_phase :=
        case
          when v_sess.decision_a = 'friend' and v_sess.decision_b = 'friend' then 'mutual_friend'
          else 'closed'
        end;
    end if;

    if v_phase = 'closed' then
      return jsonb_build_object(
        'status', 'done',
        'session_id', v_sess.id,
        'mutual_friend', false,
        'instant_end_reason', 'decision_closed'
      );
    end if;

    return jsonb_build_object(
      'status', 'in_session',
      'phase', v_phase,
      'session_id', v_sess.id,
      'peer_user_id', v_peer,
      'user_a', v_sess.user_a,
      'user_b', v_sess.user_b,
      'created_at', v_sess.created_at,
      'chat_ends_at', v_chat_end,
      'decision_a', v_sess.decision_a,
      'decision_b', v_sess.decision_b
    );
  end if;

  delete from public.instant_match_queue q
  where q.session_id is null
    and q.queued_at < now() - interval '15 minutes';

  update public.instant_match_queue q
  set session_id = null
  where q.session_id is not null
    and not exists (
      select 1 from public.instant_sessions s
      where s.id = q.session_id
        and s.aborted_at is null
        and s.promoted_match_id is null
        and (
          now() <= s.created_at + public.instant_match_chat_duration_interval()
          or (
            now() > s.created_at + public.instant_match_chat_duration_interval()
            and (s.decision_a = 'pending' or s.decision_b = 'pending')
          )
        )
    );

  if not p_enqueue then
    delete from public.instant_match_queue
    where user_id = v_me
      and session_id is null;
  end if;

  if p_enqueue and not public.instant_match_open_now() then
    delete from public.instant_match_queue
    where user_id = v_me
      and session_id is null;
    return jsonb_build_object(
      'status', 'idle',
      'hint', '即時配對僅在台灣時間每晚 22:00 至隔日 01:00 開放。',
      'instant_hours_closed', true
    );
  end if;

  if p_enqueue then
    select gender, instant_friend_free_uses_consumed
    into v_gender, v_free_used
    from public.profiles
    where id = v_me;

    if v_gender = 'male'
       and coalesce(v_free_used, 0) >= 2
       and public._credit_balance(v_me, 'heart') < 1 then
      delete from public.instant_match_queue
      where user_id = v_me
        and session_id is null;
      return jsonb_build_object(
        'status', 'idle',
        'instant_queue_blocked', true,
        'hint', '你的即時配對「加為好友」免費次數（2 次）已用完，且目前沒有愛心。若七分鐘後選擇加好友，需消耗 1 顆愛心。請先取得愛心後再開始配對。'
      );
    end if;

    insert into public.instant_match_queue (user_id, queued_at, session_id)
    values (v_me, now(), null)
    on conflict (user_id) do update
      set queued_at = excluded.queued_at,
          session_id = excluded.session_id;
  end if;

  delete from public.instant_match_queue q
  where q.session_id is null
    and q.queued_at < now() - interval '2 minutes';

  if
    p_enqueue
    and public.instant_match_open_now()
    and exists (
      select 1 from public.instant_match_queue q
      where q.user_id = v_me and q.session_id is null
    )
  then
    perform public._instant_try_pair_locked();
  end if;

  select * into v_sess
  from public.instant_sessions s
  inner join public.instant_match_queue q on q.session_id = s.id and q.user_id = v_me
  where s.aborted_at is null
    and s.promoted_match_id is null
  limit 1;

  if found then
    v_chat_end := v_sess.created_at + public.instant_match_chat_duration_interval();

    if v_sess.aborted_at is null
      and v_sess.promoted_match_id is null
      and now() > v_chat_end + interval '2 minutes'
      and (v_sess.decision_a = 'pending' or v_sess.decision_b = 'pending') then
      update public.instant_sessions
        set decision_a = case when decision_a = 'pending' then 'pass' else decision_a end,
            decision_b = case when decision_b = 'pending' then 'pass' else decision_b end
      where id = v_sess.id;
      select * into v_sess from public.instant_sessions where id = v_sess.id;
    end if;

    v_peer := case when v_sess.user_a = v_me then v_sess.user_b else v_sess.user_a end;
    if now() <= v_chat_end then
      v_phase := 'chat';
    elsif v_sess.decision_a = 'pending' or v_sess.decision_b = 'pending' then
      v_phase := 'decide';
    else
      v_phase :=
        case
          when v_sess.decision_a = 'friend' and v_sess.decision_b = 'friend' then 'mutual_friend'
          else 'closed'
        end;
    end if;

    if v_phase = 'closed' then
      return jsonb_build_object(
        'status', 'done',
        'session_id', v_sess.id,
        'mutual_friend', false,
        'instant_end_reason', 'decision_closed'
      );
    end if;

    return jsonb_build_object(
      'status', 'in_session',
      'phase', v_phase,
      'session_id', v_sess.id,
      'peer_user_id', v_peer,
      'user_a', v_sess.user_a,
      'user_b', v_sess.user_b,
      'created_at', v_sess.created_at,
      'chat_ends_at', v_chat_end,
      'decision_a', v_sess.decision_a,
      'decision_b', v_sess.decision_b
    );
  end if;

  if exists (
    select 1 from public.instant_match_queue q
    where q.user_id = v_me and q.session_id is null
  ) then
    return jsonb_build_object(
      'status', 'waiting',
      'hint', '佇列中，配對成功後會自動進入聊天室（請保持 App 開啟）。'
    );
  end if;

  return jsonb_build_object(
    'status', 'idle',
    'hint', '尚未加入等候。點「開始配對」加入；需同時有另一位使用者也在等候才會開房。'
  );
end;
$$;

create or replace function public.instant_session_send_message(
  p_session_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sess public.instant_sessions%rowtype;
  v_mid uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_sess
  from public.instant_sessions
  where id = p_session_id
    and (user_a = v_uid or user_b = v_uid)
  limit 1;

  if not found then
    raise exception 'session not found';
  end if;

  if v_sess.aborted_at is not null then
    raise exception 'chat ended';
  end if;

  if now() > v_sess.created_at + public.instant_match_chat_duration_interval() then
    raise exception 'chat window closed';
  end if;

  if v_sess.promoted_match_id is not null then
    raise exception 'session already finalized';
  end if;

  insert into public.instant_session_messages (session_id, sender_id, body)
  values (p_session_id, v_uid, trim(p_body))
  returning id into v_mid;

  return v_mid;
end;
$$;

create or replace function public.spend_instant_session_blur_unlock_tile(
  p_session_id uuid,
  p_tile int,
  p_bonus_tile int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sess public.instant_sessions;
  v_balance int := 0;
  v_prev int[] := '{}'::int[];
  v_merged int[] := '{}'::int[];
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_sess
  from public.instant_sessions
  where id = p_session_id
  limit 1;

  if not found then
    raise exception 'session not found';
  end if;

  if v_user not in (v_sess.user_a, v_sess.user_b) then
    raise exception 'forbidden';
  end if;

  if v_sess.aborted_at is not null then
    raise exception 'session ended';
  end if;

  if now() > v_sess.created_at + public.instant_match_chat_duration_interval() then
    raise exception '道具解鎖僅限七分鐘聊天進行中';
  end if;

  select coalesce(unlocked_tiles, '{}'::int[]) into v_prev
  from public.instant_session_puzzle_unlocks
  where session_id = p_session_id
    and user_id = v_user;

  if not found then
    v_prev := '{}'::int[];
  end if;

  if coalesce(array_length(v_prev, 1), 0) >= 48 then
    return jsonb_build_object('unlocked_tiles', v_prev);
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.credit_transactions
  where user_id = v_user
    and credit_type = 'blur_unlock';

  if v_balance <= 0 then
    raise exception 'Insufficient blur unlock credits';
  end if;

  if p_tile is null then
    raise exception 'Tile required';
  end if;

  if p_tile < 0 or p_tile > 47 then
    raise exception 'Invalid tile';
  end if;

  if p_tile = any(v_prev) then
    raise exception 'Tile already unlocked';
  end if;

  if p_bonus_tile is not null then
    raise exception 'Bonus tile not allowed in instant session';
  end if;

  v_merged := coalesce(
    (
      select array_agg(distinct tile order by tile)
      from unnest(v_prev || array[p_tile]) as tile
    ),
    '{}'::int[]
  );

  insert into public.instant_session_puzzle_unlocks (session_id, user_id, unlocked_tiles, updated_at)
  values (p_session_id, v_user, v_merged, now())
  on conflict (session_id, user_id) do update
    set unlocked_tiles = excluded.unlocked_tiles,
        updated_at = now()
  returning unlocked_tiles into v_merged;

  insert into public.credit_transactions (
    user_id, kind, credit_type, amount, balance_after, description, related_ref
  )
  values (
    v_user,
    'spend',
    'blur_unlock',
    -1,
    v_balance - 1,
    '即時配對聊天照片拼圖解除模糊 1 格',
    p_session_id::text
  );

  return jsonb_build_object('unlocked_tiles', v_merged);
end;
$$;

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

  v_chat_end := v_sess.created_at + public.instant_match_chat_duration_interval();
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

  perform public.sync_photo_unlock_state(v_match);

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

notify pgrst, 'reload schema';
