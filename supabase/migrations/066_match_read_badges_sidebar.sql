-- 066：未讀 = 對方傳入且 read_at 仍為 NULL；進入聊天室標記已讀。
-- 配對列表摘要改由 match_threads_sidebar_state 一次取得（preview + unread）。

create or replace function public.mark_match_incoming_messages_read(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.messages m
  set read_at = coalesce(m.read_at, now())
  where m.match_id = p_match_id
    and m.sender_id is distinct from auth.uid()
    and m.read_at is null
    and exists (
      select 1 from public.matches x
      where x.id = p_match_id
        and (x.user_a = auth.uid() or x.user_b = auth.uid())
    );
end;
$$;

grant execute on function public.mark_match_incoming_messages_read(uuid) to authenticated;

create or replace function public.match_thread_unread_counts(p_match_ids uuid[])
returns table(match_id uuid, unread integer)
language sql
stable
security invoker
set search_path = public
as $$
  select p.match_id,
    (
      select count(*)::int
      from public.messages msg
      where msg.match_id = p.match_id
        and msg.sender_id <> auth.uid()
        and msg.read_at is null
    ) as unread
  from (
    select distinct m.id as match_id
    from public.matches m
    where m.id = any(p_match_ids)
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
  ) p;
$$;

grant execute on function public.match_thread_unread_counts(uuid[]) to authenticated;

create or replace function public.match_threads_sidebar_state(p_match_ids uuid[])
returns table(
  match_id uuid,
  unread integer,
  last_body text,
  last_created_at timestamptz,
  last_sender_is_peer boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.match_id,
    (
      select count(*)::int
      from public.messages msg
      where msg.match_id = p.match_id
        and msg.sender_id <> auth.uid()
        and msg.read_at is null
    ) as unread,
    lm.body as last_body,
    lm.created_at as last_created_at,
    case when lm.sender_id is null then false else lm.sender_id <> auth.uid() end as last_sender_is_peer
  from (
    select distinct m.id as match_id
    from public.matches m
    where m.id = any(p_match_ids)
      and (m.user_a = auth.uid() or m.user_b = auth.uid())
  ) p
  left join lateral (
    select msg.body, msg.created_at, msg.sender_id
    from public.messages msg
    where msg.match_id = p.match_id
    order by msg.created_at desc, msg.id desc
    limit 1
  ) lm on true;
$$;

grant execute on function public.match_threads_sidebar_state(uuid[]) to authenticated;

notify pgrst, 'reload schema';
