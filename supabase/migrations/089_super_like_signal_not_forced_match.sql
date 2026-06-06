-- 089：方案 A — 超級喜歡 = 高意圖信號（通知 + 探索置頂），非強制配對
-- - 移除 super_like 單向立即 insert matches（041 行為）
-- - 僅雙向 like／super_like 才建 matches
-- - 收件者 super_like_received 通知 + 探索牌組超喜者優先置頂（含當日已快取 deck）

-- ── 探索：合併新超喜者並置頂 ────────────────────────────────────────────────
create or replace function public._discover_apply_super_like_priority(
  p_viewer uuid,
  p_my_gender text,
  p_region_order text[],
  p_deck uuid[]
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_deck uuid[] := coalesce(p_deck, array[]::uuid[]);
  v_new_super uuid[] := array[]::uuid[];
  v_combined uuid[] := array[]::uuid[];
  v_out uuid[] := array[]::uuid[];
  r uuid;
  v_is_super boolean;
begin
  if p_viewer is null or p_my_gender is null then
    return v_deck;
  end if;

  select coalesce(array_agg(q.actor_uid order by q.mx desc), array[]::uuid[])
  into v_new_super
  from (
    select
      i.actor_user_id as actor_uid,
      max(i.created_at) as mx
    from public.profile_interactions i
    where i.action = 'super_like'
      and i.actor_user_id is not null
      and i.actor_user_id <> p_viewer
      and (
        i.target_user_id = p_viewer
        or i.target_profile_key = p_viewer::text
        or i.target_profile_key = ('user:' || p_viewer::text)
      )
      and not (i.actor_user_id = any(v_deck))
    group by i.actor_user_id
  ) q
  where exists (
    select 1
    from (select unnest(coalesce(p_region_order, array[]::text[])) as region) ord
    where public._daily_discover_candidate_ok(
      p_viewer, q.actor_uid, p_my_gender, ord.region, false
    )
  );

  v_combined := coalesce(v_new_super, array[]::uuid[]) || v_deck;

  foreach r in array v_combined loop
    if r is null or r = any(v_out) then
      continue;
    end if;
    v_out := array_append(v_out, r);
    exit when cardinality(v_out) >= 6;
  end loop;

  if cardinality(v_out) <= 1 then
    return v_out;
  end if;

  v_combined := array[]::uuid[];
  foreach r in array v_out loop
    select exists (
      select 1
      from public.profile_interactions i
      where i.actor_user_id = r
        and i.action = 'super_like'
        and (
          i.target_user_id = p_viewer
          or i.target_profile_key = p_viewer::text
          or i.target_profile_key = ('user:' || p_viewer::text)
        )
    ) into v_is_super;

    if v_is_super then
      v_combined := array_prepend(r, v_combined);
    else
      v_combined := array_append(v_combined, r);
    end if;
  end loop;

  return v_combined;
end;
$$;

-- ── 探索 profile JSON：標記「對方曾對你超喜」──────────────────────────────
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
                and i.action = 'super_like'
                and (
                  i.target_user_id = p.id
                  or i.target_profile_key = p.id::text
                  or i.target_profile_key = ('user:' || p.id::text)
                )
            ),
            'incoming_super_liked', exists (
              select 1 from public.profile_interactions i
              where i.actor_user_id = p.id
                and i.action = 'super_like'
                and (
                  i.target_user_id = p_viewer
                  or i.target_profile_key = p_viewer::text
                  or i.target_profile_key = ('user:' || p_viewer::text)
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

-- ── 探索牌組：incoming 超喜優先 + 快取 deck 動態置頂 ───────────────────────
create or replace function public.__get_daily_discover_deck_impl()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_day text := public.app_day_key_now();
  v_prev_day text;
  v_my_gender text;
  v_pref text;
  v_pref_norm text;
  v_order text[];
  v_picked uuid[] := array[]::uuid[];
  v_perm uuid[];
  v_prev_raw uuid[] := array[]::uuid[];
  v_prev_excl uuid[] := array[]::uuid[];
  v_inserted uuid[];
  r text;
  r_pick uuid;
  incoming_uid uuid;
  v_need int;
  v_deck uuid[];
  v_strict_pref boolean;
  v_salt int;
  v_pass int;
begin
  if v_viewer is null then
    raise exception 'Not authenticated';
  end if;

  select p.gender::text, p.preferred_region::text
  into v_my_gender, v_pref
  from public.profiles p
  where p.id = v_viewer;

  if v_my_gender is null then
    return '[]'::jsonb;
  end if;

  v_strict_pref := v_pref is not null and btrim(v_pref) <> '';
  v_pref_norm := lower(trim(btrim(coalesce(v_pref, ''))));

  if v_strict_pref then
    v_order := array[v_pref_norm];
  else
    v_order := public._daily_discover_region_order(v_pref);
  end if;

  select d.target_user_ids
  into v_deck
  from public.daily_discover_deck d
  where d.viewer_user_id = v_viewer and d.app_day_key = v_day;

  if found then
    if cardinality(coalesce(v_deck, array[]::uuid[])) > 0 then
      v_deck := public._discover_apply_super_like_priority(v_viewer, v_my_gender, v_order, v_deck);
      return public._daily_discover_profiles_json(v_viewer, v_day, v_deck);
    end if;
    delete from public.daily_discover_deck
    where viewer_user_id = v_viewer and app_day_key = v_day;
  end if;

  v_prev_day := to_char((to_date(v_day, 'YYYY-MM-DD') - 1)::date, 'YYYY-MM-DD');
  select coalesce(d.target_user_ids, array[]::uuid[])
  into v_prev_raw
  from public.daily_discover_deck d
  where d.viewer_user_id = v_viewer and d.app_day_key = v_prev_day;

  if cardinality(v_prev_raw) > 0 then
    select coalesce(array_agg(u.uid), array[]::uuid[])
    into v_prev_excl
    from unnest(v_prev_raw) as u(uid)
    where public._daily_discover_candidate_ok(v_viewer, u.uid, v_my_gender, null::text, false);
  else
    v_prev_excl := array[]::uuid[];
  end if;

  for v_pass in 1..2 loop
    if v_pass = 2 then
      exit when cardinality(v_picked) > 0;
      v_prev_excl := array[]::uuid[];
    end if;

    v_picked := array[]::uuid[];

    for incoming_uid in
      select q.actor_uid
      from (
        select
          i.actor_user_id as actor_uid,
          max(i.created_at) as mx,
          bool_or(i.action = 'super_like') as is_super
        from public.profile_interactions i
        where i.action in ('like', 'super_like')
          and i.actor_user_id is not null
          and i.actor_user_id <> v_viewer
          and (
            i.target_user_id = v_viewer
            or i.target_profile_key = v_viewer::text
            or i.target_profile_key = ('user:' || v_viewer::text)
          )
        group by i.actor_user_id
      ) q
      where exists (
        select 1
        from (select unnest(v_order) as region) ord
        where public._daily_discover_candidate_ok(v_viewer, q.actor_uid, v_my_gender, ord.region, false)
      )
      order by q.is_super desc, q.mx desc
    loop
      exit when cardinality(v_picked) >= 6;
      if not (incoming_uid = any(v_picked))
         and not (incoming_uid = any(v_prev_excl)) then
        v_picked := array_append(v_picked, incoming_uid);
      end if;
    end loop;

    foreach r in array v_order loop
      exit when cardinality(v_picked) >= 6;
      v_need := 6 - cardinality(v_picked);
      for r_pick in
        select p.id
        from public.profiles p
        where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, r, true)
          and not (p.id = any(v_picked))
          and not (p.id = any(v_prev_excl))
        order by -ln((random() * 0.9999999999999999 + 1e-15)::float8)
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
          left join public.daily_discover_shown s
            on s.viewer_user_id = v_viewer and s.shown_user_id = p.id
          where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, r, false)
            and not (p.id = any(v_picked))
            and not (p.id = any(v_prev_excl))
          order by
            (-ln((random() * 0.9999999999999999 + 1e-15)::float8))
              / greatest(
                1e-12::float8,
                (1.0::float8 / power((1 + coalesce(s.deck_show_count, 0))::float8, 2.0))
              )
          limit v_need
        loop
          v_picked := v_picked || r_pick;
          exit when cardinality(v_picked) >= 6;
        end loop;
      end loop;
    end if;

    if cardinality(v_picked) = 0 and not v_strict_pref then
      v_need := 6;
      for r_pick in
        select p.id
        from public.profiles p
        where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, null::text, true)
          and not (p.id = any(v_picked))
          and not (p.id = any(v_prev_excl))
        order by -ln((random() * 0.9999999999999999 + 1e-15)::float8)
        limit v_need
      loop
        v_picked := v_picked || r_pick;
        exit when cardinality(v_picked) >= 6;
      end loop;

      if cardinality(v_picked) < 6 then
        v_need := 6 - cardinality(v_picked);
        for r_pick in
          select p.id
          from public.profiles p
          left join public.daily_discover_shown s
            on s.viewer_user_id = v_viewer and s.shown_user_id = p.id
          where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, null::text, false)
            and not (p.id = any(v_picked))
            and not (p.id = any(v_prev_excl))
          order by
            (-ln((random() * 0.9999999999999999 + 1e-15)::float8))
              / greatest(
                1e-12::float8,
                (1.0::float8 / power((1 + coalesce(s.deck_show_count, 0))::float8, 2.0))
              )
          limit v_need
        loop
          v_picked := v_picked || r_pick;
          exit when cardinality(v_picked) >= 6;
        end loop;
      end if;
    end if;

    exit when cardinality(v_picked) > 0;
  end loop;

  if cardinality(v_picked) > 1 then
    v_salt := 0;
    loop
      select array_agg(t.x order by random())
      into v_perm
      from unnest(v_picked) as t(x);

      exit when cardinality(coalesce(v_prev_raw, array[]::uuid[])) = 0;
      exit when cardinality(coalesce(v_prev_raw, array[]::uuid[])) <> cardinality(coalesce(v_perm, array[]::uuid[]));
      exit when v_perm is distinct from v_prev_raw;

      v_salt := v_salt + 1;
      exit when v_salt > 200;
    end loop;

    if v_perm is not null then
      v_picked := v_perm;
    end if;
  end if;

  v_picked := public._discover_apply_super_like_priority(v_viewer, v_my_gender, v_order, v_picked);

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
      insert into public.daily_discover_shown (viewer_user_id, shown_user_id, first_app_day_key, deck_show_count)
      select v_viewer, x, v_day, 1
      from unnest(v_inserted) as u(x)
      on conflict (viewer_user_id, shown_user_id)
      do update set
        deck_show_count = public.daily_discover_shown.deck_show_count + 1;
    end if;
  else
    v_deck := array[]::uuid[];
  end if;

  v_deck := public._discover_apply_super_like_priority(v_viewer, v_my_gender, v_order, v_deck);

  return public._daily_discover_profiles_json(v_viewer, v_day, coalesce(v_deck, array[]::uuid[]));
end;
$$;

-- ── record_profile_interaction：超喜不強配，雙向才 matches ─────────────────
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
        and i.action = 'super_like'
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
        'already_super_liked', true
      );
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
      '對方對你有高度興趣，你會在探索中優先看到他／她。回按愛心才會配對。'
    );
  end if;

  return jsonb_build_object(
    'matched', v_matched,
    'match_id', case when v_matched then v_new_match else null end
  );
end;
$$;

grant execute on function public.record_profile_interaction(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
