-- 110：綠界入帳冪等 — notify／return 並行或重試時只 grant 一次

alter table public.ecpay_orders
  add column if not exists fulfilled_at timestamptz;

comment on column public.ecpay_orders.fulfilled_at is
  '服務端 grant 完成時間；status=paid 後若 grant 失敗可重試，fulfilled_at 非 null 則跳過';

-- 舊訂單（110 前已 paid）視為已入帳，避免上線後 notify 重送再 grant
update public.ecpay_orders
set fulfilled_at = coalesce(paid_at, updated_at, now())
where status = 'paid'::public.newebpay_order_status
  and fulfilled_at is null;

create or replace function public.fulfill_ecpay_order_for_service(
  p_merchant_trade_no text,
  p_ecpay_trade_no text,
  p_paid_amt int,
  p_raw_result jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.ecpay_orders%rowtype;
  v_grant jsonb;
  v_trade_no text := nullif(btrim(coalesce(p_ecpay_trade_no, '')), '');
  v_merchant text := nullif(btrim(coalesce(p_merchant_trade_no, '')), '');
begin
  if v_merchant is null then
    raise exception 'MISSING_ORDER_NO';
  end if;

  select * into v_order
  from public.ecpay_orders o
  where o.merchant_trade_no = v_merchant
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.fulfilled_at is not null then
    return jsonb_build_object(
      'ok', true,
      'already_fulfilled', true,
      'product_type', v_order.product_type,
      'pack_key', v_order.pack_key
    );
  end if;

  if v_order.status = 'pending'::public.newebpay_order_status then
    if p_paid_amt is null or p_paid_amt <> v_order.amount_ntd then
      raise exception 'AMOUNT_MISMATCH';
    end if;

    update public.ecpay_orders
    set
      status = 'paid'::public.newebpay_order_status,
      ecpay_trade_no = v_trade_no,
      raw_result = p_raw_result,
      paid_at = now(),
      updated_at = now()
    where id = v_order.id
    returning * into v_order;
  elsif v_order.status <> 'paid'::public.newebpay_order_status then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;

  if v_order.product_type = 'membership' then
    v_grant := public.grant_monthly_membership_for_user(v_order.user_id);
    if coalesce(v_grant->>'ok', 'false') <> 'true'
       or v_grant->>'subscription_expires_at' is null then
      raise exception 'GRANT_MEMBERSHIP_FAILED';
    end if;

    insert into public.subscription_payment_events (
      user_id, provider, amount_ntd, rec_trade_id, gateway_status
    )
    values (v_order.user_id, 'ecpay', v_order.amount_ntd, v_trade_no, 0);
  elsif v_order.product_type = 'credit_pack' then
    if v_order.pack_key is null or btrim(v_order.pack_key) = '' then
      raise exception 'PACK_KEY_MISSING';
    end if;

    v_grant := public.grant_credit_pack_for_user(v_order.user_id, v_order.pack_key);
    if coalesce(v_grant->>'ok', 'false') <> 'true' then
      raise exception 'GRANT_PACK_FAILED';
    end if;

    insert into public.credit_pack_payment_events (
      user_id, pack_key, provider, amount_ntd, rec_trade_id, gateway_status
    )
    values (
      v_order.user_id,
      v_order.pack_key,
      'ecpay',
      v_order.amount_ntd,
      v_trade_no,
      0
    );
  else
    raise exception 'UNKNOWN_PRODUCT';
  end if;

  update public.ecpay_orders
  set fulfilled_at = now(), updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'already_fulfilled', false,
    'product_type', v_order.product_type,
    'pack_key', v_order.pack_key,
    'subscription_expires_at', v_grant->>'subscription_expires_at'
  );
end;
$$;

revoke all on function public.fulfill_ecpay_order_for_service(text, text, int, jsonb) from public;
grant execute on function public.fulfill_ecpay_order_for_service(text, text, int, jsonb) to service_role;

notify pgrst, 'reload schema';
