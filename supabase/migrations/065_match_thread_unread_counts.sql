-- Per-match unread via read_at (對方傳入且 read_at 為 NULL)。
-- 語意與「標已讀」完整版請併跑 066（mark_match_incoming_messages_read + match_threads_sidebar_state）。
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

notify pgrst, 'reload schema';
