-- Relax chat send rate limit (was 8/min; aligns with MainScreen client guard).
create or replace function public.send_match_message(
  p_match_id uuid,
  p_body text
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_match public.matches%rowtype;
  v_message public.messages%rowtype;
  v_receiver uuid;
  v_recent_count int;
begin
  if v_sender is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Message body is required';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
    and (user_a = v_sender or user_b = v_sender);

  if not found then
    raise exception 'Match not found';
  end if;

  v_receiver := case when v_match.user_a = v_sender then v_match.user_b else v_match.user_a end;

  if exists (
    select 1 from public.profile_blocks b
    where (b.blocker_user_id = v_sender and b.blocked_user_id = v_receiver)
       or (b.blocker_user_id = v_receiver and b.blocked_user_id = v_sender)
  ) then
    raise exception 'Messaging blocked';
  end if;

  select count(*) into v_recent_count
  from public.messages
  where sender_id = v_sender
    and created_at > now() - interval '1 minute';

  if v_recent_count >= 20 then
    raise exception 'Message rate limit exceeded';
  end if;

  insert into public.messages (match_id, sender_id, body)
  values (p_match_id, v_sender, trim(p_body))
  returning * into v_message;

  perform public.sync_photo_unlock_state(p_match_id);

  insert into public.app_notifications (user_id, kind, title, body)
  values (
    v_receiver,
    'message_received',
    '你收到一則新訊息',
    '配對對象傳了新訊息給你。'
  );

  return v_message;
end;
$$;

grant execute on function public.send_match_message(uuid, text) to authenticated;
