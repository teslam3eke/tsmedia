-- 140：女性會員成長方案。
-- 1) 現有已審核女性免費至 2026-08-31 23:59（台北時間）。
-- 2) 未來女性首次審核通過時，自動取得 30 天 VIP。
-- 已有更長付費效期者一律保留，不縮短 subscription_expires_at。

create or replace function public.grant_female_membership_on_first_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.subscription_expires_at := greatest(
    coalesce(new.subscription_expires_at, now()),
    now() + interval '30 days'
  );
  return new;
end;
$$;

drop trigger if exists profiles_grant_female_membership_on_first_approval
  on public.profiles;

create trigger profiles_grant_female_membership_on_first_approval
  before update of verification_status on public.profiles
  for each row
  when (
    new.gender = 'female'
    and new.account_status = 'active'
    and new.verification_status = 'approved'
    and old.verification_status is distinct from new.verification_status
  )
  execute function public.grant_female_membership_on_first_approval();

update public.profiles
set subscription_expires_at = greatest(
  coalesce(subscription_expires_at, timestamptz '2026-08-31 23:59:00+08'),
  timestamptz '2026-08-31 23:59:00+08'
)
where gender = 'female'
  and verification_status = 'approved'
  and account_status = 'active';

notify pgrst, 'reload schema';
