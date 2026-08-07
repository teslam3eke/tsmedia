-- 142：審核通過但未付費者可瀏覽探索；送愛心／超喜與加入即時配對仍須有效 VIP。
-- 以 trigger 保護實際寫入，避免只靠前端導向會員管理而被直接呼叫 RPC 繞過。

create or replace function public.guard_member_profile_interaction()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if
    new.action in ('like', 'super_like')
    and auth.uid() is not null
    and new.actor_user_id = auth.uid()
    and not exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.subscription_expires_at > now()
    )
  then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists profile_interactions_require_membership
  on public.profile_interactions;

create trigger profile_interactions_require_membership
  before insert or update of action on public.profile_interactions
  for each row
  execute function public.guard_member_profile_interaction();

create or replace function public.guard_member_instant_match_queue()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if
    auth.uid() is not null
    and new.user_id = auth.uid()
    and not exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.subscription_expires_at > now()
    )
  then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists instant_match_queue_require_membership
  on public.instant_match_queue;

create trigger instant_match_queue_require_membership
  before insert or update on public.instant_match_queue
  for each row
  execute function public.guard_member_instant_match_queue();

notify pgrst, 'reload schema';
