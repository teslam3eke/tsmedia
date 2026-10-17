-- 160：CompleteRegistration 7 日窗口、註冊 attribution 凍結、Purchase event_source_url

alter table public.profiles
  add column if not exists meta_reg_fbp text,
  add column if not exists meta_reg_fbc text;

comment on column public.profiles.meta_reg_fbp is
  'CompleteRegistration CAPI 專用：註冊當下 fbp（僅寫入一次）';
comment on column public.profiles.meta_reg_fbc is
  'CompleteRegistration CAPI 專用：註冊當下 fbc（僅寫入一次）';

alter table public.ecpay_orders
  add column if not exists meta_event_source_url text;

comment on column public.ecpay_orders.meta_event_source_url is
  '建立訂單時 client 頁面 URL（已 server sanitize）';

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

  if v_created < now() - interval '7 days' then
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
    'meta_reg_fbp', v_profile.meta_reg_fbp,
    'meta_reg_fbc', v_profile.meta_reg_fbc,
    'registered_at', v_created
  );
end;
$$;

create or replace function public.claim_ecpay_meta_capi_purchase_delivery(p_merchant_trade_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.ecpay_orders%rowtype;
  v_merchant text := nullif(btrim(coalesce(p_merchant_trade_no, '')), '');
begin
  if v_merchant is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_order_no');
  end if;

  select * into v_order
  from public.ecpay_orders o
  where o.merchant_trade_no = v_merchant
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_order.fulfilled_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_fulfilled');
  end if;

  if v_order.meta_capi_purchase_sent_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;

  if v_order.meta_capi_purchase_in_flight_until is not null
     and v_order.meta_capi_purchase_in_flight_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'in_flight');
  end if;

  update public.ecpay_orders
  set
    meta_capi_purchase_attempts = coalesce(meta_capi_purchase_attempts, 0) + 1,
    meta_capi_purchase_last_attempt_at = now(),
    meta_capi_purchase_in_flight_until = now() + interval '90 seconds',
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'merchant_trade_no', v_order.merchant_trade_no,
    'user_id', v_order.user_id,
    'amount_ntd', v_order.amount_ntd,
    'paid_at', v_order.paid_at,
    'meta_fbp', v_order.meta_fbp,
    'meta_fbc', v_order.meta_fbc,
    'client_user_agent', v_order.client_user_agent,
    'client_ip', v_order.client_ip,
    'meta_event_source_url', v_order.meta_event_source_url
  );
end;
$$;

notify pgrst, 'reload schema';
