-- ============================================================
-- 060: 探索每日牌組 — 可重複但隔天順序不同 + 重複越多權重越低
--
-- 1) daily_discover_shown.deck_show_count：同一 viewer 對同一對象
--    每次被排進當日牌組時 +1（曾出現過的探索人次）。
-- 2) 「新面孔」階段（_daily_discover_candidate_ok … true）：候選以均匀隨機
--    （exponential race）決定入選順序，不再依 login_last_app_day 固定排序。
-- 3) 僅在「允許重複」候選（… false）以加權隨機：權重 ∝ 1/(1+n)^2，n = deck_show_count。
-- 4) 牌組排出後以 random() 洗牌；若與「前一 app 日」順序完全相同則重抽，
--    盡量避免連日同序（人數極少時可能無法避免）。
-- ============================================================

alter table public.daily_discover_shown
  add column if not exists deck_show_count int not null default 1;

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
  v_prev_deck uuid[];
  v_inserted uuid[];
  r text;
  r_pick uuid;
  incoming_uid uuid;
  v_need int;
  v_deck uuid[];
  v_strict_pref boolean;
  v_salt int;
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

  -- 全牌組 random() 洗牌（含新面孔／來電／重複）；若與上一 app 日順序完全相同則重洗。
  if cardinality(v_picked) > 1 then
    v_prev_day := to_char((to_date(v_day, 'YYYY-MM-DD') - 1)::date, 'YYYY-MM-DD');
    select d.target_user_ids into v_prev_deck
    from public.daily_discover_deck d
    where d.viewer_user_id = v_viewer and d.app_day_key = v_prev_day;

    v_salt := 0;
    loop
      select array_agg(t.x order by random())
      into v_perm
      from unnest(v_picked) as t(x);

      exit when v_prev_deck is null;
      exit when cardinality(coalesce(v_prev_deck, array[]::uuid[])) <> cardinality(coalesce(v_perm, array[]::uuid[]));
      exit when v_perm is distinct from v_prev_deck;

      v_salt := v_salt + 1;
      exit when v_salt > 200;
    end loop;

    if v_perm is not null then
      v_picked := v_perm;
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

  return public._daily_discover_profiles_json(v_viewer, v_day, coalesce(v_deck, array[]::uuid[]));
end;
$$;

notify pgrst, 'reload schema';
