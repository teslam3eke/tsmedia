-- ============================================================
-- 125：聊天小助手 poll 回傳 revealed_at／created_at（時間軸插入用）
-- ============================================================

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
    'my_claimed', v_my_claimed,
    'created_at', v_sess.created_at,
    'revealed_at', v_sess.revealed_at
  );
end;
$$;

notify pgrst, 'reload schema';
