-- ============================================================
-- 探索：同一 app 日對同一人只能送一次愛心（不重复扣點）；隔日可再送。
-- 1) profile_interactions 改為 (actor, target_profile_key, interaction_app_day_key) 唯一，
--    並補齊 interaction_app_day_key（由 created_at 換算 app 日）。
-- 2) record_profile_interaction：若當日已 like／super_like 過則直接回傳旗標、不扣點。
-- 3) get_daily_discover_deck 回傳的 profile JSON 附 liked_today / super_liked_today（供 UI）。
-- ============================================================

-- 與 app_day_key_now 相同換日邏輯，套在任意時間點
create or replace function public.app_day_key_at(p_ts timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select to_char(
    (((p_ts at time zone 'Asia/Taipei') - interval '22 hours'))::date,
    'YYYY-MM-DD'
  );
$$;

grant execute on function public.app_day_key_at(timestamptz) to authenticated;

-- ── profile_interactions：新增 app 日欄位並改唯一鍵 ───────────────────────

alter table public.profile_interactions
  add column if not exists interaction_app_day_key text;

update public.profile_interactions
set interaction_app_day_key = public.app_day_key_at(created_at)
where interaction_app_day_key is null;

alter table public.profile_interactions
  alter column interaction_app_day_key set not null;

alter table public.profile_interactions
  drop constraint if exists profile_interactions_actor_user_id_target_profile_key_key;

alter table public.profile_interactions
  add constraint profile_interactions_actor_target_day_key
  unique (actor_user_id, target_profile_key, interaction_app_day_key);

-- ── 探索 profile JSON（附當日是否已送愛心／超喜）────────────────────────────

create or replace function public._daily_discover_profiles_json(
  p_viewer uuid,
  p_day text,
  p_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_agg(profile_obj order by ord)
      from (
        select
          u.ord,
          jsonb_build_object(
            'id', p.id,
            'nickname', p.nickname,
            'name', p.name,
            'gender', p.gender,
            'age', p.age,
            'company', p.company,
            'job_title', p.job_title,
            'department', p.department,
            'bio', p.bio,
            'interests', coalesce(to_jsonb(p.interests), '[]'::jsonb),
            'questionnaire', coalesce(p.questionnaire, '[]'::jsonb),
            'photo_urls', coalesce(to_jsonb(p.photo_urls), '[]'::jsonb),
            'work_region', p.work_region,
            'home_region', p.home_region,
            'income_tier', p.income_tier,
            'show_income_border', coalesce(p.show_income_border, false),
            'liked_today', exists (
              select 1 from public.profile_interactions i
              where i.actor_user_id = p_viewer
                and i.interaction_app_day_key = p_day
                and i.action = 'like'
                and (
                  i.target_user_id = p.id
                  or i.target_profile_key = p.id::text
                  or i.target_profile_key = ('user:' || p.id::text)
                )
            ),
            'super_liked_today', exists (
              select 1 from public.profile_interactions i
              where i.actor_user_id = p_viewer
                and i.interaction_app_day_key = p_day
                and i.action = 'super_like'
                and (
                  i.target_user_id = p.id
                  or i.target_profile_key = p.id::text
                  or i.target_profile_key = ('user:' || p.id::text)
                )
            )
          ) as profile_obj
        from unnest(p_ids) with ordinality as u(uid, ord)
        join public.profiles p on p.id = u.uid
      ) sub
    ),
    '[]'::jsonb
  );
$$;

-- ── get_daily_discover_deck：傳入 viewer + day ─────────────────────────────

create or replace function public.get_daily_discover_deck()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_day text := public.app_day_key_now();
  v_my_gender text;
  v_pref text;
  v_order text[];
  v_picked uuid[] := array[]::uuid[];
  v_inserted uuid[];
  r text;
  r_pick uuid;
  v_need int;
  v_deck uuid[];
begin
  if v_viewer is null then
    raise exception 'Not authenticated';
  end if;

  select d.target_user_ids
  into v_deck
  from public.daily_discover_deck d
  where d.viewer_user_id = v_viewer and d.app_day_key = v_day;

  if found then
    if cardinality(coalesce(v_deck, array[]::uuid[])) > 0 then
      return public._daily_discover_profiles_json(v_viewer, v_day, coalesce(v_deck, array[]::uuid[]));
    end if;
    delete from public.daily_discover_deck
    where viewer_user_id = v_viewer and app_day_key = v_day;
  end if;

  select p.gender::text, p.preferred_region::text
  into v_my_gender, v_pref
  from public.profiles p
  where p.id = v_viewer;

  if v_my_gender is null then
    return '[]'::jsonb;
  end if;

  v_order := public._daily_discover_region_order(v_pref);

  foreach r in array v_order loop
    exit when cardinality(v_picked) >= 6;
    v_need := 6 - cardinality(v_picked);
    for r_pick in
      select p.id
      from public.profiles p
      where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, r, true)
        and not (p.id = any(v_picked))
      order by
        p.login_last_app_day desc nulls last,
        p.updated_at desc nulls last,
        p.id
      limit v_need
    loop
      v_picked := v_picked || r_pick;
      exit when cardinality(v_picked) >= 6;
    end loop;
  end loop;

  if cardinality(v_picked) < 6 then
    foreach r in array v_order loop
      exit when cardinality(v_picked) >= 6;
      v_need := 6 - cardinality(v_picked);
      for r_pick in
        select p.id
        from public.profiles p
        where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, r, false)
          and not (p.id = any(v_picked))
        order by
          p.login_last_app_day desc nulls last,
          p.updated_at desc nulls last,
          p.id
        limit v_need
      loop
        v_picked := v_picked || r_pick;
        exit when cardinality(v_picked) >= 6;
      end loop;
    end loop;
  end if;

  if cardinality(v_picked) > 0 then
    insert into public.daily_discover_deck (viewer_user_id, app_day_key, target_user_ids)
    values (v_viewer, v_day, v_picked)
    on conflict (viewer_user_id, app_day_key) do nothing
    returning target_user_ids into v_inserted;

    if v_inserted is null then
      select d.target_user_ids into v_deck
      from public.daily_discover_deck d
      where d.viewer_user_id = v_viewer and d.app_day_key = v_day;
      v_deck := coalesce(v_deck, array[]::uuid[]);
    else
      v_deck := v_inserted;
      insert into public.daily_discover_shown (viewer_user_id, shown_user_id, first_app_day_key)
      select v_viewer, x, v_day
      from unnest(v_inserted) as u(x)
      on conflict (viewer_user_id, shown_user_id) do nothing;
    end if;
  else
    v_deck := array[]::uuid[];
  end if;

  return public._daily_discover_profiles_json(v_viewer, v_day, coalesce(v_deck, array[]::uuid[]));
end;
$$;

grant execute on function public.get_daily_discover_deck() to authenticated;

-- ── record_profile_interaction：防當日重複扣愛心／超喜 ─────────────────────

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
        and i.interaction_app_day_key = v_day
        and i.action in ('like', 'super_like')
    ) then
      return jsonb_build_object('matched', false, 'already_liked_today', true);
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
        and i.interaction_app_day_key = v_day
        and i.action = 'super_like'
    ) then
      return jsonb_build_object('matched', false, 'already_super_liked_today', true);
    end if;

    v_super := public._credit_balance(v_actor, 'super_like');
    if v_super < 1 then
      raise exception 'INSUFFICIENT_SUPER_LIKE';
    end if;
    v_new_bal := v_super - 1;
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_actor, 'spend', 'super_like', -1, v_new_bal, '探索：超級喜歡');
  end if;

  -- pass / like / super_like 皆寫入（pass 不扣點）
  insert into public.profile_interactions (
    actor_user_id, target_user_id, target_profile_key, action, interaction_app_day_key
  )
  values (
    v_actor, p_target_user_id, p_target_profile_key, p_action, v_day
  )
  on conflict (actor_user_id, target_profile_key, interaction_app_day_key)
  do update set
    target_user_id = excluded.target_user_id,
    action = case
      when profile_interactions.action in ('like', 'super_like') and excluded.action = 'pass' then profile_interactions.action
      when profile_interactions.action = 'like' and excluded.action = 'super_like' then 'super_like'
      else excluded.action
    end,
    created_at = now();

  if p_action = 'super_like' and p_target_user_id is not null and p_target_user_id <> v_actor then
    insert into public.app_notifications (user_id, kind, title, body)
    values (
      p_target_user_id,
      'super_like_received',
      '有人對你按了超級喜歡',
      '對方使用超級喜歡讓你知道他對你有興趣。'
    );
  end if;

  if p_target_user_id is not null
     and p_target_user_id <> v_actor
     and p_action in ('like', 'super_like')
     and exists (
       select 1
       from public.profile_interactions i
       where i.actor_user_id = p_target_user_id
         and i.target_user_id = v_actor
         and i.action in ('like', 'super_like')
     )
  then
    v_user_a := least(v_actor, p_target_user_id);
    v_user_b := greatest(v_actor, p_target_user_id);

    insert into public.matches (user_a, user_b)
    values (v_user_a, v_user_b)
    on conflict (user_a, user_b) do nothing;

    v_matched := true;

    insert into public.app_notifications (user_id, kind, title, body)
    values
      (v_actor, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
      (p_target_user_id, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
  end if;

  return jsonb_build_object('matched', v_matched);
end;
$$;

grant execute on function public.record_profile_interaction(text, text, uuid) to authenticated;
