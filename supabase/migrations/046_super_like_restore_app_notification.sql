-- ============================================================
-- 046: 超級喜歡恢復寫入 app_notifications（站內彈窗 + Database Webhook 推播）
--
-- 041 為立即配對移除了 super_like_received insert，收件者若未開著 App
-- 即無法依 matches Realtime 得知；與「一般訊息可推播」不一致。
-- ============================================================

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
        and i.target_profile_key = p_target_profile_key
        and i.action in ('like', 'super_like')
    ) then
      return jsonb_build_object('matched', false, 'already_liked', true);
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
      on conflict (user_a, user_b) do nothing;
      v_matched := true;
    elsif p_action = 'super_like' then
      v_user_a := least(v_actor, p_target_user_id);
      v_user_b := greatest(v_actor, p_target_user_id);
      insert into public.matches (user_a, user_b)
      values (v_user_a, v_user_b)
      on conflict (user_a, user_b) do nothing;
      v_matched := true;
    end if;
  end if;

  if p_action = 'super_like'
     and p_target_user_id is not null
     and p_target_user_id <> v_actor
  then
    insert into public.app_notifications (user_id, kind, title, body)
    values (
      p_target_user_id,
      'super_like_received',
      '有人對你按了超級喜歡',
      '你們已配對成功，開聊天室聊聊吧。'
    );
  end if;

  return jsonb_build_object('matched', v_matched);
end;
$$;

grant execute on function public.record_profile_interaction(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
