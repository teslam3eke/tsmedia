-- 138：新會員審核不再要求政府證件；同步管理員通知文案。
-- 僅替換 trigger function，不變更或刪除任何既有申請、文件與會員資料。

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
    '有新的會員審核申請',
    coalesce(v_submitter_name, '一位使用者') || ' 已送出會員審核，請前往管理後台處理。'
  from public.profiles admin
  where admin.is_admin = true;

  return new;
end;
$$;

notify pgrst, 'reload schema';
