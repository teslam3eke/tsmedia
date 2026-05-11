-- 053：修正 052「每次 poll 都刷新 queued_at」導致只開即時分頁但未按「開始配對」的幽靈佇列列被救活，
--      並與他人撮合。僅在 p_enqueue=true（表達排隊意圖）時刷新時間戳；p_enqueue=false
--      表示瀏覽／查狀態，應刪除本人 session_id is null 的佇列列（與客戶端等候中改送 true 併用）。

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
    and queued_at >= now() - interval '2 minutes'
  order by queued_at asc
  for update skip locked
  limit 1;

  if uid1 is null then
    return null;
  end if;

  select user_id into uid2
  from public.instant_match_queue
  where session_id is null
    and user_id <> uid1
    and queued_at >= now() - interval '2 minutes'
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

  -- 僅查狀態／閒置輪詢：移除本人在等候列的幽靈列（未表達 p_enqueue 意圖）。
  if not p_enqueue then
    delete from public.instant_match_queue
    where user_id = v_me
      and session_id is null;
  end if;

  if p_enqueue then
    insert into public.instant_match_queue (user_id, queued_at, session_id)
    values (v_me, now(), null)
    on conflict (user_id) do update
      set queued_at = excluded.queued_at
      where instant_match_queue.session_id is null;
  end if;

  delete from public.instant_match_queue q
  where q.session_id is null
    and q.queued_at < now() - interval '2 minutes';

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

notify pgrst, 'reload schema';
