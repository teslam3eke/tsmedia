-- ============================================================
-- 126：聊天小助手 — 每 match 每 app 日 3 場；上一場「答案公布」後至少 1 小時
-- ============================================================

comment on table public.match_chat_assist_sessions is
  '配對聊天輔助問答場次；每 match 每 app 日最多 3 場；答案公布後 1 小時內不可再開';

create or replace function public.chat_assist_daily_limit()
returns int
language sql
immutable
as $$
  select 3
$$;

comment on function public.chat_assist_daily_limit() is
  '配對聊天小助手：每 match 每 app 日可觸發場次上限（3）';

create or replace function public.chat_assist_min_interval()
returns interval
language sql
immutable
as $$
  select interval '1 hour'
$$;

comment on function public.chat_assist_min_interval() is
  '配對聊天小助手：上一場答案公布後，須間隔至少 1 小時才可再開新場';

create or replace function public._match_chat_assist_session_json(
  p_match_id uuid,
  p_session_id uuid,
  p_user uuid,
  p_peer uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.match_chat_assist_sessions%rowtype;
  v_my_answer text;
  v_peer_answer text;
  v_my_submitted boolean := false;
  v_peer_submitted boolean := false;
  v_my_claimed boolean := false;
  v_my_submitted_at timestamptz;
begin
  select * into v_sess
  from public.match_chat_assist_sessions
  where id = p_session_id
    and match_id = p_match_id;

  if not found then
    return null;
  end if;

  select a.answer_text, a.submitted_at
    into v_my_answer, v_my_submitted_at
  from public.match_chat_assist_answers a
  where a.session_id = v_sess.id and a.user_id = p_user;
  v_my_submitted := v_my_answer is not null;

  select exists (
    select 1 from public.match_chat_assist_answers a
    where a.session_id = v_sess.id and a.user_id = p_peer
  ) into v_peer_submitted;

  if v_sess.status = 'revealed' then
    select a.answer_text into v_peer_answer
    from public.match_chat_assist_answers a
    where a.session_id = v_sess.id and a.user_id = p_peer;
  end if;

  select exists (
    select 1 from public.match_chat_assist_claims c
    where c.session_id = v_sess.id and c.user_id = p_user
  ) into v_my_claimed;

  return jsonb_build_object(
    'id', v_sess.id,
    'prompt_id', v_sess.prompt_id,
    'status', v_sess.status,
    'my_submitted', v_my_submitted,
    'peer_submitted', v_peer_submitted,
    'my_answer', v_my_answer,
    'peer_answer', v_peer_answer,
    'my_claimed', v_my_claimed,
    'created_at', v_sess.created_at,
    'revealed_at', v_sess.revealed_at,
    'my_submitted_at', v_my_submitted_at
  );
end;
$$;

create or replace function public._match_chat_assist_user_can_start_new(
  p_match_id uuid,
  p_user uuid,
  p_day text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := public.chat_assist_daily_limit();
  v_count int := 0;
  v_has_open boolean := false;
  v_last_revealed timestamptz;
begin
  select count(*) into v_count
  from public.match_chat_assist_sessions s
  where s.match_id = p_match_id
    and s.app_day_key = p_day;

  select exists (
    select 1 from public.match_chat_assist_sessions s
    where s.match_id = p_match_id
      and s.app_day_key = p_day
      and s.status = 'open'
  ) into v_has_open;

  if v_has_open or v_count >= v_limit then
    return false;
  end if;

  select max(s.revealed_at) into v_last_revealed
  from public.match_chat_assist_sessions s
  join public.match_chat_assist_answers a
    on a.session_id = s.id and a.user_id = p_user
  where s.match_id = p_match_id
    and s.app_day_key = p_day
    and s.status = 'revealed'
    and s.revealed_at is not null;

  if v_last_revealed is not null
     and now() < v_last_revealed + public.chat_assist_min_interval() then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public._match_chat_assist_build_poll(p_match_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_peer uuid;
  v_day text := public.app_day_key_now();
  v_limit int := public.chat_assist_daily_limit();
  v_count int := 0;
  v_has_open boolean := false;
  v_can_start boolean := false;
  v_sess_id uuid;
  v_session jsonb;
  v_revealed jsonb := '[]'::jsonb;
begin
  select p.user_id, p.peer_id into v_user, v_peer
  from public._match_chat_assist_assert_participant(p_match_id) p;

  select count(*) into v_count
  from public.match_chat_assist_sessions s
  where s.match_id = p_match_id
    and s.app_day_key = v_day;

  select exists (
    select 1 from public.match_chat_assist_sessions s
    where s.match_id = p_match_id
      and s.app_day_key = v_day
      and s.status = 'open'
  ) into v_has_open;

  v_can_start := public._match_chat_assist_user_can_start_new(p_match_id, v_user, v_day);

  if p_session_id is not null then
    v_sess_id := p_session_id;
  else
    select s.id into v_sess_id
    from public.match_chat_assist_sessions s
    where s.match_id = p_match_id
      and s.app_day_key = v_day
      and s.status = 'open'
    order by s.created_at desc
    limit 1;

    if v_sess_id is null then
      select s.id into v_sess_id
      from public.match_chat_assist_sessions s
      where s.match_id = p_match_id
        and s.app_day_key = v_day
      order by s.created_at desc
      limit 1;
    end if;
  end if;

  if v_sess_id is not null then
    v_session := public._match_chat_assist_session_json(p_match_id, v_sess_id, v_user, v_peer);
  end if;

  select coalesce(jsonb_agg(x.item order by x.created_at), '[]'::jsonb) into v_revealed
  from (
    select
      s.created_at,
      public._match_chat_assist_session_json(p_match_id, s.id, v_user, v_peer) as item
    from public.match_chat_assist_sessions s
    where s.match_id = p_match_id
      and s.app_day_key = v_day
      and s.status = 'revealed'
    order by s.created_at asc
  ) x
  where x.item is not null;

  return jsonb_build_object(
    'ok', true,
    'has_session_today', v_count > 0,
    'sessions_today_count', v_count,
    'daily_limit', v_limit,
    'has_open_session', v_has_open,
    'can_start_new', v_can_start,
    'session', v_session,
    'revealed_sessions', v_revealed
  );
end;
$$;

create or replace function public.match_chat_assist_try_start(
  p_match_id uuid,
  p_prompt_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_peer uuid;
  v_day text := public.app_day_key_now();
  v_prompt text := nullif(trim(p_prompt_id), '');
  v_sess_id uuid;
begin
  select p.user_id, p.peer_id into v_user, v_peer
  from public._match_chat_assist_assert_participant(p_match_id) p;

  if v_prompt is null then
    raise exception 'prompt_id required';
  end if;

  if exists (
    select 1 from public.match_chat_assist_sessions s
    where s.match_id = p_match_id
      and s.app_day_key = v_day
      and s.status = 'open'
  ) then
    return public._match_chat_assist_build_poll(p_match_id, null);
  end if;

  if not public._match_chat_assist_user_can_start_new(p_match_id, v_user, v_day) then
    return public._match_chat_assist_build_poll(p_match_id, null);
  end if;

  insert into public.match_chat_assist_sessions (match_id, app_day_key, prompt_id)
  values (p_match_id, v_day, v_prompt)
  returning id into v_sess_id;

  return public._match_chat_assist_build_poll(p_match_id, v_sess_id);
end;
$$;

notify pgrst, 'reload schema';
