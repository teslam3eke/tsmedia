-- ============================================================
-- Migration 021: 每日探索（每晚 22:00 換日，與 app_day_key_now 一致）
-- 每位使用者每天最多 6 人；優先「對方工作地或戶籍」落在自己 preferred_region，
-- 且排除曾出現在探索過的人；不足時依地理鄰近順序擴到其他區域。
-- ============================================================

create table if not exists public.daily_discover_shown (
  viewer_user_id   uuid not null references auth.users (id) on delete cascade,
  shown_user_id    uuid not null references auth.users (id) on delete cascade,
  first_app_day_key text not null,
  created_at        timestamptz not null default now(),
  primary key (viewer_user_id, shown_user_id)
);

create index if not exists daily_discover_shown_viewer_idx
  on public.daily_discover_shown (viewer_user_id);

create table if not exists public.daily_discover_deck (
  viewer_user_id   uuid not null references auth.users (id) on delete cascade,
  app_day_key      text not null,
  target_user_ids  uuid[] not null,
  built_at         timestamptz not null default now(),
  primary key (viewer_user_id, app_day_key)
);

alter table public.daily_discover_shown enable row level security;
alter table public.daily_discover_deck enable row level security;

-- 僅 service role / security definer 寫入；一般使用者不透過表直讀

create or replace function public._daily_discover_region_order(p_pref text)
returns text[]
language sql
immutable
as $$
  select case coalesce(nullif(trim(p_pref), ''), '_all')
    when 'north'   then array['north','central','south','east']::text[]
    when 'central' then array['central','north','south','east']::text[]
    when 'south'   then array['south','central','north','east']::text[]
    when 'east'    then array['east','north','central','south']::text[]
    else array['north','central','south','east']::text[]
  end;
$$;

create or replace function public._daily_discover_candidate_ok(
  p_viewer uuid,
  p_target uuid,
  p_my_gender text,
  p_region text
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
        and coalesce(p.is_admin, false) = false
        and p.account_status = 'active'
        and p.gender is not null
        and p.gender <> p_my_gender
        and trim(coalesce(p.nickname, p.name, '')) <> ''
        and p.photo_urls is not null
        and cardinality(p.photo_urls) >= 1
        and (p.work_region = p_region or p.home_region = p_region)
        and not exists (
          select 1 from public.daily_discover_shown s
          where s.viewer_user_id = p_viewer and s.shown_user_id = p_target
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

create or replace function public._daily_discover_profiles_json(p_ids uuid[])
returns jsonb
language sql
stable
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
            'show_income_border', coalesce(p.show_income_border, false)
          ) as profile_obj
        from unnest(p_ids) with ordinality as u(uid, ord)
        join public.profiles p on p.id = u.uid
      ) sub
    ),
    '[]'::jsonb
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
    return public._daily_discover_profiles_json(coalesce(v_deck, array[]::uuid[]));
  end if;

  select p.gender::text, p.preferred_region::text
  into v_my_gender, v_pref
  from public.profiles p
  where p.id = v_viewer;

  if v_my_gender is null then
    insert into public.daily_discover_deck (viewer_user_id, app_day_key, target_user_ids)
    values (v_viewer, v_day, array[]::uuid[])
    on conflict (viewer_user_id, app_day_key) do nothing;
    select d.target_user_ids into v_deck
    from public.daily_discover_deck d
    where d.viewer_user_id = v_viewer and d.app_day_key = v_day;
    return public._daily_discover_profiles_json(coalesce(v_deck, array[]::uuid[]));
  end if;

  v_order := public._daily_discover_region_order(v_pref);

  foreach r in array v_order loop
    exit when cardinality(v_picked) >= 6;
    v_need := 6 - cardinality(v_picked);
    for r_pick in
      select p.id
      from public.profiles p
      where public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, r)
      order by md5(p.id::text || v_day)
      limit v_need
    loop
      v_picked := v_picked || r_pick;
      exit when cardinality(v_picked) >= 6;
    end loop;
  end loop;

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

  return public._daily_discover_profiles_json(coalesce(v_deck, array[]::uuid[]));
end;
$$;

grant execute on function public.get_daily_discover_deck() to authenticated;
