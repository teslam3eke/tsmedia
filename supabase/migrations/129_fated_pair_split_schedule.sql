-- 129：天選／地選拆日排程（互不閘門、互不綁定）
-- app 日（台北 22:00 換日）：
--   週四 app 日 → 僅地選之人（dow=4）
--   週五 app 日 → 僅天選之人（dow=5）
-- 本地測試：fated_pair_any_day（兩者同日）或 fated_pair_any_day_heaven / fated_pair_any_day_earth（分開測）

insert into public.app_feature_flags (key, enabled)
values
  ('fated_pair_any_day_heaven', false),
  ('fated_pair_any_day_earth', false)
on conflict (key) do nothing;

create or replace function public._fated_pair_app_day_dow(p_app_day text)
returns integer
language sql
immutable
as $$
  select extract(dow from to_date(p_app_day, 'YYYY-MM-DD'))::integer;
$$;

create or replace function public.fated_pair_heaven_active_for_day(p_app_day text default public.app_day_key_now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public._fated_pair_flag('fated_pair_enabled')
    and (
      public._fated_pair_flag('fated_pair_any_day')
      or public._fated_pair_flag('fated_pair_any_day_heaven')
      or public._fated_pair_app_day_dow(p_app_day) = 5
    );
$$;

create or replace function public.fated_pair_earth_active_for_day(p_app_day text default public.app_day_key_now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public._fated_pair_flag('fated_pair_enabled')
    and (
      public._fated_pair_flag('fated_pair_any_day')
      or public._fated_pair_flag('fated_pair_any_day_earth')
      or public._fated_pair_app_day_dow(p_app_day) = 4
    );
$$;

create or replace function public.fated_pair_active_now()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.fated_pair_heaven_active_for_day(public.app_day_key_now())
    or public.fated_pair_earth_active_for_day(public.app_day_key_now());
$$;

create or replace function public.fated_pair_run_batch(p_app_day text default public.app_day_key_now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_day text := coalesce(nullif(btrim(p_app_day), ''), public.app_day_key_now());
  v_heaven_on boolean := public.fated_pair_heaven_active_for_day(v_day);
  v_earth_on boolean := public.fated_pair_earth_active_for_day(v_day);
  v_heaven_pairs int := 0;
  v_earth_pairs int := 0;
  r record;
begin
  if not v_heaven_on and not v_earth_on then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  if exists (select 1 from public.fated_pair_batch_runs br where br.app_day_key = v_day) then
    select count(*)::int / 2 into v_heaven_pairs
    from public.fated_pair_assignments a
    where a.app_day_key = v_day and a.kind = 'heaven';
    select count(*)::int / 2 into v_earth_pairs
    from public.fated_pair_assignments a
    where a.app_day_key = v_day and a.kind = 'earth';
    return jsonb_build_object(
      'ok', true,
      'already_ran', true,
      'heaven_active', v_heaven_on,
      'earth_active', v_earth_on,
      'heaven_pairs', v_heaven_pairs,
      'earth_pairs', v_earth_pairs
    );
  end if;

  create temp table tmp_fated_used (user_id uuid primary key) on commit drop;
  create temp table tmp_fated_mutual (
    user_a uuid not null,
    user_b uuid not null,
    score int not null,
    interest_overlap int not null default 0
  ) on commit drop;

  if v_heaven_on then
    insert into tmp_fated_mutual (user_a, user_b, score, interest_overlap)
    with pool as (
      select p.id, p.gender, p.mbti_type
      from public.profiles p
      where public._fated_pair_profile_pool_ok(p.id)
    ),
    directed as (
      select
        a.id as user_id,
        b.id as partner_id,
        public._fated_pair_mbti_golden_score(a.mbti_type, b.mbti_type) as golden_score,
        public._fated_pair_interest_overlap(a.id, b.id) as interest_overlap
      from pool a
      join pool b on b.id <> a.id
      where a.gender <> b.gender
        and public._fated_pair_bidirectional_region_ok(a.id, b.id)
        and public._fated_pair_interest_overlap(a.id, b.id) >= 1
        and public._fated_pair_mbti_golden_score(a.mbti_type, b.mbti_type) >= 9
    ),
    best as (
      select distinct on (d.user_id)
        d.user_id,
        d.partner_id,
        d.golden_score,
        d.interest_overlap
      from directed d
      order by d.user_id, d.golden_score desc, d.interest_overlap desc, d.partner_id
    )
    select
      least(ba.user_id, ba.partner_id),
      greatest(ba.user_id, ba.partner_id),
      ba.golden_score,
      ba.interest_overlap
    from best ba
    join best bb
      on ba.user_id = bb.partner_id
     and ba.partner_id = bb.user_id
    where ba.user_id < ba.partner_id;

    for r in
      select *
      from tmp_fated_mutual
      order by score desc, interest_overlap desc, user_a, user_b
    loop
      if exists (select 1 from tmp_fated_used u where u.user_id in (r.user_a, r.user_b)) then
        continue;
      end if;
      insert into public.fated_pair_assignments (
        app_day_key, user_id, kind, partner_user_id, golden_score, challenge_score, interest_overlap
      ) values
        (v_day, r.user_a, 'heaven', r.user_b, r.score, null, r.interest_overlap),
        (v_day, r.user_b, 'heaven', r.user_a, r.score, null, r.interest_overlap);
      insert into tmp_fated_used (user_id) values (r.user_a), (r.user_b)
      on conflict do nothing;
    end loop;

    truncate tmp_fated_mutual;
    truncate tmp_fated_used;
  end if;

  if v_earth_on then
    insert into tmp_fated_mutual (user_a, user_b, score, interest_overlap)
    with pool as (
      select p.id, p.gender, p.mbti_type
      from public.profiles p
      where public._fated_pair_profile_pool_ok(p.id)
    ),
    directed as (
      select
        a.id as user_id,
        b.id as partner_id,
        public._fated_pair_mbti_challenge_score(a.mbti_type, b.mbti_type) as challenge_score
      from pool a
      join pool b on b.id <> a.id
      where a.gender <> b.gender
        and public._fated_pair_bidirectional_region_ok(a.id, b.id)
        and public._fated_pair_interest_overlap(a.id, b.id) = 0
        and public._fated_pair_mbti_challenge_score(a.mbti_type, b.mbti_type) > 0
    ),
    best as (
      select distinct on (d.user_id)
        d.user_id,
        d.partner_id,
        d.challenge_score
      from directed d
      order by d.user_id, d.challenge_score desc, d.partner_id
    )
    select
      least(ba.user_id, ba.partner_id),
      greatest(ba.user_id, ba.partner_id),
      ba.challenge_score,
      0
    from best ba
    join best bb
      on ba.user_id = bb.partner_id
     and ba.partner_id = bb.user_id
    where ba.user_id < ba.partner_id;

    for r in
      select *
      from tmp_fated_mutual
      order by score desc, user_a, user_b
    loop
      if exists (select 1 from tmp_fated_used u where u.user_id in (r.user_a, r.user_b)) then
        continue;
      end if;
      insert into public.fated_pair_assignments (
        app_day_key, user_id, kind, partner_user_id, golden_score, challenge_score, interest_overlap
      ) values
        (v_day, r.user_a, 'earth', r.user_b, null, r.score, 0),
        (v_day, r.user_b, 'earth', r.user_a, null, r.score, 0);
      insert into tmp_fated_used (user_id) values (r.user_a), (r.user_b)
      on conflict do nothing;
    end loop;
  end if;

  insert into public.fated_pair_batch_runs (app_day_key) values (v_day);
  delete from public.daily_discover_deck where app_day_key = v_day;

  select count(*)::int / 2 into v_heaven_pairs
  from public.fated_pair_assignments a
  where a.app_day_key = v_day and a.kind = 'heaven';

  select count(*)::int / 2 into v_earth_pairs
  from public.fated_pair_assignments a
  where a.app_day_key = v_day and a.kind = 'earth';

  return jsonb_build_object(
    'ok', true,
    'already_ran', false,
    'heaven_active', v_heaven_on,
    'earth_active', v_earth_on,
    'heaven_pairs', v_heaven_pairs,
    'earth_pairs', v_earth_pairs
  );
end;
$$;

create or replace function public.fated_pair_poll()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day text := public.app_day_key_now();
  v_heaven_on boolean := public.fated_pair_heaven_active_for_day(v_day);
  v_earth_on boolean := public.fated_pair_earth_active_for_day(v_day);
  v_active boolean := v_heaven_on or v_earth_on;
  v_batch jsonb;
  v_forever boolean := false;
  v_heaven_partner uuid;
  v_earth_partner uuid;
  v_heaven_golden int;
  v_heaven_overlap int;
  v_earth_challenge int;
  v_heaven_partner_json jsonb;
  v_earth_partner_json jsonb;
  v_heaven_dismissed boolean := false;
  v_heaven_accepted_at timestamptz;
  v_earth_dismissed boolean := false;
  v_earth_accepted_at timestamptz;
  v_show_heaven boolean := false;
  v_show_earth boolean := false;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not v_active then
    return jsonb_build_object(
      'active', false,
      'app_day_key', v_day
    );
  end if;

  v_batch := public.fated_pair_run_batch(v_day);

  select coalesce(p.fated_heaven_dismissed_forever, false)
  into v_forever
  from public.profiles p
  where p.id = v_user;

  select s.heaven_dismissed, s.heaven_accepted_at, s.earth_dismissed, s.earth_accepted_at
  into v_heaven_dismissed, v_heaven_accepted_at, v_earth_dismissed, v_earth_accepted_at
  from public.fated_pair_user_day_state s
  where s.user_id = v_user and s.app_day_key = v_day;

  select
    a.partner_user_id,
    a.golden_score,
    a.interest_overlap,
    public._fated_pair_partner_json(v_user, a.partner_user_id)
  into v_heaven_partner, v_heaven_golden, v_heaven_overlap, v_heaven_partner_json
  from public.fated_pair_assignments a
  where a.app_day_key = v_day
    and a.user_id = v_user
    and a.kind = 'heaven';

  select
    a.partner_user_id,
    a.challenge_score,
    public._fated_pair_partner_json(v_user, a.partner_user_id)
  into v_earth_partner, v_earth_challenge, v_earth_partner_json
  from public.fated_pair_assignments a
  where a.app_day_key = v_day
    and a.user_id = v_user
    and a.kind = 'earth';

  if v_heaven_on
     and v_heaven_partner is not null
     and not v_forever
     and not coalesce(v_heaven_dismissed, false)
     and v_heaven_accepted_at is null then
    v_show_heaven := true;
  end if;

  if v_earth_on
     and v_earth_partner is not null
     and not coalesce(v_earth_dismissed, false)
     and v_earth_accepted_at is null then
    v_show_earth := true;
  end if;

  return jsonb_build_object(
    'active', true,
    'app_day_key', v_day,
    'heaven_active', v_heaven_on,
    'earth_active', v_earth_on,
    'batch', v_batch,
    'heaven_dismissed_forever', v_forever,
    'show_heaven', v_show_heaven,
    'show_earth', v_show_earth,
    'heaven', case when v_heaven_partner is null then null else jsonb_build_object(
      'partner_user_id', v_heaven_partner,
      'golden_score', v_heaven_golden,
      'interest_overlap', v_heaven_overlap,
      'dismissed_today', coalesce(v_heaven_dismissed, false),
      'accepted', v_heaven_accepted_at is not null,
      'partner', v_heaven_partner_json
    ) end,
    'earth', case when v_earth_partner is null then null else jsonb_build_object(
      'partner_user_id', v_earth_partner,
      'challenge_score', v_earth_challenge,
      'dismissed_today', coalesce(v_earth_dismissed, false),
      'accepted', v_earth_accepted_at is not null,
      'partner', v_earth_partner_json
    ) end
  );
end;
$$;

comment on function public.fated_pair_poll() is
  '週五 app 日天選、週四 app 日地選；首次 poll 觸發當日批次；兩者互不閘門。';

notify pgrst, 'reload schema';
