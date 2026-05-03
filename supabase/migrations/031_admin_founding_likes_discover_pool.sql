-- ============================================================
-- 管理用：所有創始會員（founding_member_no IS NOT NULL）對「今日
-- daily_discover_deck 曾出現過的目標 user」各送一則 like（不扣愛心）。
-- 若對方先前已對該創始會員按過 like／super_like，會建立配對並發
-- match_created 通知（與 record_profile_interaction 一致）。
--
-- 僅 service_role 可執行；請用 scripts/admin-founding-likes-discover-pool.ts
-- 或 Dashboard SQL： select public.admin_founding_likes_to_todays_discover_targets();
-- ============================================================

create or replace function public.admin_founding_likes_to_todays_discover_targets()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day text := public.app_day_key_now();
  v_founder uuid;
  v_target uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_matched int := 0;
  v_user_a uuid;
  v_user_b uuid;
  v_new_match uuid;
begin
  for v_founder in
    select p.id from public.profiles p where p.founding_member_no is not null
  loop
    for v_target in
      select distinct u.uid
      from public.daily_discover_deck d
      cross join lateral unnest(d.target_user_ids) as u(uid)
      where d.app_day_key = v_day
        and u.uid is not null
    loop
      if v_founder = v_target then
        continue;
      end if;

      if exists (
        select 1 from public.profile_blocks b
        where b.blocker_user_id = v_founder
          and (b.blocked_profile_key = v_target::text
            or b.blocked_profile_key = ('user:' || v_target::text)
            or b.blocked_user_id = v_target)
      ) or exists (
        select 1 from public.profile_blocks b
        where b.blocker_user_id = v_target
          and b.blocked_user_id = v_founder
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if exists (
        select 1 from public.profile_interactions i
        where i.actor_user_id = v_founder
          and i.action in ('like', 'super_like')
          and (
            i.target_user_id = v_target
            or i.target_profile_key = v_target::text
            or i.target_profile_key = ('user:' || v_target::text)
          )
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      insert into public.profile_interactions (
        actor_user_id, target_user_id, target_profile_key, action, interaction_app_day_key
      )
      values (v_founder, v_target, v_target::text, 'like', v_day)
      on conflict (actor_user_id, target_profile_key, interaction_app_day_key)
      do update set
        target_user_id = coalesce(excluded.target_user_id, profile_interactions.target_user_id),
        action = case
          when profile_interactions.action in ('like', 'super_like') and excluded.action = 'pass'
            then profile_interactions.action
          when profile_interactions.action = 'like' and excluded.action = 'super_like'
            then 'super_like'
          else excluded.action
        end,
        created_at = now();

      v_inserted := v_inserted + 1;

      if exists (
        select 1 from public.profile_interactions i
        where i.actor_user_id = v_target
          and i.action in ('like', 'super_like')
          and (
            i.target_user_id = v_founder
            or i.target_profile_key = v_founder::text
            or i.target_profile_key = ('user:' || v_founder::text)
          )
      ) then
        v_user_a := least(v_founder, v_target);
        v_user_b := greatest(v_founder, v_target);

        v_new_match := null;
        insert into public.matches (user_a, user_b)
        values (v_user_a, v_user_b)
        on conflict (user_a, user_b) do nothing
        returning id into v_new_match;

        if v_new_match is not null then
          v_matched := v_matched + 1;
          insert into public.app_notifications (user_id, kind, title, body)
          values
            (v_founder, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
            (v_target, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'app_day_key', v_day,
    'likes_inserted', v_inserted,
    'pairs_skipped', v_skipped,
    'new_matches', v_matched
  );
end;
$$;

revoke all on function public.admin_founding_likes_to_todays_discover_targets() from public;
grant execute on function public.admin_founding_likes_to_todays_discover_targets() to service_role;
