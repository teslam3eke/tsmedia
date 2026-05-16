-- ============================================================
-- 061：「開始配對」enqueue:true 不得再卡住舊終結場次（decision_closed）
--
-- 059 第一段 SELECT 會用「雙方已決策且非 friend/friend」把已結束房間納入 candidate，
-- 使 poll 在未走佇列前先回 status=done(decision_closed)。前端若曾按「我知道了」
-- （dismissed session），過濾成 idle ⇒ 使用者按開始配對只閃一下就回到 idle／按鈕。
-- 語意修正：enqueue=true（表達要排隊）時，視該種場次為歷史，改走後段佇列；
-- enqueue=false（僅輪詢 UI）仍可撈到終結結果供結束頁顯示。
-- ============================================================

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
      or (
        not p_enqueue
        and now() > s.created_at + interval '7 minutes'
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

    v_chat_end := v_sess.created_at + interval '7 minutes';

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
          now() <= s.created_at + interval '7 minutes'
          or (
            now() > s.created_at + interval '7 minutes'
            and (s.decision_a = 'pending' or s.decision_b = 'pending')
          )
        )
    );

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

  if
    p_enqueue
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
    v_chat_end := v_sess.created_at + interval '7 minutes';

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

grant execute on function public.instant_match_poll(boolean) to authenticated;

notify pgrst, 'reload schema';
