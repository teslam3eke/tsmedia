-- 天選之人：僅指派 Golden 分 ≥ 9（緣分共鳴 90% 以上；排名 1–2）
-- golden_score = 11 - rank；7→70% 等較低 Golden 組不再進天選批次。

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

  -- ① 天選（golden_score ≥ 9 → UI 緣分共鳴 ≥ 90%）
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

notify pgrst, 'reload schema';
