-- 即時配對：一方離開（背景／關閉／離開頁面／手動）時終止房間，對方下次 poll／Realtime 可取得 peer_left。
-- VOLATILE：`instant_session_abandon` 具寫入；勿標 STABLE（PostgREST read-only txn 問題見專案規則）。

alter table public.instant_sessions
  add column if not exists aborted_at timestamptz,
  add column if not exists abort_initiator uuid references auth.users (id) on delete set null;

--------------------------------------------------------------------------------
-- 參與者主動放棄本場（仍保留列供雙方讀取結束理由；佇列列 session_id 清空）
--------------------------------------------------------------------------------

create or replace function public.instant_session_abandon(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_sess public.instant_sessions%rowtype;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_sess from public.instant_sessions where id = p_session_id limit 1 for update;
  if not found then
    raise exception 'session not found';
  end if;

  if v_me <> v_sess.user_a and v_me <> v_sess.user_b then
    raise exception 'forbidden';
  end if;

  if v_sess.promoted_match_id is not null then
    return;
  end if;

  if v_sess.aborted_at is not null then
    return;
  end if;

  update public.instant_sessions
  set aborted_at = now(), abort_initiator = v_me
  where id = p_session_id;

  update public.instant_match_queue
  set session_id = null
  where user_id in (v_sess.user_a, v_sess.user_b)
    and session_id = p_session_id;
end;
$$;

grant execute on function public.instant_session_abandon(uuid) to authenticated;

--------------------------------------------------------------------------------
-- poll：將「已 abort」场次納入主查詢，並回傳 instant_end_reason
--------------------------------------------------------------------------------

drop function if exists public.instant_match_poll(boolean);

create function public.instant_match_poll(p_enqueue boolean default true)
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

  select * into v_sess
  from public.instant_sessions s
  where v_me in (s.user_a, s.user_b)
    and s.created_at > now() - interval '36 hours'
    and (
      s.aborted_at is not null
      or s.promoted_match_id is not null
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

    if v_sess.aborted_at is not null then
      return jsonb_build_object(
        'status', 'done',
        'session_id', v_sess.id,
        'mutual_friend', false,
        'instant_end_reason',
          case when v_sess.abort_initiator = v_me then 'self_left' else 'peer_left' end
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
          s.aborted_at is not null
          or s.promoted_match_id is not null
          or now() <= s.created_at + interval '7 minutes'
          or (
            now() > s.created_at + interval '7 minutes'
            and (s.decision_a = 'pending' or s.decision_b = 'pending')
          )
        )
    );

  if p_enqueue then
    insert into public.instant_match_queue (user_id, queued_at, session_id)
    values (v_me, now(), null)
    on conflict (user_id) do nothing;
  end if;

  if exists (
    select 1 from public.instant_match_queue q
    where q.user_id = v_me and q.session_id is null
  ) then
    perform public._instant_try_pair_locked();
  end if;

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

grant execute on function public.instant_match_poll(boolean) to authenticated;

--------------------------------------------------------------------------------
-- send / decide：已終止场次禁止操作
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

  if v_sess.aborted_at is not null then
    raise exception 'chat ended';
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

  if v_sess.aborted_at is not null then
    raise exception 'session ended';
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

  return jsonb_build_object(
    'final', true,
    'mutual_friend', true,
    'match_id', v_match
  );
end;
$$;

grant execute on function public.instant_session_decide(uuid, text) to authenticated;

notify pgrst, 'reload schema';
