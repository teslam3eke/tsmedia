-- Per-match unread count for tab badge: peer messages after viewer's last outbound message.
-- Aligns with MainScreen ChatMessage unread (reply clears), without hydrating full threads.

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
        and msg.created_at > coalesce(
          (
            select max(m2.created_at)
            from public.messages m2
            where m2.match_id = p.match_id
              and m2.sender_id = auth.uid()
          ),
          '-infinity'::timestamptz
        )
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
