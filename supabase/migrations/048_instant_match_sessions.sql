-- 即時隨機配對（類 Goodnight）：佇列、7 分鐘房、雙向加好友才寫入 matches
-- NOTIFY 供 PostgREST schema reload（若有快取問題）

create table if not exists public.instant_sessions (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  decision_a text not null default 'pending' check (decision_a in ('pending', 'friend', 'pass')),
  decision_b text not null default 'pending' check (decision_b in ('pending', 'friend', 'pass')),
  promoted_match_id uuid references public.matches (id) on delete set null,
  constraint instant_sessions_ordered check (user_a < user_b)
);

create table if not exists public.instant_match_queue (
  user_id uuid primary key references auth.users (id) on delete cascade,
  queued_at timestamptz not null default now(),
  session_id uuid references public.instant_sessions (id) on delete set null
);

create table if not exists public.instant_session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.instant_sessions (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists instant_match_queue_waiting_idx
  on public.instant_match_queue (queued_at asc)
  where session_id is null;

create index if not exists instant_session_messages_session_created_idx
  on public.instant_session_messages (session_id, created_at asc);

alter table public.instant_sessions enable row level security;
alter table public.instant_match_queue enable row level security;
alter table public.instant_session_messages enable row level security;

drop policy if exists "instant_sessions: participant select" on public.instant_sessions;
create policy "instant_sessions: participant select"
  on public.instant_sessions for select
  using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "instant_queue: own rows" on public.instant_match_queue;
create policy "instant_queue: own rows"
  on public.instant_match_queue for select
  using (auth.uid() = user_id);

drop policy if exists "instant_messages: session participant select" on public.instant_session_messages;
create policy "instant_messages: session participant select"
  on public.instant_session_messages for select
  using (
    exists (
      select 1 from public.instant_sessions s
      where s.id = instant_session_messages.session_id
        and (s.user_a = auth.uid() or s.user_b = auth.uid())
    )
  );

-- Realtime（若已在 publication 會略過）
do $$
begin
  alter publication supabase_realtime add table public.instant_sessions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.instant_session_messages;
exception when duplicate_object then null;
end $$;

--------------------------------------------------------------------------------
-- 內部：鎖住兩位等待者並開房（SECURITY DEFINER）
--------------------------------------------------------------------------------

create or replace function public._instant_try_pair_locked()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid1 uuid;
  uid2 uuid;
  new_id uuid;
begin
  select user_id into uid1
  from public.instant_match_queue
  where session_id is null
  order by queued_at asc
  for update skip locked
  limit 1;

  if uid1 is null then
    return null;
  end if;

  select user_id into uid2
  from public.instant_match_queue
  where session_id is null and user_id <> uid1
  order by queued_at asc
  for update skip locked
  limit 1;

  if uid2 is null then
    return null;
  end if;

  new_id := gen_random_uuid();

  insert into public.instant_sessions (id, user_a, user_b)
  values (new_id, least(uid1, uid2), greatest(uid1, uid2));

  update public.instant_match_queue
    set session_id = new_id
  where user_id in (uid1, uid2);

  return new_id;
end;
$$;

--------------------------------------------------------------------------------
-- 輪詢：入列、強制配對一對、回傳狀態
--------------------------------------------------------------------------------

create or replace function public.instant_match_poll()
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
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;

  -- 未完成流程的最新一房（聊天中、待雙方決策、或已升級配對）
  select * into v_sess
  from public.instant_sessions s
  where v_me in (s.user_a, s.user_b)
    and s.created_at > now() - interval '36 hours'
    and (
      s.promoted_match_id is not null
      or now() <= s.created_at + interval '7 minutes'
      or (
        now() > s.created_at + interval '7 minutes'
        and (s.decision_a = 'pending' or s.decision_b = 'pending')
      )
    )
  order by s.created_at desc
  limit 1;

  if found then
    if v_sess.promoted_match_id is not null then
      return jsonb_build_object(
        'status', 'done',
        'session_id', v_sess.id,
        'promoted_match_id', v_sess.promoted_match_id,
        'mutual_friend', true
      );
    end if;

    v_peer := case when v_sess.user_a = v_me then v_sess.user_b else v_sess.user_a end;
    v_chat_end := v_sess.created_at + interval '7 minutes';

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

    return jsonb_build_object(
      'status', 'in_session',
      'phase', v_phase,
      'session_id', v_sess.id,
      'peer_user_id', v_peer,
      'created_at', v_sess.created_at,
      'chat_ends_at', v_chat_end,
      'decision_a', v_sess.decision_a,
      'decision_b', v_sess.decision_b
    );
  end if;

  -- 過期等待列清理（僅未有 session）
  delete from public.instant_match_queue q
  where q.session_id is null
    and q.queued_at < now() - interval '15 minutes';

  update public.instant_match_queue q
  set session_id = null
  where q.user_id = v_me
    and q.session_id is not null
    and not exists (
      select 1 from public.instant_sessions s
      where s.id = q.session_id
        and (
          s.promoted_match_id is not null
          or now() <= s.created_at + interval '7 minutes'
          or (
            now() > s.created_at + interval '7 minutes'
            and (s.decision_a = 'pending' or s.decision_b = 'pending')
          )
        )
    );

  insert into public.instant_match_queue (user_id, queued_at, session_id)
  values (v_me, now(), null)
  on conflict (user_id) do nothing;

  perform public._instant_try_pair_locked();

  -- 再看是否剛排到房
  select * into v_sess
  from public.instant_sessions s
  inner join public.instant_match_queue q on q.session_id = s.id and q.user_id = v_me
  limit 1;

  if found then
    v_peer := case when v_sess.user_a = v_me then v_sess.user_b else v_sess.user_a end;
    v_chat_end := v_sess.created_at + interval '7 minutes';
    return jsonb_build_object(
      'status', 'in_session',
      'phase', 'chat',
      'session_id', v_sess.id,
      'peer_user_id', v_peer,
      'created_at', v_sess.created_at,
      'chat_ends_at', v_chat_end,
      'decision_a', v_sess.decision_a,
      'decision_b', v_sess.decision_b
    );
  end if;

  return jsonb_build_object(
    'status', 'waiting',
    'hint', '佇列中，配對成功後會自動進入聊天室（請保持 App 開啟）。'
  );
end;
$$;

grant execute on function public.instant_match_poll() to authenticated;

--------------------------------------------------------------------------------

create or replace function public.instant_match_leave_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.instant_match_queue
  where user_id = v_me and session_id is null;
end;
$$;

grant execute on function public.instant_match_leave_queue() to authenticated;

--------------------------------------------------------------------------------

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

  if now() > v_sess.created_at + interval '7 minutes' then
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

grant execute on function public.instant_session_send_message(uuid, text) to authenticated;

--------------------------------------------------------------------------------

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

  v_chat_end := v_sess.created_at + interval '7 minutes';
  if now() < v_chat_end then
    raise exception 'decisions open after chat window ends';
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

  update public.instant_sessions
    set promoted_match_id = v_match
  where id = p_session_id;

  update public.instant_match_queue set session_id = null
  where user_id in (ua, ub);

  insert into public.app_notifications (user_id, kind, title, body)
  values
    (ua, 'match_created', '即時配對成功', '你們在七分鐘聊天後互相加為好友，已開通一般聊天。'),
    (ub, 'match_created', '即時配對成功', '你們在七分鐘聊天後互相加為好友，已開通一般聊天。');

  return jsonb_build_object('final', true, 'mutual_friend', true, 'match_id', v_match);
end;
$$;

grant execute on function public.instant_session_decide(uuid, text) to authenticated;

notify pgrst, 'reload schema';
