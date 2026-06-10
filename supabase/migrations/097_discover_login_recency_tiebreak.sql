-- 097：探索 deck — 候選條件相同時，最近登入（login_last_app_day）者優先入選
-- 保留 060 隨機／093 超喜額外槽／091 incoming like 等既有邏輯；僅在 ORDER BY 加入登入新鮮度。
-- 套用當日清空快取 deck，讓已部署環境當天即依新排序重建。

delete from public.daily_discover_deck
where app_day_key = public.app_day_key_now();

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
          max(i.created_at) as mx
        from public.profile_interactions i
        where i.action = 'like'
          and i.actor_user_id is not null
          and i.actor_user_id <> v_viewer
          and (
            i.target_user_id = v_viewer
            or i.target_profile_key = v_viewer::text
            or i.target_profile_key = ('user:' || v_viewer::text)
          )
        group by i.actor_user_id
      ) q
      inner join public.profiles p_in on p_in.id = q.actor_uid
      where exists (
        select 1
        from (select unnest(v_order) as region) ord
        where public._daily_discover_candidate_ok(v_viewer, q.actor_uid, v_my_gender, ord.region, false)
      )
      order by
        q.mx desc,
        p_in.login_last_app_day desc nulls last,
        p_in.updated_at desc nulls last
    loop
      exit when cardinality(v_picked) >= 6;
      if not (incoming_uid = any(v_picked)) then
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
        order by
          p.login_last_app_day desc nulls last,
          p.updated_at desc nulls last,
          -ln((random() * 0.9999999999999999 + 1e-15)::float8)
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
              ),
            p.login_last_app_day desc nulls last,
            p.updated_at desc nulls last
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
        order by
          p.login_last_app_day desc nulls last,
          p.updated_at desc nulls last,
          -ln((random() * 0.9999999999999999 + 1e-15)::float8)
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
              ),
            p.login_last_app_day desc nulls last,
            p.updated_at desc nulls last
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

notify pgrst, 'reload schema';
