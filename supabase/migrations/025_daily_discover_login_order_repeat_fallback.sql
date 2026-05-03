-- ============================================================
-- Migration 025: 每日探索 — 登入新鮮度排序 + 不重複優先、不足時可重複
-- 1) 先盡量選「未曾出現在探索」的對象（daily_discover_shown）。
-- 2) 同一區域條件下，依對方 login_last_app_day（新→舊）、updated_at 排序，
--    最近有登入／更新 profile 者較容易出現。
-- 3) 若仍不足 6 人，第二階段放寬為「可含曾出現過的人」，仍排除已配對與封鎖。
-- 4) 清除當日既有快取列，讓已部署環境當天即依新邏輯重建。
-- ============================================================

delete from public.daily_discover_deck
where app_day_key = public.app_day_key_now();

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
        and (p.work_region = p_region or p.home_region = p_region)
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
      return public._daily_discover_profiles_json(coalesce(v_deck, array[]::uuid[]));
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

  -- 第一階段：排除曾出現在探索的人（不重複優先）
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

  -- 第二階段：不足 6 人時允許曾出現過的人（仍排除配對／封鎖等）
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

  return public._daily_discover_profiles_json(coalesce(v_deck, array[]::uuid[]));
end;
$$;

grant execute on function public.get_daily_discover_deck() to authenticated;
