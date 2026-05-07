-- 推播／站內 deep link：訊息通知可帶入 match_id，點通知直達該聊天室。
alter table public.app_notifications
  add column if not exists ref_match_id uuid references public.matches (id) on delete set null;

create index if not exists app_notifications_ref_match_id_idx
  on public.app_notifications (ref_match_id)
  where ref_match_id is not null;

comment on column public.app_notifications.ref_match_id is '可選：訊息類通知對應的 matches.id，供推播 URL 開啟該對話';

-- 與 014 一致，僅 app_notifications insert 補上 ref_match_id
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

  insert into public.app_notifications (user_id, kind, title, body, ref_match_id)
  values (
    v_receiver,
    'message_received',
    '你收到一則新訊息',
    '配對對象傳了新訊息給你。',
    p_match_id
  );

  return v_message;
end;
$$;

grant execute on function public.send_match_message(uuid, text) to authenticated;

notify pgrst, 'reload schema';
