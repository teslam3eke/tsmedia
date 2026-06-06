-- 085：營運一次性 — founding018@tsmedia.tw 對 teslam3eke@gmail.com 送探索愛心（不扣點）
-- 若對方先前已對 founding018 按過 like／super_like，一併建立 matches 與 match_created 通知。
-- 冪等：已存在相同 like 時略過，不因重跑 migration 重複入帳或重複通知。

do $$
declare
  v_actor uuid;
  v_target uuid;
  v_day text := public.app_day_key_now();
  v_user_a uuid;
  v_user_b uuid;
  v_new_match uuid;
begin
  select u.id into v_actor
  from auth.users u
  where lower(u.email) = lower('founding018@tsmedia.tw');

  select u.id into v_target
  from auth.users u
  where lower(u.email) = lower('teslam3eke@gmail.com');

  if v_actor is null then
    raise exception '085: 找不到 actor email founding018@tsmedia.tw';
  end if;

  if v_target is null then
    raise exception '085: 找不到 target email teslam3eke@gmail.com';
  end if;

  if v_actor = v_target then
    raise exception '085: actor 與 target 不可為同一使用者';
  end if;

  if exists (
    select 1
    from public.profile_blocks b
    where b.blocker_user_id = v_actor
      and (
        b.blocked_user_id = v_target
        or b.blocked_profile_key = v_target::text
        or b.blocked_profile_key = ('user:' || v_target::text)
      )
  ) or exists (
    select 1
    from public.profile_blocks b
    where b.blocker_user_id = v_target
      and b.blocked_user_id = v_actor
  ) then
    raise notice '085: 略過（雙方其一已封鎖）';
    return;
  end if;

  if exists (
    select 1
    from public.profile_interactions i
    where i.actor_user_id = v_actor
      and i.action in ('like', 'super_like')
      and (
        i.target_user_id = v_target
        or i.target_profile_key = v_target::text
        or i.target_profile_key = ('user:' || v_target::text)
      )
  ) then
    raise notice '085: 略過（founding018 已對該對象送過 like／super_like）';
    return;
  end if;

  insert into public.profile_interactions (
    actor_user_id, target_user_id, target_profile_key, action, interaction_app_day_key
  )
  values (v_actor, v_target, v_target::text, 'like', v_day)
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

  raise notice '085: 已寫入 founding018 → teslam3eke 探索 like';

  if exists (
    select 1
    from public.profile_interactions i
    where i.actor_user_id = v_target
      and i.action in ('like', 'super_like')
      and (
        i.target_user_id = v_actor
        or i.target_profile_key = v_actor::text
        or i.target_profile_key = ('user:' || v_actor::text)
      )
  ) then
    v_user_a := least(v_actor, v_target);
    v_user_b := greatest(v_actor, v_target);

    insert into public.matches (user_a, user_b)
    values (v_user_a, v_user_b)
    on conflict (user_a, user_b) do nothing
    returning id into v_new_match;

    if v_new_match is not null then
      insert into public.app_notifications (user_id, kind, title, body)
      values
        (v_actor, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
        (v_target, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
      raise notice '085: 雙向喜歡，已建立新配對 %', v_new_match;
    else
      raise notice '085: 雙向喜歡，配對已存在（略過通知）';
    end if;
  end if;
end $$;
