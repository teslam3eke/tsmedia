-- ============================================================
-- 064：即時配對升格正式配對時，複製七分鐘聊天訊息至 matches.messages，
--       並標記 matches 以利「配對」聊天室沿用與即時房相同的拼圖 seed／matchedAt 推導；
--       sync_photo_unlock_state 對此等配對停用線性 0..n 合併（否則與 PuzzlePhotoUnlock 語意不一致、
--       並把僅來自聊天的格洗成別組索引）。
-- ============================================================

alter table public.matches
  add column if not exists instant_carry_session_id uuid references public.instant_sessions (id) on delete set null;

alter table public.matches
  add column if not exists instant_carry_matched_at timestamptz;

comment on column public.matches.instant_carry_session_id is
  '由即時七分鐘房升格為 matches 時，來源 instant_sessions.id；前端用於拼圖 seed 鍵 instant:{uuid}';

comment on column public.matches.instant_carry_matched_at is
  '即時場次 created_at（複製升格時寫入），供配對聊天拼圖 matchedAt 與即時房一致（含 30 分 boost 語意）';

create index if not exists matches_instant_carry_session_id_idx
  on public.matches (instant_carry_session_id)
  where instant_carry_session_id is not null;

-- ─── sync_photo_unlock_state：即時升格配對略過線性合併 ──────────────────────

create or replace function public.sync_photo_unlock_state(p_match_id uuid)
returns public.photo_unlock_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_count_a int := 0;
  v_count_b int := 0;
  v_target_unlocked int := 0;
  v_new_unlocked int[] := '{}'::int[];
  v_state public.photo_unlock_states%rowtype;
begin
  select * into v_match
  from public.matches
  where id = p_match_id;

  if not found then
    raise exception 'Match not found';
  end if;

  if auth.uid() is not null and auth.uid() not in (v_match.user_a, v_match.user_b) then
    raise exception 'Not a match participant';
  end if;

  if v_match.instant_carry_session_id is not null then
    insert into public.photo_unlock_states (match_id, unlocked_tiles, total_tiles, updated_at)
    values (p_match_id, '{}'::int[], 48, now())
    on conflict (match_id) do nothing;

    select * into v_state
    from public.photo_unlock_states
    where match_id = p_match_id;

    if not found then
      raise exception 'photo_unlock_states insert failed for instant carry match';
    end if;

    return v_state;
  end if;

  select count(*) into v_count_a
  from public.messages
  where match_id = p_match_id
    and sender_id = v_match.user_a;

  select count(*) into v_count_b
  from public.messages
  where match_id = p_match_id
    and sender_id = v_match.user_b;

  v_target_unlocked := least(48, floor(least(v_count_a, v_count_b) / 3)::int);

  if v_target_unlocked <= 0 then
    v_new_unlocked := '{}'::int[];
  else
    v_new_unlocked := array(select g from generate_series(0, v_target_unlocked - 1) as g);
  end if;

  insert into public.photo_unlock_states (match_id, unlocked_tiles, updated_at)
  values (p_match_id, v_new_unlocked, now())
  on conflict (match_id)
  do update set
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
    updated_at = now()
  returning * into v_state;

  return v_state;
end;
$$;

-- ─── instant_session_decide：複製訊息 + 標記 matches ──────────────────────

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
      'mutual_friend', false
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
    'match_id', v_match
  );
end;
$$;

grant execute on function public.instant_session_decide(uuid, text) to authenticated;

notify pgrst, 'reload schema';
