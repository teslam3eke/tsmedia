-- ============================================================
-- 063：enqueue:true 時首段選場不得再鎖「已升格正式配對」的舊 instant_sessions
--
-- 062 修了佇列入列；但若首段 SELECT 仍以 promoted_match_id IS NOT NULL 命中最新列，
-- 會在 enqueue 之前就 return status=done(mutual_friend)。前端若對該 session_id 曾按「我知道了」
-- 會把同一筆 done 濾成 idle（applyDismissedSessionFilter），結果：Network 一直是 done，
-- 畫面卻卡在「開始配對」——也永遠走不到後段 enqueue／waiting。
--
-- 語意與 061 類似：**表達要排隊 (p_enqueue=true)** 時，把「已升格、僅餘紀念」場次視為歷史略過，
-- 讓使用者能再加即時等候；enqueue=false（純輪詢結束頁）仍可要撈 promoted done。
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
    and not (p_enqueue and s.promoted_match_id is not null)
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
      set queued_at = excluded.queued_at,
          session_id = excluded.session_id;
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
