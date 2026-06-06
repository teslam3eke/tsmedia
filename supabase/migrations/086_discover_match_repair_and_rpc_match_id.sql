-- 086：
-- 1) record_profile_interaction：already_liked 時若對方先前已 like 仍補建 match；
--    回傳 match_id 供前端立即顯示配對成功（不依賴 Realtime）。
-- 2) 修復 founding018@tsmedia.tw ↔ teslam3eke@gmail.com 雙向 like 卻無 match 列。

create or replace function public.record_profile_interaction(
  p_target_profile_key text,
  p_action text,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_matched boolean := false;
  v_user_a uuid;
  v_user_b uuid;
  v_new_match uuid;
  v_heart int;
  v_super int;
  v_new_bal int;
  v_day text := public.app_day_key_now();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_action not in ('pass', 'like', 'super_like') then
    raise exception 'Invalid action';
  end if;

  if exists (
    select 1 from public.profile_blocks b
    where b.blocker_user_id = v_actor
      and (b.blocked_profile_key = p_target_profile_key or b.blocked_user_id = p_target_user_id)
  ) or (
    p_target_user_id is not null and exists (
      select 1 from public.profile_blocks b
      where b.blocker_user_id = p_target_user_id
        and b.blocked_user_id = v_actor
    )
  ) then
    return jsonb_build_object('matched', false, 'blocked', true);
  end if;

  if p_action = 'like' then
    if exists (
      select 1 from public.profile_interactions i
      where i.actor_user_id = v_actor
        and i.action in ('like', 'super_like')
        and (
          i.target_profile_key = p_target_profile_key
          or (
            p_target_user_id is not null
            and (
              i.target_user_id = p_target_user_id
              or i.target_profile_key = p_target_user_id::text
              or i.target_profile_key = ('user:' || p_target_user_id::text)
            )
          )
        )
    ) then
      if p_target_user_id is not null
         and p_target_user_id <> v_actor
         and exists (
           select 1
           from public.profile_interactions i
           where i.actor_user_id = p_target_user_id
             and i.action in ('like', 'super_like')
             and (
               i.target_user_id = v_actor
               or i.target_profile_key = v_actor::text
               or i.target_profile_key = ('user:' || v_actor::text)
             )
         )
      then
        v_user_a := least(v_actor, p_target_user_id);
        v_user_b := greatest(v_actor, p_target_user_id);
        insert into public.matches (user_a, user_b)
        values (v_user_a, v_user_b)
        on conflict (user_a, user_b) do nothing
        returning id into v_new_match;
        if v_new_match is not null then
          v_matched := true;
          insert into public.app_notifications (user_id, kind, title, body)
          values
            (v_actor, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
            (p_target_user_id, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
        else
          select m.id into v_new_match
          from public.matches m
          where m.user_a = v_user_a and m.user_b = v_user_b;
          if v_new_match is not null then
            v_matched := true;
          end if;
        end if;
      end if;
      return jsonb_build_object(
        'matched', v_matched,
        'match_id', v_new_match,
        'already_liked', true
      );
    end if;

    v_heart := public._credit_balance(v_actor, 'heart');
    if v_heart < 1 then
      raise exception 'INSUFFICIENT_HEART';
    end if;
    v_new_bal := v_heart - 1;
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_actor, 'spend', 'heart', -1, v_new_bal, '探索：送出愛心');

  elsif p_action = 'super_like' then
    if exists (
      select 1 from public.profile_interactions i
      where i.actor_user_id = v_actor
        and i.target_profile_key = p_target_profile_key
        and i.action = 'super_like'
    ) then
      return jsonb_build_object('matched', false, 'already_super_liked', true);
    end if;

    v_super := public._credit_balance(v_actor, 'super_like');
    if v_super < 1 then
      raise exception 'INSUFFICIENT_SUPER_LIKE';
    end if;
    v_new_bal := v_super - 1;
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_actor, 'spend', 'super_like', -1, v_new_bal, '探索：超級喜歡');
  end if;

  insert into public.profile_interactions (
    actor_user_id, target_user_id, target_profile_key, action, interaction_app_day_key
  )
  values (
    v_actor, p_target_user_id, p_target_profile_key, p_action, v_day
  )
  on conflict (actor_user_id, target_profile_key, interaction_app_day_key)
  do update set
    target_user_id = coalesce(excluded.target_user_id, profile_interactions.target_user_id),
    action = case
      when profile_interactions.action in ('like', 'super_like') and excluded.action = 'pass' then profile_interactions.action
      when profile_interactions.action = 'like' and excluded.action = 'super_like' then 'super_like'
      else excluded.action
    end,
    created_at = now();

  if p_target_user_id is not null
     and p_target_user_id <> v_actor
     and p_action in ('like', 'super_like')
  then
    if exists (
       select 1
       from public.profile_interactions i
       where i.actor_user_id = p_target_user_id
         and i.action in ('like', 'super_like')
         and (
           i.target_user_id = v_actor
           or i.target_profile_key = v_actor::text
           or i.target_profile_key = ('user:' || v_actor::text)
         )
     ) then
      v_user_a := least(v_actor, p_target_user_id);
      v_user_b := greatest(v_actor, p_target_user_id);
      insert into public.matches (user_a, user_b)
      values (v_user_a, v_user_b)
      on conflict (user_a, user_b) do nothing
      returning id into v_new_match;
      if v_new_match is not null then
        v_matched := true;
        insert into public.app_notifications (user_id, kind, title, body)
        values
          (v_actor, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
          (p_target_user_id, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
      else
        select m.id into v_new_match
        from public.matches m
        where m.user_a = v_user_a and m.user_b = v_user_b;
        if v_new_match is not null then
          v_matched := true;
        end if;
      end if;
    elsif p_action = 'super_like' then
      v_user_a := least(v_actor, p_target_user_id);
      v_user_b := greatest(v_actor, p_target_user_id);
      insert into public.matches (user_a, user_b)
      values (v_user_a, v_user_b)
      on conflict (user_a, user_b) do nothing
      returning id into v_new_match;
      if v_new_match is not null then
        v_matched := true;
        insert into public.app_notifications (user_id, kind, title, body)
        values
          (v_actor, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
          (p_target_user_id, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
      else
        select m.id into v_new_match
        from public.matches m
        where m.user_a = v_user_a and m.user_b = v_user_b;
        if v_new_match is not null then
          v_matched := true;
        end if;
      end if;
    end if;
  end if;

  if p_action = 'super_like'
     and p_target_user_id is not null
     and p_target_user_id <> v_actor
     and not v_matched
  then
    insert into public.app_notifications (user_id, kind, title, body)
    values (
      p_target_user_id,
      'super_like_received',
      '有人對你按了超級喜歡',
      '你們已配對成功，開聊天室聊聊吧。'
    );
  end if;

  return jsonb_build_object(
    'matched', v_matched,
    'match_id', case when v_matched then v_new_match else null end
  );
end;
$$;

grant execute on function public.record_profile_interaction(text, text, uuid) to authenticated;

-- ── 修復指定測試對：雙向 like 卻缺 matches ────────────────────────────────
do $$
declare
  v_founding uuid;
  v_tesla uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_match uuid;
  v_founding_likes_tesla boolean := false;
  v_tesla_likes_founding boolean := false;
begin
  select u.id into v_founding
  from auth.users u
  where lower(u.email) = lower('founding018@tsmedia.tw');

  select u.id into v_tesla
  from auth.users u
  where lower(u.email) = lower('teslam3eke@gmail.com');

  if v_founding is null or v_tesla is null then
    raise notice '086 repair: 略過（email 帳號不存在）';
    return;
  end if;

  select exists (
    select 1 from public.profile_interactions i
    where i.actor_user_id = v_founding
      and i.action in ('like', 'super_like')
      and (
        i.target_user_id = v_tesla
        or i.target_profile_key = v_tesla::text
        or i.target_profile_key = ('user:' || v_tesla::text)
      )
  ) into v_founding_likes_tesla;

  select exists (
    select 1 from public.profile_interactions i
    where i.actor_user_id = v_tesla
      and i.action in ('like', 'super_like')
      and (
        i.target_user_id = v_founding
        or i.target_profile_key = v_founding::text
        or i.target_profile_key = ('user:' || v_founding::text)
      )
  ) into v_tesla_likes_founding;

  raise notice '086 repair: founding018→tesla=% tesla→founding018=%',
    v_founding_likes_tesla, v_tesla_likes_founding;

  if not v_founding_likes_tesla then
    insert into public.profile_interactions (
      actor_user_id, target_user_id, target_profile_key, action, interaction_app_day_key
    )
    values (v_founding, v_tesla, v_tesla::text, 'like', public.app_day_key_now())
    on conflict (actor_user_id, target_profile_key, interaction_app_day_key)
    do update set
      target_user_id = coalesce(excluded.target_user_id, profile_interactions.target_user_id),
      action = excluded.action,
      created_at = now();
    v_founding_likes_tesla := true;
    raise notice '086 repair: 已補寫 founding018 → teslam3eke like';
  end if;

  if not (v_founding_likes_tesla and v_tesla_likes_founding) then
    raise notice '086 repair: 尚未雙向 like，需 teslam3eke 對 founding018 按愛心';
    return;
  end if;

  v_user_a := least(v_founding, v_tesla);
  v_user_b := greatest(v_founding, v_tesla);

  select m.id into v_match
  from public.matches m
  where m.user_a = v_user_a and m.user_b = v_user_b;

  if v_match is not null then
    raise notice '086 repair: 配對已存在 %', v_match;
    return;
  end if;

  insert into public.matches (user_a, user_b)
  values (v_user_a, v_user_b)
  returning id into v_match;

  insert into public.app_notifications (user_id, kind, title, body)
  values
    (v_founding, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
    (v_tesla, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');

  raise notice '086 repair: 已建立配對 %', v_match;
end $$;

notify pgrst, 'reload schema';
