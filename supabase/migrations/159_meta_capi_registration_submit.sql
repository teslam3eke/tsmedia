-- 159：CompleteRegistration / SubmitApplication CAPI 送達狀態（event_id 固定，Meta dedup）

alter table public.profiles
  add column if not exists meta_capi_complete_registration_sent_at timestamptz,
  add column if not exists meta_capi_complete_registration_attempts int not null default 0,
  add column if not exists meta_capi_complete_registration_last_error text,
  add column if not exists meta_capi_complete_registration_last_attempt_at timestamptz,
  add column if not exists meta_capi_complete_registration_in_flight_until timestamptz;

comment on column public.profiles.meta_capi_complete_registration_sent_at is
  'Meta CAPI CompleteRegistration 已接受（event_id = profiles.id）';

alter table public.verification_applications
  add column if not exists meta_capi_submit_application_sent_at timestamptz,
  add column if not exists meta_capi_submit_application_attempts int not null default 0,
  add column if not exists meta_capi_submit_application_last_error text,
  add column if not exists meta_capi_submit_application_last_attempt_at timestamptz,
  add column if not exists meta_capi_submit_application_in_flight_until timestamptz;

comment on column public.verification_applications.meta_capi_submit_application_sent_at is
  'Meta CAPI SubmitApplication 已接受（event_id = verification_applications.id）';

create or replace function public.claim_meta_capi_complete_registration(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_created timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  end if;

  select created_at into v_created from auth.users where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  if v_created < now() - interval '30 days' then
    return jsonb_build_object('ok', false, 'reason', 'registration_window_closed');
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'profile_not_found');
  end if;

  if v_profile.meta_capi_complete_registration_sent_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;

  if v_profile.meta_capi_complete_registration_in_flight_until is not null
     and v_profile.meta_capi_complete_registration_in_flight_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'in_flight');
  end if;

  update public.profiles
  set
    meta_capi_complete_registration_attempts =
      coalesce(meta_capi_complete_registration_attempts, 0) + 1,
    meta_capi_complete_registration_last_attempt_at = now(),
    meta_capi_complete_registration_in_flight_until = now() + interval '90 seconds',
    updated_at = now()
  where id = p_user_id
  returning * into v_profile;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_profile.id,
    'meta_fbp', v_profile.meta_fbp,
    'meta_fbc', v_profile.meta_fbc,
    'registered_at', v_created
  );
end;
$$;

create or replace function public.mark_meta_capi_complete_registration_sent(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  end if;

  update public.profiles
  set
    meta_capi_complete_registration_sent_at = coalesce(meta_capi_complete_registration_sent_at, now()),
    meta_capi_complete_registration_in_flight_until = null,
    meta_capi_complete_registration_last_error = null,
    updated_at = now()
  where id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_meta_capi_complete_registration_in_flight(
  p_user_id uuid,
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
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  end if;

  update public.profiles
  set
    meta_capi_complete_registration_in_flight_until = null,
    meta_capi_complete_registration_last_error = coalesce(v_err, meta_capi_complete_registration_last_error),
    updated_at = now()
  where id = p_user_id
    and meta_capi_complete_registration_sent_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.claim_meta_capi_submit_application(p_application_id uuid)
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

  if v_app.meta_capi_submit_application_sent_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;

  if v_app.meta_capi_submit_application_in_flight_until is not null
     and v_app.meta_capi_submit_application_in_flight_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'in_flight');
  end if;

  update public.verification_applications
  set
    meta_capi_submit_application_attempts =
      coalesce(meta_capi_submit_application_attempts, 0) + 1,
    meta_capi_submit_application_last_attempt_at = now(),
    meta_capi_submit_application_in_flight_until = now() + interval '90 seconds'
  where id = p_application_id
  returning * into v_app;

  return jsonb_build_object(
    'ok', true,
    'application_id', v_app.id,
    'user_id', v_app.user_id,
    'submitted_at', v_app.submitted_at
  );
end;
$$;

create or replace function public.mark_meta_capi_submit_application_sent(p_application_id uuid)
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
    meta_capi_submit_application_sent_at = coalesce(meta_capi_submit_application_sent_at, now()),
    meta_capi_submit_application_in_flight_until = null,
    meta_capi_submit_application_last_error = null
  where id = p_application_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_meta_capi_submit_application_in_flight(
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
    meta_capi_submit_application_in_flight_until = null,
    meta_capi_submit_application_last_error = coalesce(v_err, meta_capi_submit_application_last_error)
  where id = p_application_id
    and meta_capi_submit_application_sent_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.claim_meta_capi_complete_registration(uuid) from public;
revoke all on function public.mark_meta_capi_complete_registration_sent(uuid) from public;
revoke all on function public.release_meta_capi_complete_registration_in_flight(uuid, text) from public;
revoke all on function public.claim_meta_capi_submit_application(uuid) from public;
revoke all on function public.mark_meta_capi_submit_application_sent(uuid) from public;
revoke all on function public.release_meta_capi_submit_application_in_flight(uuid, text) from public;

notify pgrst, 'reload schema';
