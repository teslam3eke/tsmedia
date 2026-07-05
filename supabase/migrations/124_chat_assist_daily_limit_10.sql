-- ============================================================
-- 124：聊天小助手測試 — 每 match 每 app 日最多 10 場（123 為 1 場）
-- ============================================================

alter table public.match_chat_assist_sessions
  drop constraint if exists match_chat_assist_sessions_match_id_app_day_key_key;

create index if not exists match_chat_assist_sessions_match_day_created_idx
  on public.match_chat_assist_sessions (match_id, app_day_key, created_at desc);

comment on table public.match_chat_assist_sessions is
  '配對聊天輔助問答場次；每 match 每 app 日最多 10 場（測試用，正式可改回 1）';

create or replace function public.chat_assist_daily_limit()
returns int
language sql
immutable
as $$
  select 10
$$;

comment on function public.chat_assist_daily_limit() is
  '配對聊天小助手：每 match 每 app 日可觸發場次上限（測試 10；正式建議 1）';

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
begin
  select * into v_sess
  from public.match_chat_assist_sessions
  where id = p_session_id
    and match_id = p_match_id;

  if not found then
    return null;
  end if;

  select a.answer_text into v_my_answer
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
    'my_claimed', v_my_claimed
  );
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
  v_row record;
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

  v_can_start := (not v_has_open) and (v_count < v_limit);

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
  v_day text := public.app_day_key_now();
  v_prompt text := nullif(trim(p_prompt_id), '');
  v_limit int := public.chat_assist_daily_limit();
  v_count int := 0;
  v_sess_id uuid;
begin
  perform public._match_chat_assist_assert_participant(p_match_id);

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

  select count(*) into v_count
  from public.match_chat_assist_sessions s
  where s.match_id = p_match_id
    and s.app_day_key = v_day;

  if v_count >= v_limit then
    return public._match_chat_assist_build_poll(p_match_id, null);
  end if;

  insert into public.match_chat_assist_sessions (match_id, app_day_key, prompt_id)
  values (p_match_id, v_day, v_prompt)
  returning id into v_sess_id;

  return public._match_chat_assist_build_poll(p_match_id, v_sess_id);
end;
$$;

create or replace function public.match_chat_assist_submit(
  p_match_id uuid,
  p_answer_text text
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
  v_sess public.match_chat_assist_sessions%rowtype;
  v_answer text := nullif(trim(p_answer_text), '');
  v_peer_done boolean := false;
  v_my_done boolean := false;
begin
  select p.user_id, p.peer_id into v_user, v_peer
  from public._match_chat_assist_assert_participant(p_match_id) p;

  if v_answer is null then
    raise exception 'Answer required';
  end if;

  if char_length(v_answer) > 500 then
    raise exception 'Answer too long';
  end if;

  select * into v_sess
  from public.match_chat_assist_sessions
  where match_id = p_match_id
    and app_day_key = v_day
    and status = 'open'
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'No open assist session today';
  end if;

  insert into public.match_chat_assist_answers (session_id, user_id, answer_text)
  values (v_sess.id, v_user, v_answer)
  on conflict (session_id, user_id) do update
    set answer_text = excluded.answer_text,
        submitted_at = now();

  select exists (
    select 1 from public.match_chat_assist_answers a
    where a.session_id = v_sess.id and a.user_id = v_peer
  ) into v_peer_done;

  select exists (
    select 1 from public.match_chat_assist_answers a
    where a.session_id = v_sess.id and a.user_id = v_user
  ) into v_my_done;

  if v_my_done and v_peer_done and v_sess.status = 'open' then
    update public.match_chat_assist_sessions
    set status = 'revealed',
        revealed_at = now()
    where id = v_sess.id;
  end if;

  return public._match_chat_assist_build_poll(p_match_id, v_sess.id);
end;
$$;

notify pgrst, 'reload schema';
