-- ============================================================
-- 123：配對聊天輔助問答（各填各的；雙方交卷後公開；+3 拼圖格／人／match／app 日）
-- ============================================================

create table if not exists public.match_chat_assist_sessions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  app_day_key text not null,
  prompt_id text not null,
  status text not null default 'open'
    check (status in ('open', 'revealed')),
  created_at timestamptz not null default now(),
  revealed_at timestamptz,
  unique (match_id, app_day_key)
);

create index if not exists match_chat_assist_sessions_match_day_idx
  on public.match_chat_assist_sessions (match_id, app_day_key);

comment on table public.match_chat_assist_sessions is
  '配對聊天輔助問答場次；每 match 每 app 日最多一場';

create table if not exists public.match_chat_assist_answers (
  session_id uuid not null references public.match_chat_assist_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  answer_text text not null,
  submitted_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.match_chat_assist_claims (
  session_id uuid not null references public.match_chat_assist_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_tiles int[] not null default '{}'::int[],
  claimed_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table public.match_chat_assist_sessions enable row level security;
alter table public.match_chat_assist_answers enable row level security;
alter table public.match_chat_assist_claims enable row level security;

-- 僅 RPC（security definer）讀寫；RLS 預設拒絕 direct REST

create or replace function public._match_chat_assist_assert_participant(p_match_id uuid)
returns table (
  user_id uuid,
  peer_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id;

  if not found then
    raise exception 'Match not found';
  end if;

  if v_user not in (v_match.user_a, v_match.user_b) then
    raise exception 'Not a match participant';
  end if;

  user_id := v_user;
  peer_id := case when v_user = v_match.user_a then v_match.user_b else v_match.user_a end;
  return next;
end;
$$;

-- 對方是否在同一 match 聊天室且 visible（45s 內心跳）
create or replace function public.match_chat_peer_visible_in_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_peer uuid;
  v_found boolean := false;
begin
  select p.peer_id into v_peer
  from public._match_chat_assist_assert_participant(p_match_id) p;

  select exists (
    select 1
    from public.user_chat_presence ucp
    where ucp.user_id = v_peer
      and ucp.active_match_id = p_match_id
      and ucp.visibility = 'visible'
      and ucp.updated_at >= now() - interval '45 seconds'
  ) into v_found;

  return jsonb_build_object('ok', true, 'peer_in_chat', coalesce(v_found, false));
end;
$$;

grant execute on function public.match_chat_peer_visible_in_match(uuid) to authenticated;

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
  v_sess public.match_chat_assist_sessions%rowtype;
  v_my_answer text;
  v_peer_answer text;
  v_my_submitted boolean := false;
  v_peer_submitted boolean := false;
  v_my_claimed boolean := false;
begin
  select p.user_id, p.peer_id into v_user, v_peer
  from public._match_chat_assist_assert_participant(p_match_id) p;

  if p_session_id is not null then
    select * into v_sess
    from public.match_chat_assist_sessions
    where id = p_session_id
      and match_id = p_match_id;
  else
    select * into v_sess
    from public.match_chat_assist_sessions
    where match_id = p_match_id
      and app_day_key = v_day
    order by created_at desc
    limit 1;
  end if;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'has_session_today', false,
      'session', null
    );
  end if;

  select a.answer_text into v_my_answer
  from public.match_chat_assist_answers a
  where a.session_id = v_sess.id and a.user_id = v_user;
  v_my_submitted := v_my_answer is not null;

  select exists (
    select 1 from public.match_chat_assist_answers a
    where a.session_id = v_sess.id and a.user_id = v_peer
  ) into v_peer_submitted;

  if v_sess.status = 'revealed' then
    select a.answer_text into v_peer_answer
    from public.match_chat_assist_answers a
    where a.session_id = v_sess.id and a.user_id = v_peer;
  end if;

  select exists (
    select 1 from public.match_chat_assist_claims c
    where c.session_id = v_sess.id and c.user_id = v_user
  ) into v_my_claimed;

  return jsonb_build_object(
    'ok', true,
    'has_session_today', true,
    'session', jsonb_build_object(
      'id', v_sess.id,
      'prompt_id', v_sess.prompt_id,
      'status', v_sess.status,
      'my_submitted', v_my_submitted,
      'peer_submitted', v_peer_submitted,
      'my_answer', v_my_answer,
      'peer_answer', v_peer_answer,
      'my_claimed', v_my_claimed
    )
  );
end;
$$;

create or replace function public.match_chat_assist_poll(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._match_chat_assist_build_poll(p_match_id, null);
end;
$$;

grant execute on function public.match_chat_assist_poll(uuid) to authenticated;

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
  v_day text := public.app_day_key_now();
  v_prompt text := nullif(trim(p_prompt_id), '');
  v_sess_id uuid;
begin
  select p.user_id into v_user
  from public._match_chat_assist_assert_participant(p_match_id) p;

  if v_prompt is null then
    raise exception 'prompt_id required';
  end if;

  if exists (
    select 1 from public.match_chat_assist_sessions s
    where s.match_id = p_match_id and s.app_day_key = v_day
  ) then
    return public._match_chat_assist_build_poll(p_match_id, null);
  end if;

  insert into public.match_chat_assist_sessions (match_id, app_day_key, prompt_id)
  values (p_match_id, v_day, v_prompt)
  on conflict (match_id, app_day_key) do nothing
  returning id into v_sess_id;

  if v_sess_id is null then
    select s.id into v_sess_id
    from public.match_chat_assist_sessions s
    where s.match_id = p_match_id and s.app_day_key = v_day;
  end if;

  return public._match_chat_assist_build_poll(p_match_id, v_sess_id);
end;
$$;

grant execute on function public.match_chat_assist_try_start(uuid, text) to authenticated;

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
    and app_day_key = v_day;

  if not found then
    raise exception 'No assist session today';
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

grant execute on function public.match_chat_assist_submit(uuid, text) to authenticated;

create or replace function public.grant_chat_assist_puzzle_tiles(
  p_match_id uuid,
  p_session_id uuid,
  p_tiles int[]
)
returns public.photo_unlock_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_sess public.match_chat_assist_sessions%rowtype;
  v_prev int[] := '{}'::int[];
  v_merged int[] := '{}'::int[];
  v_tile int;
  v_now timestamptz := now();
  v_distinct int[];
begin
  select p.user_id into v_user
  from public._match_chat_assist_assert_participant(p_match_id) p;

  select * into v_sess
  from public.match_chat_assist_sessions
  where id = p_session_id
    and match_id = p_match_id;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_sess.status <> 'revealed' then
    raise exception 'Session not revealed yet';
  end if;

  if not exists (
    select 1 from public.match_chat_assist_answers a
    where a.session_id = p_session_id and a.user_id = v_user
  ) then
    raise exception 'Submit answer before claim';
  end if;

  if exists (
    select 1 from public.match_chat_assist_claims c
    where c.session_id = p_session_id and c.user_id = v_user
  ) then
    raise exception 'Already claimed';
  end if;

  if p_tiles is null or coalesce(array_length(p_tiles, 1), 0) = 0 then
    raise exception 'Tiles required';
  end if;

  if coalesce(array_length(p_tiles, 1), 0) > 3 then
    raise exception 'Too many tiles';
  end if;

  foreach v_tile in array p_tiles loop
    if v_tile < 0 or v_tile > 47 then
      raise exception 'Invalid tile';
    end if;
  end loop;

  select coalesce(array_agg(distinct t order by t), '{}'::int[]) into v_distinct
  from unnest(p_tiles) as t;

  if coalesce(array_length(v_distinct, 1), 0) <> coalesce(array_length(p_tiles, 1), 0) then
    raise exception 'Duplicate tiles';
  end if;

  select coalesce(unlocked_tiles, '{}'::int[]) into v_prev
  from public.match_puzzle_manual_unlocks
  where match_id = p_match_id and user_id = v_user;

  foreach v_tile in array v_distinct loop
    if v_tile = any(v_prev) then
      raise exception 'Tile already unlocked';
    end if;
  end loop;

  v_merged := coalesce(
    (
      select array_agg(distinct tile order by tile)
      from unnest(v_prev || v_distinct) as tile
    ),
    '{}'::int[]
  );

  insert into public.match_puzzle_manual_unlocks (match_id, user_id, unlocked_tiles, updated_at)
  values (p_match_id, v_user, v_merged, v_now)
  on conflict (match_id, user_id) do update
    set unlocked_tiles = excluded.unlocked_tiles,
        updated_at = excluded.updated_at;

  insert into public.match_chat_assist_claims (session_id, user_id, granted_tiles)
  values (p_session_id, v_user, v_distinct);

  return (
    p_match_id,
    48,
    v_merged,
    v_now,
    v_now
  )::public.photo_unlock_states;
end;
$$;

grant execute on function public.grant_chat_assist_puzzle_tiles(uuid, uuid, int[]) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.match_chat_assist_sessions;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
