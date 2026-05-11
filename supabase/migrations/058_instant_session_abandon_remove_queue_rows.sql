-- 058：任一方 abandon 時刪除雙方 instant_match_queue 列（不再只清 session_id）。
-- 舊行為下 queued_at 仍可能在「2 分鐘內」，_instant_try_pair_locked 會把此人當成仍在排隊，
-- 導致：你卡在「對方已離開」尚未按「我知道了」，對方按「開始配對」仍可能把你撮進新房。

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

  delete from public.instant_match_queue
  where user_id in (v_sess.user_a, v_sess.user_b);
end;
$$;

grant execute on function public.instant_session_abandon(uuid) to authenticated;

notify pgrst, 'reload schema';
