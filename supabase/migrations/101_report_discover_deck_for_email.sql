-- 101：營運診斷 — 查指定 viewer 的 daily_discover_deck（依 app 日）
-- App 日與探索換日一致：台北時間每晚 22:00 換日（app_day_key_now）。
--
-- 用法（Supabase SQL Editor）：
--   select * from public.report_discover_deck_for_email('teslam3eke@gmail.com');
--   select * from public.report_discover_deck_for_email('teslam3eke@gmail.com', '2026-06-09');

create or replace function public.report_discover_deck_for_email(
  p_email text,
  p_app_day text default null
)
returns table (
  viewer_email text,
  viewer_user_id uuid,
  app_day_key_now text,
  deck_app_day_key text,
  deck_built_at timestamptz,
  slot int,
  target_user_id uuid,
  target_email text,
  target_nickname text,
  target_name text,
  founding_member_no smallint,
  target_gender text
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select u.id as uid, lower(u.email) as em
    from auth.users u
    where lower(u.email) = lower(trim(p_email))
    limit 1
  ),
  days as (
    select
      v.uid,
      v.em,
      public.app_day_key_now() as today_key,
      coalesce(nullif(trim(p_app_day), ''), public.app_day_key_now()) as filter_day
    from viewer v
  ),
  deck as (
    select d.*
    from public.daily_discover_deck d
    join days x on x.uid = d.viewer_user_id
    where p_app_day is null
       or d.app_day_key = x.filter_day
    order by d.app_day_key desc
    limit case when p_app_day is null then 8 else 1 end
  )
  select
    d.em as viewer_email,
    d.uid as viewer_user_id,
    d.today_key as app_day_key_now,
    dk.app_day_key as deck_app_day_key,
    dk.built_at as deck_built_at,
    ord.ordinality::int as slot,
    tgt.uid as target_user_id,
    tu.email as target_email,
    coalesce(nullif(trim(pt.nickname), ''), nullif(trim(pt.name), '')) as target_nickname,
    pt.name as target_name,
    pt.founding_member_no,
    pt.gender::text as target_gender
  from days d
  join deck dk on dk.viewer_user_id = d.uid
  cross join lateral unnest(dk.target_user_ids) with ordinality as tgt(uid, ordinality)
  left join auth.users tu on tu.id = tgt.uid
  left join public.profiles pt on pt.id = tgt.uid
  order by dk.app_day_key desc, ord.ordinality;
$$;

revoke all on function public.report_discover_deck_for_email(text, text) from public;
grant execute on function public.report_discover_deck_for_email(text, text) to service_role;

notify pgrst, 'reload schema';
