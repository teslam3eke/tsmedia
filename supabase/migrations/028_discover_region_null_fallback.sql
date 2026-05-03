-- ============================================================
-- Migration 028: 探索 — 區域篩選後仍 0 人時，改為不限區域後備
-- 候選函式原本要求 (work_region = r OR home_region = r)；若池內異性
-- 兩欄皆 NULL，會永遠無法入選，探索畫面會是空的。
-- 1) _daily_discover_candidate_ok：p_region IS NULL 時略過地理條件。
-- 2) get_daily_discover_deck：前兩階段後若仍 0 人，第三階段以 null 區域
--    再選一次（仍排除配對、封鎖、暱稱／照片等；並維持不重複優先→可重複）。
-- ============================================================

create or replace function public._daily_discover_candidate_ok(
  p_viewer uuid,
  p_target uuid,
  p_my_gender text,
  p_region text,
  p_exclude_shown boolean default true
)
returns boolean
language sql
stable
as $$
  select
    p_target is not null
    and p_target <> p_viewer
    and exists (
      select 1 from public.profiles p
      where p.id = p_target
        and p.account_status = 'active'
        and p.gender is not null
        and p.gender <> p_my_gender
        and trim(coalesce(p.nickname, p.name, '')) <> ''
        and p.photo_urls is not null
        and cardinality(p.photo_urls) >= 1
        and (
          p_region is null
          or (p.work_region = p_region or p.home_region = p_region)
        )
        and (
          not coalesce(p_exclude_shown, true)
          or not exists (
            select 1 from public.daily_discover_shown s
            where s.viewer_user_id = p_viewer and s.shown_user_id = p_target
          )
        )
        and not exists (
          select 1 from public.matches m
          where (m.user_a = p_viewer and m.user_b = p_target)
             or (m.user_b = p_viewer and m.user_a = p_target)
        )
        and not exists (
          select 1 from public.profile_blocks b
          where (b.blocker_user_id = p_viewer and (
                  b.blocked_user_id = p_target
                  or b.blocked_profile_key = p_target::text
                  or b.blocked_profile_key = ('user:' || p_target::text)
                ))
             or (b.blocker_user_id = p_target and b.blocked_user_id = p_viewer)
        )
    );
$$;

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

  -- 第三階段：依區域仍 0 人（常見於對象 work/home 皆未填）→ 不限區域
  if cardinality(v_picked) = 0 then
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

grant execute on function public.get_daily_discover_deck() to authenticated;
