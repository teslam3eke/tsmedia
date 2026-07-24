-- 136：新送審時通知所有管理員。
-- 以資料庫 trigger 執行，無論從 PWA、管理工具或 SQL 建立申請都不會漏通知。

alter table public.app_notifications
  drop constraint if exists app_notifications_kind_check;

alter table public.app_notifications
  add constraint app_notifications_kind_check
  check (kind in (
    'verification_approved',
    'verification_rejected',
    'verification_submitted',
    'super_like_received',
    'match_created',
    'message_received',
    'instant_match_paired'
  ));

create or replace function public.notify_admins_of_verification_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submitter_name text;
begin
  select nullif(trim(p.name), '') into v_submitter_name
  from public.profiles p
  where p.id = new.user_id;

  insert into public.app_notifications (user_id, kind, title, body)
  select
    admin.id,
    'verification_submitted',
    '有新的身分認證申請',
    coalesce(v_submitter_name, '一位使用者') || ' 已送出身分認證，請前往管理後台審核。'
  from public.profiles admin
  where admin.is_admin = true;

  return new;
end;
$$;

drop trigger if exists verification_application_admin_notify on public.verification_applications;
create trigger verification_application_admin_notify
  after insert on public.verification_applications
  for each row
  execute function public.notify_admins_of_verification_submission();

notify pgrst, 'reload schema';
