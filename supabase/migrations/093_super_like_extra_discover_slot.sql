-- 093：超級喜歡 → 探索 deck 在原本 6 人之外「額外 +1」（不替換、不佔 base 槽）
-- - 新函式 _discover_incoming_super_like_ok：僅保留安全條件（封鎖／已配對／異性／有效 profile），
--   不受區域、昨日 deck 排除、daily_discover_shown 影響。
-- - _discover_apply_super_like_priority：合併 deck 外的新超喜者，上限 6 + 新超喜人數（非截斷回 6）。
-- - __get_daily_discover_deck_impl：base 6 的 incoming 優先池僅含 like（超喜改由 apply 追加）。

create or replace function public._discover_incoming_super_like_ok(
  p_viewer uuid,
  p_target uuid,
  p_my_gender text
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
    );
$$;

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
  v_max int;
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
  where public._discover_incoming_super_like_ok(p_viewer, q.actor_uid, p_my_gender);

  v_max := 6 + cardinality(coalesce(v_new_super, array[]::uuid[]));
  v_combined := coalesce(v_new_super, array[]::uuid[]) || v_deck;

  foreach r in array v_combined loop
    if r is null or r = any(v_out) then
      continue;
    end if;
    v_out := array_append(v_out, r);
    exit when cardinality(v_out) >= v_max;
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

    -- 093：base 6 的 incoming 優先僅 like；super_like 由 _discover_apply_super_like_priority 額外追加
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

notify pgrst, 'reload schema';
