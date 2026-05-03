-- ============================================================
-- 034: 探索區域比對正規化
-- 問題：preferred_region 與 work_region / home_region 若不區分大小寫／前後空白，
--       會導致「期望北部 + 對方戶籍／工作為北部」仍 0 人。
-- 修正：
--   1) _daily_discover_candidate_ok：區域比對改為 lower(trim(...))
--   2) get_daily_discover_deck：設定了期望區域時 v_order 使用 lower(trim(...))
--      與上述一致。
-- 語意不變：A 設期望區域 R 時，只出現「對方工作地或戶籍其一為 R」之異性。
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
          or trim(coalesce(p_region, '')) = ''
          or lower(trim(coalesce(p.work_region::text, ''))) = lower(trim(coalesce(p_region, '')))
          or lower(trim(coalesce(p.home_region::text, ''))) = lower(trim(coalesce(p_region, '')))
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

  -- 優先：對方已對我 like／super_like，且符合探索條件（p_exclude_shown=false 可再度出卡）
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

grant execute on function public.get_daily_discover_deck() to authenticated;
