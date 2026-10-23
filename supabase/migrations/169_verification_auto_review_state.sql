-- 169：Onboarding 自動審核狀態（文字兩次退件／race-safe claim；不動 168 收入 B）

alter table public.profiles
  add column if not exists verification_text_auto_strikes smallint not null default 0;

comment on column public.profiles.verification_text_auto_strikes is
  '文字自動審退件次數；會員審核通過後清零；僅 service_role（server）可寫入。';

-- 阻擋 authenticated / admin client 自行改 strikes；service_role 與未變更該欄的 UPDATE 不受限
create or replace function public._profiles_guard_verification_text_auto_strikes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verification_text_auto_strikes is distinct from 0 then
      raise exception 'verification_text_auto_strikes is server-managed'
        using errcode = '42501';
    end if;
    new.verification_text_auto_strikes := 0;
    return new;
  end if;

  if new.verification_text_auto_strikes is distinct from old.verification_text_auto_strikes then
    raise exception 'verification_text_auto_strikes is server-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_verification_text_auto_strikes on public.profiles;
create trigger profiles_guard_verification_text_auto_strikes
  before insert or update of verification_text_auto_strikes on public.profiles
  for each row
  execute function public._profiles_guard_verification_text_auto_strikes();

alter table public.verification_applications
  add column if not exists auto_review_claimed_at timestamptz,
  add column if not exists auto_review_finished_at timestamptz,
  add column if not exists auto_review_outcome text;

comment on column public.verification_applications.auto_review_outcome is
  'approved | text_rejected | manual_queue | manual_required | already_approved';

create index if not exists verification_applications_pending_auto_review_idx
  on public.verification_applications (submitted_at asc)
  where status = 'pending' and auto_review_outcome is null;

notify pgrst, 'reload schema';
