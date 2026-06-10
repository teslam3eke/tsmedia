-- 099：男性未購買皇冠特效時不可啟用 show_income_border；探索 JSON 同步過濾

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

create or replace function public.profiles_guard_crown_effect_toggle()
returns trigger
language plpgsql
as $$
begin
  if new.gender = 'male'
     and coalesce(new.show_income_border, false)
     and new.crown_effect_purchased_at is null
  then
    new.show_income_border := false;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_crown_effect_toggle on public.profiles;
create trigger profiles_guard_crown_effect_toggle
  before insert or update of show_income_border, gender, crown_effect_purchased_at
  on public.profiles
  for each row
  execute function public.profiles_guard_crown_effect_toggle();

notify pgrst, 'reload schema';
