-- 071：即時撮合排除已有朋友、僅異性、排除封鎖（與探索 deck 語意對齊）。
-- abort 90 分鐘 fallback 仍保留，但不再繞過 gender／matches／blocks。

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

  /** 優先：跳過 90 分鐘內 abort 過的組合；仍須異性、非朋友、未封鎖 */
  select q2.user_id into uid2
  from public.instant_match_queue q2
  inner join public.profiles p1 on p1.id = uid1
  inner join public.profiles p2 on p2.id = q2.user_id
  where q2.session_id is null
    and q2.user_id <> uid1
    and q2.queued_at >= now() - interval '2 minutes'
    and p1.account_status = 'active'
    and p2.account_status = 'active'
    and p1.gender is not null
    and p2.gender is not null
    and p1.gender <> p2.gender
    and not exists (
      select 1 from public.matches m
      where m.user_a = least(uid1, q2.user_id)
        and m.user_b = greatest(uid1, q2.user_id)
    )
    and not exists (
      select 1 from public.profile_blocks b
      where (
        b.blocker_user_id = uid1
        and (
          b.blocked_user_id = q2.user_id
          or b.blocked_profile_key = q2.user_id::text
          or b.blocked_profile_key = ('user:' || q2.user_id::text)
        )
      )
      or (b.blocker_user_id = q2.user_id and b.blocked_user_id = uid1)
    )
    and not exists (
      select 1 from public.instant_sessions s
      where s.aborted_at is not null
        and s.aborted_at > now() - interval '90 minutes'
        and least(s.user_a, s.user_b) = least(uid1, q2.user_id)
        and greatest(s.user_a, s.user_b) = greatest(uid1, q2.user_id)
    )
  order by q2.queued_at asc
  for update skip locked
  limit 1;

  /** fallback：僅放寬 abort 冷卻；gender／matches／blocks 仍強制 */
  if uid2 is null then
    select q2.user_id into uid2
    from public.instant_match_queue q2
    inner join public.profiles p1 on p1.id = uid1
    inner join public.profiles p2 on p2.id = q2.user_id
    where q2.session_id is null
      and q2.user_id <> uid1
      and q2.queued_at >= now() - interval '2 minutes'
      and p1.account_status = 'active'
      and p2.account_status = 'active'
      and p1.gender is not null
      and p2.gender is not null
      and p1.gender <> p2.gender
      and not exists (
        select 1 from public.matches m
        where m.user_a = least(uid1, q2.user_id)
          and m.user_b = greatest(uid1, q2.user_id)
      )
      and not exists (
        select 1 from public.profile_blocks b
        where (
          b.blocker_user_id = uid1
          and (
            b.blocked_user_id = q2.user_id
            or b.blocked_profile_key = q2.user_id::text
            or b.blocked_profile_key = ('user:' || q2.user_id::text)
          )
        )
        or (b.blocker_user_id = q2.user_id and b.blocked_user_id = uid1)
      )
    order by q2.queued_at asc
    for update skip locked
    limit 1;
  end if;

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

comment on function public._instant_try_pair_locked() is
  '即時撮合：FIFO 兩人開房；排除 matches／封鎖、僅異性；90 分鐘 abort 冷卻可 fallback。';

notify pgrst, 'reload schema';
