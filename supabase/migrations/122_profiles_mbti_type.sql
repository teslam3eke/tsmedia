-- 122：profiles 新增 MBTI 人格類型；探索 deck JSON 一併回傳

alter table public.profiles
  add column if not exists mbti_type text;

alter table public.profiles
  drop constraint if exists profiles_mbti_type_check;

alter table public.profiles
  add constraint profiles_mbti_type_check
  check (mbti_type is null or mbti_type ~ '^[EI][NS][FT][JP]$');

comment on column public.profiles.mbti_type is 'MBTI 四字母人格類型（探索卡顯示；入門測驗或編輯個資設定）';

create or replace function public._daily_discover_profiles_json(
  p_viewer uuid,
  p_day text,
  p_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = public
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
            'mbti_type', p.mbti_type,
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
            'show_income_border',
              coalesce(p.show_income_border, false)
              and p.income_tier is not null
              and (p.gender is distinct from 'male' or p.crown_effect_purchased_at is not null),
            'liked_today', exists (
              select 1 from public.profile_interactions i
              where i.actor_user_id = p_viewer
                and i.action = 'like'
                and (
                  i.target_user_id = p.id
                  or i.target_profile_key = p.id::text
                  or i.target_profile_key = ('user:' || p.id::text)
                )
            ),
            'super_liked_today', exists (
              select 1 from public.profile_interactions i
              where i.actor_user_id = p_viewer
                and i.action = 'super_like'
                and (
                  i.target_user_id = p.id
                  or i.target_profile_key = p.id::text
                  or i.target_profile_key = ('user:' || p.id::text)
                )
            ),
            'incoming_super_liked', exists (
              select 1 from public.profile_interactions i
              where i.actor_user_id = p.id
                and i.action = 'super_like'
                and (
                  i.target_user_id = p_viewer
                  or i.target_profile_key = p_viewer::text
                  or i.target_profile_key = ('user:' || p_viewer::text)
                )
            )
          ) as profile_obj
        from unnest(p_ids) with ordinality as u(uid, ord)
        join public.profiles p on p.id = u.uid
      ) sub
    ),
    '[]'::jsonb
  );
$$;

notify pgrst, 'reload schema';
