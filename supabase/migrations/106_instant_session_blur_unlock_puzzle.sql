-- ============================================================
-- 106：即時七分鐘房可用道具解鎖拼圖；升格配對時接續已解鎖格
-- ============================================================

alter table public.instant_sessions
  add column if not exists puzzle_manual_unlocked_tiles int[] not null default '{}'::int[];

comment on column public.instant_sessions.puzzle_manual_unlocked_tiles is
  '即時房道具解鎖的全域拼圖格（0–47）；雙方可見；升格 matches 時寫入 photo_unlock_states';

-- ─── 即時房消耗 blur_unlock ────────────────────────────────────────────────

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
  v_tiles int[] := array[]::int[];
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

  if now() > v_sess.created_at + interval '7 minutes' then
    raise exception '道具解鎖僅限七分鐘聊天進行中';
  end if;

  if coalesce(array_length(v_sess.puzzle_manual_unlocked_tiles, 1), 0) >= 48 then
    return jsonb_build_object(
      'unlocked_tiles', coalesce(v_sess.puzzle_manual_unlocked_tiles, '{}'::int[])
    );
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

  if p_tile = any(coalesce(v_sess.puzzle_manual_unlocked_tiles, '{}'::int[])) then
    raise exception 'Tile already unlocked';
  end if;

  if p_bonus_tile is not null then
    raise exception 'Bonus tile not allowed in instant session';
  end if;

  v_tiles := array[p_tile];

  v_merged := coalesce(
    (
      select array_agg(distinct tile order by tile)
      from unnest(coalesce(v_sess.puzzle_manual_unlocked_tiles, '{}'::int[]) || v_tiles) as tile
    ),
    '{}'::int[]
  );

  update public.instant_sessions
  set puzzle_manual_unlocked_tiles = v_merged
  where id = p_session_id
  returning puzzle_manual_unlocked_tiles into v_merged;

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

grant execute on function public.spend_instant_session_blur_unlock_tile(uuid, int, int) to authenticated;

-- ─── instant_session_decide：升格時接續道具解鎖格 ───────────────────────────

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

  insert into public.photo_unlock_states (match_id, unlocked_tiles, total_tiles, updated_at)
  values (
    v_match,
    coalesce(v_sess.puzzle_manual_unlocked_tiles, '{}'::int[]),
    48,
    now()
  )
  on conflict (match_id) do update set
    unlocked_tiles = coalesce(
      (
        select array_agg(distinct tile order by tile)
        from unnest(
          coalesce(public.photo_unlock_states.unlocked_tiles, '{}'::int[]) ||
          coalesce(excluded.unlocked_tiles, '{}'::int[])
        ) as tile
      ),
      '{}'::int[]
    ),
    updated_at = now();

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
