-- 088：營運一次性 — teslam3eke@gmail.com 對 founding018@tsmedia.tw 送探索愛心（不扣點）
-- founding018 先前已 like 家華時，一併建立 matches 與 match_created 通知。
-- 冪等：已存在相同 like 時仍會檢查並補建缺失的 match。

do $$
declare
  v_actor uuid;
  v_target uuid;
  v_day text := public.app_day_key_now();
  v_user_a uuid;
  v_user_b uuid;
  v_new_match uuid;
  v_already_liked boolean := false;
begin
  select u.id into v_actor
  from auth.users u
  where lower(u.email) = lower('teslam3eke@gmail.com');

  select u.id into v_target
  from auth.users u
  where lower(u.email) = lower('founding018@tsmedia.tw');

  if v_actor is null then
    raise exception '088: 找不到 actor email teslam3eke@gmail.com';
  end if;

  if v_target is null then
    raise exception '088: 找不到 target email founding018@tsmedia.tw';
  end if;

  if v_actor = v_target then
    raise exception '088: actor 與 target 不可為同一使用者';
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
    raise notice '088: 略過（雙方其一已封鎖）';
    return;
  end if;

  select exists (
    select 1
    from public.profile_interactions i
    where i.actor_user_id = v_actor
      and i.action in ('like', 'super_like')
      and (
        i.target_user_id = v_target
        or i.target_profile_key = v_target::text
        or i.target_profile_key = ('user:' || v_target::text)
      )
  ) into v_already_liked;

  if not v_already_liked then
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

    raise notice '088: 已寫入 teslam3eke → founding018 探索 like';
  else
    raise notice '088: teslam3eke 已對 founding018 送過 like／super_like，改檢查互配';
  end if;

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
      raise notice '088: 雙向喜歡，已建立新配對 %', v_new_match;
    else
      select m.id into v_new_match
      from public.matches m
      where m.user_a = v_user_a and m.user_b = v_user_b;
      raise notice '088: 雙向喜歡，配對已存在 %', v_new_match;
    end if;
  else
    raise notice '088: 僅單向 like，待 founding018 回按才會互配';
  end if;
end $$;
