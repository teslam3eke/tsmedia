-- 158：綠界訂單 Meta Purchase CAPI 送達狀態（與 fulfilled_at 分離）

alter table public.ecpay_orders
  add column if not exists meta_capi_purchase_sent_at timestamptz,
  add column if not exists meta_capi_purchase_attempts int not null default 0,
  add column if not exists meta_capi_purchase_last_error text,
  add column if not exists meta_capi_purchase_last_attempt_at timestamptz,
  add column if not exists meta_capi_purchase_in_flight_until timestamptz;

comment on column public.ecpay_orders.meta_capi_purchase_sent_at is
  'Meta Graph API 已接受 Purchase CAPI（event_id = merchant_trade_no）';
comment on column public.ecpay_orders.meta_capi_purchase_attempts is
  'Purchase CAPI 送達嘗試次數（含 retry）';
comment on column public.ecpay_orders.meta_capi_purchase_in_flight_until is
  '短期 in-flight 鎖，避免 notify/return/sync 並行重複打 Meta';

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
    'client_ip', v_order.client_ip
  );
end;
$$;

create or replace function public.mark_ecpay_meta_capi_purchase_sent(p_merchant_trade_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant text := nullif(btrim(coalesce(p_merchant_trade_no, '')), '');
begin
  if v_merchant is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_order_no');
  end if;

  update public.ecpay_orders
  set
    meta_capi_purchase_sent_at = coalesce(meta_capi_purchase_sent_at, now()),
    meta_capi_purchase_in_flight_until = null,
    meta_capi_purchase_last_error = null,
    updated_at = now()
  where merchant_trade_no = v_merchant;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_ecpay_meta_capi_purchase_in_flight(
  p_merchant_trade_no text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant text := nullif(btrim(coalesce(p_merchant_trade_no, '')), '');
  v_err text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  if v_merchant is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_order_no');
  end if;

  update public.ecpay_orders
  set
    meta_capi_purchase_in_flight_until = null,
    meta_capi_purchase_last_error = coalesce(v_err, meta_capi_purchase_last_error),
    updated_at = now()
  where merchant_trade_no = v_merchant
    and meta_capi_purchase_sent_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.claim_ecpay_meta_capi_purchase_delivery(text) from public;
revoke all on function public.mark_ecpay_meta_capi_purchase_sent(text) from public;
revoke all on function public.release_ecpay_meta_capi_purchase_in_flight(text, text) from public;

notify pgrst, 'reload schema';
