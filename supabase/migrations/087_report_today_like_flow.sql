-- 087：營運診斷 — 查詢「今日 app 日」探索愛心／超喜流向（actor → target）
-- App 日與探索換日一致：台北時間每晚 22:00 換日（app_day_key_now）。
--
-- ⚠️ 請先「整份貼上並 Run」本檔，再查詢；只跑 SELECT 會出現 function does not exist。
--
-- 用法（Supabase SQL Editor）：
--   select * from public.report_today_like_flow() order by created_at;
--   select * from public.report_like_flow_for_app_day('2026-05-30') order by created_at;

create or replace function public.report_like_flow_for_app_day(p_app_day text)
returns table (
  app_day_key text,
  created_at timestamptz,
  action text,
  actor_user_id uuid,
  actor_email text,
  actor_nickname text,
  target_user_id uuid,
  target_email text,
  target_nickname text,
  target_profile_key text,
  mutual_match boolean,
  match_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with v_day as (
    select coalesce(nullif(trim(p_app_day), ''), public.app_day_key_now()) as d
  ),
  raw as (
    select
      i.interaction_app_day_key,
      i.created_at,
      i.action,
      i.actor_user_id,
      i.target_user_id,
      i.target_profile_key,
      coalesce(
        i.target_user_id,
        case
          when i.target_profile_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then i.target_profile_key::uuid
          when i.target_profile_key ~* '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then replace(i.target_profile_key, 'user:', '')::uuid
          else null
        end
      ) as target_uid_resolved
    from public.profile_interactions i
    cross join v_day
    where i.interaction_app_day_key = v_day.d
      and i.action in ('like', 'super_like')
  )
  select
    r.interaction_app_day_key as app_day_key,
    r.created_at,
    r.action,
    r.actor_user_id,
    au.email as actor_email,
    coalesce(nullif(trim(pa.nickname), ''), nullif(trim(pa.name), '')) as actor_nickname,
    r.target_uid_resolved as target_user_id,
    tu.email as target_email,
    coalesce(nullif(trim(pt.nickname), ''), nullif(trim(pt.name), '')) as target_nickname,
    r.target_profile_key,
    exists (
      select 1
      from public.profile_interactions j
      where j.actor_user_id = r.target_uid_resolved
        and j.action in ('like', 'super_like')
        and (
          j.target_user_id = r.actor_user_id
          or j.target_profile_key = r.actor_user_id::text
          or j.target_profile_key = ('user:' || r.actor_user_id::text)
        )
    ) as mutual_match,
    m.id as match_id
  from raw r
  left join auth.users au on au.id = r.actor_user_id
  left join public.profiles pa on pa.id = r.actor_user_id
  left join auth.users tu on tu.id = r.target_uid_resolved
  left join public.profiles pt on pt.id = r.target_uid_resolved
  left join public.matches m
    on r.target_uid_resolved is not null
   and m.user_a = least(r.actor_user_id, r.target_uid_resolved)
   and m.user_b = greatest(r.actor_user_id, r.target_uid_resolved)
  order by r.created_at asc;
$$;

create or replace function public.report_today_like_flow()
returns table (
  app_day_key text,
  created_at timestamptz,
  action text,
  actor_user_id uuid,
  actor_email text,
  actor_nickname text,
  target_user_id uuid,
  target_email text,
  target_nickname text,
  target_profile_key text,
  mutual_match boolean,
  match_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.report_like_flow_for_app_day(public.app_day_key_now());
$$;

comment on function public.report_like_flow_for_app_day(text) is
  '營運診斷：列出指定 app 日所有探索 like／super_like 流向。';
comment on function public.report_today_like_flow() is
  '營運診斷：report_like_flow_for_app_day(app_day_key_now()) 捷徑。';

grant execute on function public.report_like_flow_for_app_day(text) to postgres, service_role;
grant execute on function public.report_today_like_flow() to postgres, service_role;

do $$
declare
  v_day text := public.app_day_key_now();
  v_like int;
  v_super int;
  v_mutual int;
  v_matched int;
begin
  select count(*) filter (where action = 'like'),
         count(*) filter (where action = 'super_like')
  into v_like, v_super
  from public.report_like_flow_for_app_day(v_day);

  select count(*) filter (where mutual_match),
         count(*) filter (where match_id is not null)
  into v_mutual, v_matched
  from public.report_like_flow_for_app_day(v_day);

  raise notice '087 OK app_day=% | like=% super_like=% | 雙向=% 已有match=%',
    v_day, v_like, v_super, v_mutual, v_matched;
end $$;
