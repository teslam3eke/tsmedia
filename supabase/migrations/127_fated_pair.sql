-- 127：週五天選／地選（Golden Pairs + 挑戰組合、互選指派、deck 排除）
-- 本地測試：
--   update app_feature_flags set enabled = true where key in ('fated_pair_enabled', 'fated_pair_any_day');
--   雙方須有有效 MBTI 且在 Golden／Challenge 表上才會被指派。

insert into public.app_feature_flags (key, enabled)
values ('fated_pair_enabled', false)
on conflict (key) do nothing;

insert into public.app_feature_flags (key, enabled)
values ('fated_pair_any_day', false)
on conflict (key) do nothing;

-- ── MBTI 相容表 ─────────────────────────────────────────────

create table if not exists public.mbti_compat_golden (
  type_a text not null,
  type_b text not null,
  rank int not null check (rank between 1 and 10),
  primary key (type_a, type_b),
  check (type_a < type_b)
);

create table if not exists public.mbti_compat_challenge (
  type_a text not null,
  type_b text not null,
  rank int not null check (rank between 1 and 10),
  primary key (type_a, type_b),
  check (type_a < type_b)
);

truncate public.mbti_compat_golden;
insert into public.mbti_compat_golden (type_a, type_b, rank) values
  ('ENFP', 'INFJ', 1),
  ('ENFJ', 'INFP', 2),
  ('ENTJ', 'INTP', 3),
  ('ENFP', 'INTJ', 4),
  ('ENTP', 'INFJ', 5),
  ('ESTP', 'ISFJ', 6),
  ('ESFP', 'ISTJ', 7),
  ('ESTJ', 'ISTP', 8),
  ('ESFJ', 'ISFP', 9),
  ('ENTP', 'INTJ', 10);

truncate public.mbti_compat_challenge;
insert into public.mbti_compat_challenge (type_a, type_b, rank) values
  ('ESFP', 'INTJ', 1),
  ('ESFJ', 'INTP', 2),
  ('ESTJ', 'INFP', 3),
  ('ENFP', 'ISTJ', 4),
  ('ESTP', 'INFJ', 5),
  ('ENTJ', 'ISFP', 6),
  ('ENFJ', 'ISTP', 7),
  ('ESTP', 'INFP', 9);

-- ── 指派與使用者狀態 ─────────────────────────────────────────

create table if not exists public.fated_pair_batch_runs (
  app_day_key text primary key,
  ran_at timestamptz not null default now()
);

create table if not exists public.fated_pair_assignments (
  app_day_key text not null,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('heaven', 'earth')),
  partner_user_id uuid not null references auth.users on delete cascade,
  golden_score int,
  challenge_score int,
  interest_overlap int not null default 0,
  assigned_at timestamptz not null default now(),
  primary key (app_day_key, user_id, kind),
  check (user_id <> partner_user_id)
);

create index if not exists fated_pair_assignments_day_partner_idx
  on public.fated_pair_assignments (app_day_key, partner_user_id);

alter table public.profiles
  add column if not exists fated_heaven_dismissed_forever boolean not null default false;

create table if not exists public.fated_pair_user_day_state (
  user_id uuid not null references auth.users on delete cascade,
  app_day_key text not null,
  heaven_dismissed boolean not null default false,
  heaven_accepted_at timestamptz,
  earth_dismissed boolean not null default false,
  earth_accepted_at timestamptz,
  primary key (user_id, app_day_key)
);

alter table public.fated_pair_batch_runs enable row level security;
alter table public.fated_pair_assignments enable row level security;
alter table public.fated_pair_user_day_state enable row level security;

drop policy if exists "fated_assignments: own read" on public.fated_pair_assignments;
create policy "fated_assignments: own read"
  on public.fated_pair_assignments for select
  using (user_id = auth.uid());

drop policy if exists "fated_day_state: own read" on public.fated_pair_user_day_state;
create policy "fated_day_state: own read"
  on public.fated_pair_user_day_state for select
  using (user_id = auth.uid());

-- ── Helpers ───────────────────────────────────────────────────

create or replace function public._fated_pair_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select f.enabled from public.app_feature_flags f where f.key = p_key),
    false
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
    public._fated_pair_flag('fated_pair_enabled')
    and (
      public._fated_pair_flag('fated_pair_any_day')
      or extract(dow from to_date(public.app_day_key_now(), 'YYYY-MM-DD')) = 5
    );
$$;

create or replace function public._fated_pair_region_matches(
  p_pref text,
  p_work text,
  p_home text
)
returns boolean
language sql
immutable
as $$
  select
    p_pref is null
    or btrim(p_pref) = ''
    or lower(btrim(p_pref)) = lower(btrim(coalesce(p_work, '')))
    or lower(btrim(p_pref)) = lower(btrim(coalesce(p_home, '')));
$$;

create or replace function public._fated_pair_bidirectional_region_ok(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public._fated_pair_region_matches(pa.preferred_region, pb.work_region, pb.home_region)
    and public._fated_pair_region_matches(pb.preferred_region, pa.work_region, pa.home_region)
  from public.profiles pa
  join public.profiles pb on pb.id = p_b
  where pa.id = p_a;
$$;

create or replace function public._fated_pair_interest_overlap(p_a uuid, p_b uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select count(*)::int
      from unnest(coalesce(pa.interests, array[]::text[])) x
      where x = any(coalesce(pb.interests, array[]::text[]))
    ),
    0
  )
  from public.profiles pa
  join public.profiles pb on pb.id = p_b
  where pa.id = p_a;
$$;

create or replace function public._fated_pair_mbti_golden_score(p_a text, p_b text)
returns int
language sql
stable
as $$
  select coalesce(
    (
      select (11 - g.rank)::int
      from public.mbti_compat_golden g
      where g.type_a = least(p_a, p_b)
        and g.type_b = greatest(p_a, p_b)
        and p_a ~ '^[EI][NS][FT][JP]$'
        and p_b ~ '^[EI][NS][FT][JP]$'
    ),
    0
  );
$$;

create or replace function public._fated_pair_mbti_challenge_score(p_a text, p_b text)
returns int
language sql
stable
as $$
  select coalesce(
    (
      select (11 - c.rank)::int
      from public.mbti_compat_challenge c
      where c.type_a = least(p_a, p_b)
        and c.type_b = greatest(p_a, p_b)
        and p_a ~ '^[EI][NS][FT][JP]$'
        and p_b ~ '^[EI][NS][FT][JP]$'
    ),
    0
  );
$$;

create or replace function public._fated_pair_profile_pool_ok(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_id
      and p.account_status = 'active'
      and p.gender is not null
      and trim(coalesce(p.nickname, p.name, '')) <> ''
      and p.photo_urls is not null
      and cardinality(p.photo_urls) >= 1
      and p.mbti_type ~ '^[EI][NS][FT][JP]$'
      and coalesce(cardinality(p.interests), 0) >= 1
  );
$$;

create or replace function public._fated_pair_partner_json(p_viewer uuid, p_partner uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'nickname', p.nickname,
    'name', p.name,
    'gender', p.gender,
    'age', p.age,
    'mbti_type', p.mbti_type,
    'company', p.company,
    'job_title', p.job_title,
    'department', p.department,
    'bio', p.bio,
    'interests', coalesce(to_jsonb(p.interests), '[]'::jsonb),
    'photo_urls', coalesce(to_jsonb(p.photo_urls), '[]'::jsonb),
    'work_region', p.work_region,
    'home_region', p.home_region
  )
  from public.profiles p
  where p.id = p_partner;
$$;

-- ── 批次指派（天選互選 → 地選互選）────────────────────────────

create or replace function public.fated_pair_run_batch(p_app_day text default public.app_day_key_now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_day text := coalesce(nullif(btrim(p_app_day), ''), public.app_day_key_now());
  v_heaven_pairs int := 0;
  v_earth_pairs int := 0;
  r record;
begin
  if not public.fated_pair_active_now() then
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

  -- ① 天選
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
      and public._fated_pair_mbti_golden_score(a.mbti_type, b.mbti_type) > 0
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

  -- ② 地選（不可與當日天選同一人）
  insert into tmp_fated_mutual (user_a, user_b, score, interest_overlap)
  with pool as (
    select p.id, p.gender, p.mbti_type
    from public.profiles p
    where public._fated_pair_profile_pool_ok(p.id)
  ),
  heaven_partner as (
    select fa.user_id, fa.partner_user_id
    from public.fated_pair_assignments fa
    where fa.app_day_key = v_day and fa.kind = 'heaven'
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
      and not exists (
        select 1 from heaven_partner hp
        where hp.user_id = a.id and hp.partner_user_id = b.id
      )
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
    'heaven_pairs', v_heaven_pairs,
    'earth_pairs', v_earth_pairs
  );
end;
$$;

-- ── 扣愛心 + 記錄 like（天選 3／地選 1）──────────────────────

create or replace function public._fated_pair_spend_hearts_and_like(
  p_target uuid,
  p_hearts int,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_balance int;
  v_new_bal int;
  v_matched boolean := false;
  v_match_id uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_day text := public.app_day_key_now();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if p_target is null or p_target = v_actor then
    raise exception 'Invalid target';
  end if;
  if p_hearts < 1 then
    raise exception 'Invalid heart cost';
  end if;

  v_balance := public._credit_balance(v_actor, 'heart');
  if v_balance < p_hearts then
    raise exception 'INSUFFICIENT_HEART';
  end if;

  v_new_bal := v_balance - p_hearts;
  insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
  values (v_actor, 'spend', 'heart', -p_hearts, v_new_bal, p_description);

  insert into public.profile_interactions (
    actor_user_id, target_user_id, target_profile_key, action, interaction_app_day_key
  ) values (
    v_actor, p_target, p_target::text, 'like', v_day
  )
  on conflict (actor_user_id, target_profile_key, interaction_app_day_key)
  do update set action = excluded.action, target_user_id = excluded.target_user_id;

  if exists (
    select 1 from public.profile_interactions i
    where i.actor_user_id = p_target
      and i.action in ('like', 'super_like')
      and (
        i.target_user_id = v_actor
        or i.target_profile_key = v_actor::text
        or i.target_profile_key = ('user:' || v_actor::text)
      )
  ) then
    v_user_a := least(v_actor, p_target);
    v_user_b := greatest(v_actor, p_target);
    insert into public.matches (user_a, user_b)
    values (v_user_a, v_user_b)
    on conflict (user_a, user_b) do nothing
    returning id into v_match_id;
    if v_match_id is not null then
      v_matched := true;
      insert into public.app_notifications (user_id, kind, title, body)
      values
        (v_actor, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
        (p_target, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
    else
      select m.id into v_match_id
      from public.matches m
      where m.user_a = v_user_a and m.user_b = v_user_b;
      v_matched := v_match_id is not null;
    end if;
  end if;

  return jsonb_build_object(
    'matched', v_matched,
    'match_id', v_match_id,
    'heart_balance', v_new_bal
  );
end;
$$;

-- ── Poll / dismiss / accept ───────────────────────────────────

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
  v_active boolean := public.fated_pair_active_now();
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

  if v_heaven_partner is not null
     and not v_forever
     and not coalesce(v_heaven_dismissed, false)
     and v_heaven_accepted_at is null then
    v_show_heaven := true;
  end if;

  if not v_show_heaven
     and v_earth_partner is not null
     and not coalesce(v_earth_dismissed, false)
     and v_earth_accepted_at is null then
    v_show_earth := true;
  end if;

  return jsonb_build_object(
    'active', true,
    'app_day_key', v_day,
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

create or replace function public.fated_pair_dismiss_heaven(p_forever boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day text := public.app_day_key_now();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  insert into public.fated_pair_user_day_state (user_id, app_day_key, heaven_dismissed)
  values (v_user, v_day, true)
  on conflict (user_id, app_day_key)
  do update set heaven_dismissed = true;

  if coalesce(p_forever, false) then
    update public.profiles
    set fated_heaven_dismissed_forever = true
    where id = v_user;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fated_pair_dismiss_earth()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day text := public.app_day_key_now();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  insert into public.fated_pair_user_day_state (user_id, app_day_key, earth_dismissed)
  values (v_user, v_day, true)
  on conflict (user_id, app_day_key)
  do update set earth_dismissed = true;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fated_pair_accept_heaven()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day text := public.app_day_key_now();
  v_partner uuid;
  v_like jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select a.partner_user_id into v_partner
  from public.fated_pair_assignments a
  where a.app_day_key = v_day and a.user_id = v_user and a.kind = 'heaven';

  if v_partner is null then
    raise exception 'NO_HEAVEN_ASSIGNMENT';
  end if;

  v_like := public._fated_pair_spend_hearts_and_like(v_partner, 3, '天選之人：送出愛心');

  insert into public.fated_pair_user_day_state (user_id, app_day_key, heaven_accepted_at)
  values (v_user, v_day, now())
  on conflict (user_id, app_day_key)
  do update set heaven_accepted_at = coalesce(fated_pair_user_day_state.heaven_accepted_at, excluded.heaven_accepted_at);

  return v_like || jsonb_build_object('ok', true, 'kind', 'heaven');
end;
$$;

create or replace function public.fated_pair_accept_earth()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day text := public.app_day_key_now();
  v_partner uuid;
  v_like jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select a.partner_user_id into v_partner
  from public.fated_pair_assignments a
  where a.app_day_key = v_day and a.user_id = v_user and a.kind = 'earth';

  if v_partner is null then
    raise exception 'NO_EARTH_ASSIGNMENT';
  end if;

  v_like := public._fated_pair_spend_hearts_and_like(v_partner, 1, '地選之人：送出愛心');

  insert into public.fated_pair_user_day_state (user_id, app_day_key, earth_accepted_at)
  values (v_user, v_day, now())
  on conflict (user_id, app_day_key)
  do update set earth_accepted_at = coalesce(fated_pair_user_day_state.earth_accepted_at, excluded.earth_accepted_at);

  return v_like || jsonb_build_object('ok', true, 'kind', 'earth');
end;
$$;

-- ── 探索 deck 排除當日天選／地選對象 ─────────────────────────

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
    )
    and (
      not public.fated_pair_active_now()
      or not exists (
        select 1 from public.fated_pair_assignments fa
        where fa.app_day_key = public.app_day_key_now()
          and fa.user_id = p_viewer
          and fa.partner_user_id = p_target
      )
    );
$$;

grant execute on function public.fated_pair_active_now() to authenticated;
grant execute on function public.fated_pair_run_batch(text) to authenticated;
grant execute on function public.fated_pair_poll() to authenticated;
grant execute on function public.fated_pair_dismiss_heaven(boolean) to authenticated;
grant execute on function public.fated_pair_dismiss_earth() to authenticated;
grant execute on function public.fated_pair_accept_heaven() to authenticated;
grant execute on function public.fated_pair_accept_earth() to authenticated;

comment on function public.fated_pair_poll() is
  '週五天選／地選：首次 poll 觸發當日批次指派；回傳是否顯示 heaven／earth 彈窗。';

notify pgrst, 'reload schema';
