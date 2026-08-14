-- 150：創始會員（founding_member_no IS NOT NULL）不出現在一般會員的探索 deck 池。
-- 創始會員彼此仍可進 deck；一般會員 deck 不含創始帳號（含 incoming like／超喜追加）。
-- 不清今日 daily_discover_deck：已建立的當日 deck 維持不變；新規則僅於下次建牌（通常下一 app 日）生效。

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
        and p.verification_status = 'approved'
        and p.gender is not null
        and p.gender <> p_my_gender
        and trim(coalesce(p.nickname, p.name, '')) <> ''
        and p.photo_urls is not null
        and cardinality(p.photo_urls) >= 1
        and (
          p.founding_member_no is null
          or exists (
            select 1
            from public.profiles pv
            where pv.id = p_viewer
              and pv.founding_member_no is not null
          )
        )
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
        and p.verification_status = 'approved'
        and p.gender is not null
        and p.gender <> p_my_gender
        and trim(coalesce(p.nickname, p.name, '')) <> ''
        and p.photo_urls is not null
        and cardinality(p.photo_urls) >= 1
        and (
          p.founding_member_no is null
          or exists (
            select 1
            from public.profiles pv
            where pv.id = p_viewer
              and pv.founding_member_no is not null
          )
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
    );
$$;

comment on function public._daily_discover_candidate_ok(uuid, uuid, text, text, boolean) is
  '探索 deck 候選：須 active、approved、異性、有暱稱與生活照；創始帳號僅出現在創始 viewer 的 deck。';

comment on function public._discover_incoming_super_like_ok(uuid, uuid, text) is
  '探索超喜追加：安全條件同 deck 候選；創始帳號僅對創始 viewer 追加。';

notify pgrst, 'reload schema';
