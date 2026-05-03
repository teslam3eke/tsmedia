-- ============================================================
-- 038: 探索 — incoming 迴圈 unnest 寫法修正（避免 PG 42601）
--
-- 問題：`from unnest(v_order) as ord(region text)` 在部分執行路徑
--       （含 PostgREST 呼叫、PL/pgSQL 內層查詢）可能觸發
--       "a column definition list is only allowed for functions returning record"。
-- 修正：改為 `from (select unnest(v_order) as region) ord`（語意不變）。
--
-- 前置：036 已將實作更名為 public.__get_daily_discover_deck_impl。
-- get_daily_discover_deck / get_daily_discover_deck_v2 的 sql 包裝仍呼叫此函式。
-- ============================================================

create or replace function public.__get_daily_discover_deck_impl()
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
  v_pref_norm text;
  v_order text[];
  v_picked uuid[] := array[]::uuid[];
  v_inserted uuid[];
  r text;
  r_pick uuid;
  incoming_uid uuid;
  v_need int;
  v_deck uuid[];
  v_strict_pref boolean;
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

  v_strict_pref := v_pref is not null and btrim(v_pref) <> '';
  v_pref_norm := lower(trim(btrim(coalesce(v_pref, ''))));

  if v_strict_pref then
    v_order := array[v_pref_norm];
  else
    v_order := public._daily_discover_region_order(v_pref);
  end if;

  for incoming_uid in
    select q.actor_uid
    from (
      select
        i.actor_user_id as actor_uid,
        max(i.created_at) as mx
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
    order by q.mx desc
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

  if cardinality(v_picked) = 0 and not v_strict_pref then
    v_need := 6;
    for r_pick in
      select p.id
      from public.profiles p
      where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, null::text, true)
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

    if cardinality(v_picked) < 6 then
      v_need := 6 - cardinality(v_picked);
      for r_pick in
        select p.id
        from public.profiles p
        where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, null::text, false)
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
    end if;
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

notify pgrst, 'reload schema';
