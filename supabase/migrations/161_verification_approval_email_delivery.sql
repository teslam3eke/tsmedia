-- 161：會員審核通過 Approval Email 送達狀態（與 verification status 分離）

alter table public.verification_applications
  add column if not exists approval_email_sent_at timestamptz,
  add column if not exists approval_email_attempts int not null default 0,
  add column if not exists approval_email_last_attempt_at timestamptz,
  add column if not exists approval_email_last_error text,
  add column if not exists approval_email_in_flight_until timestamptz;

comment on column public.verification_applications.approval_email_sent_at is
  '審核通過通知信已送達（每 application 最多一封）';

create or replace function public.claim_verification_approval_email_delivery(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.verification_applications%rowtype;
begin
  if p_application_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_application_id');
  end if;

  select * into v_app
  from public.verification_applications
  where id = p_application_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_app.status is distinct from 'approved'::public.verification_application_status then
    return jsonb_build_object('ok', false, 'reason', 'not_approved');
  end if;

  if v_app.approval_email_sent_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;

  if v_app.approval_email_in_flight_until is not null
     and v_app.approval_email_in_flight_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'in_flight');
  end if;

  update public.verification_applications
  set
    approval_email_attempts = coalesce(approval_email_attempts, 0) + 1,
    approval_email_last_attempt_at = now(),
    approval_email_in_flight_until = now() + interval '90 seconds'
  where id = p_application_id
  returning * into v_app;

  return jsonb_build_object(
    'ok', true,
    'application_id', v_app.id,
    'user_id', v_app.user_id
  );
end;
$$;

create or replace function public.mark_verification_approval_email_sent(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_application_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_application_id');
  end if;

  update public.verification_applications
  set
    approval_email_sent_at = coalesce(approval_email_sent_at, now()),
    approval_email_in_flight_until = null,
    approval_email_last_error = null
  where id = p_application_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_verification_approval_email_in_flight(
  p_application_id uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  if p_application_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_application_id');
  end if;

  update public.verification_applications
  set
    approval_email_in_flight_until = null,
    approval_email_last_error = coalesce(v_err, approval_email_last_error)
  where id = p_application_id
    and approval_email_sent_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.claim_verification_approval_email_delivery(uuid) from public;
revoke all on function public.mark_verification_approval_email_sent(uuid) from public;
revoke all on function public.release_verification_approval_email_in_flight(uuid, text) from public;

notify pgrst, 'reload schema';
