-- ============================================================
-- Migration 022: 每日探索名單不再排除 is_admin
-- 先前 021 將管理員從候選人排除，導致管理員不會出現在他人的探索中，
-- 無法與一般會員互相配對。改為與一般會員相同參與探索池。
-- ============================================================

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
