-- 162：使用者 acquisition 優惠券（entitlement + 預留／兌換；不 backfill、不自動發券）

-- ─── 券種定義（campaign_key 為穩定 identifier） ───

create table if not exists public.coupon_campaign_definitions (
  campaign_key text primary key,
  discount_kind text not null
    check (discount_kind in ('fixed_amount', 'pay_ratio_tenths')),
  discount_value int not null check (discount_value > 0),
  stacking_policy text not null
    check (stacking_policy in ('stack_on_promo_price', 'replace_promo_use_list_price')),
  eligible_product_key text not null default 'membership_male'
    check (eligible_product_key in ('membership_male')),
  allows_membership_discount_code boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.coupon_campaign_definitions is
  'Acquisition 優惠券種；discount 語意與 stacking_policy 由 server 解讀，client 不可傳價格。';
comment on column public.coupon_campaign_definitions.discount_kind is
  'fixed_amount=固定折 NT$；pay_ratio_tenths=支付原價比例（3=付 30%／三折）';
comment on column public.coupon_campaign_definitions.stacking_policy is
  'stack_on_promo_price=疊在活動價；replace_promo_use_list_price=以 list 價為基準取代活動價';

insert into public.coupon_campaign_definitions (
  campaign_key,
  discount_kind,
  discount_value,
  stacking_policy,
  allows_membership_discount_code
)
values
  (
    'APPROVED_48H_200',
    'fixed_amount',
    200,
    'stack_on_promo_price',
    true
  ),
  (
    'APPROVED_7D_30PCT',
    'pay_ratio_tenths',
    3,
    'replace_promo_use_list_price',
    false
  )
on conflict (campaign_key) do update
set
  discount_kind = excluded.discount_kind,
  discount_value = excluded.discount_value,
  stacking_policy = excluded.stacking_policy,
  allows_membership_discount_code = excluded.allows_membership_discount_code,
  enabled = excluded.enabled,
  updated_at = now();

-- ─── 使用者持有券（server 發放；每列一次性） ───

create table if not exists public.user_coupon_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_key text not null references public.coupon_campaign_definitions (campaign_key),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'available'
    check (status in ('available', 'reserved', 'redeemed', 'cancelled', 'reconciliation_required')),
  reserved_merchant_trade_no text,
  reserved_at timestamptz,
  redeemed_at timestamptz,
  redeemed_merchant_trade_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > issued_at)
);

create index if not exists user_coupon_entitlements_user_status_idx
  on public.user_coupon_entitlements (user_id, status, expires_at);

create unique index if not exists user_coupon_entitlements_reserved_trade_no_idx
  on public.user_coupon_entitlements (reserved_merchant_trade_no)
  where reserved_merchant_trade_no is not null;

alter table public.coupon_campaign_definitions enable row level security;
alter table public.user_coupon_entitlements enable row level security;

drop policy if exists "coupon campaign definitions: no direct access"
  on public.coupon_campaign_definitions;
create policy "coupon campaign definitions: no direct access"
  on public.coupon_campaign_definitions for all
  using (false)
  with check (false);

drop policy if exists "user coupon entitlements: no direct access"
  on public.user_coupon_entitlements;
create policy "user coupon entitlements: no direct access"
  on public.user_coupon_entitlements for all
  using (false)
  with check (false);

revoke all on table public.coupon_campaign_definitions from anon, authenticated;
revoke all on table public.user_coupon_entitlements from anon, authenticated;

drop trigger if exists coupon_campaign_definitions_updated_at
  on public.coupon_campaign_definitions;
create trigger coupon_campaign_definitions_updated_at
  before update on public.coupon_campaign_definitions
  for each row execute procedure public.handle_updated_at();

drop trigger if exists user_coupon_entitlements_updated_at
  on public.user_coupon_entitlements;
create trigger user_coupon_entitlements_updated_at
  before update on public.user_coupon_entitlements
  for each row execute procedure public.handle_updated_at();

alter table public.ecpay_orders
  add column if not exists user_coupon_entitlement_id uuid
    references public.user_coupon_entitlements (id) on delete set null;

alter table public.ecpay_orders
  add column if not exists coupon_redemption_status text
    check (
      coupon_redemption_status is null
      or coupon_redemption_status in (
        'not_applicable',
        'pending',
        'redeemed',
        'reconciliation_required'
      )
    );

alter table public.ecpay_orders
  add column if not exists coupon_redemption_error text;

alter table public.ecpay_orders
  add column if not exists coupon_redeemed_at timestamptz;

comment on column public.ecpay_orders.user_coupon_entitlement_id is
  '本次 checkout 使用的 acquisition 券 entitlement；fulfill 後標記 redeemed';
comment on column public.ecpay_orders.coupon_redemption_status is
  'acquisition 券兌換狀態；fulfill 成功後與 entitlement 對帳；不影響 amount_ntd／入帳';
comment on column public.ecpay_orders.coupon_redemption_error is
  '券兌換需人工／重試對帳時的錯誤摘要（含 security 標記）';

-- ─── 內部：是否已有付費 VIP 綠界訂單（acquisition 券限首次付費購買） ───

create or replace function public._user_has_paid_membership_ecpay(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ecpay_orders o
    where o.user_id = p_user_id
      and o.product_type = 'membership'
      and o.status = 'paid'::public.newebpay_order_status
  )
  or exists (
    select 1
    from public.subscription_payment_events e
    where e.user_id = p_user_id
  );
$$;

-- ─── 釋放逾時未付款的 reserved 券（pending 訂單超過 3 小時） ───

create or replace function public.release_stale_user_coupon_reservations(
  p_pending_max_age interval default interval '3 hours'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  with stale as (
    select e.id
    from public.user_coupon_entitlements e
    join public.ecpay_orders o
      on o.merchant_trade_no = e.reserved_merchant_trade_no
    where e.status = 'reserved'
      and o.status = 'pending'::public.newebpay_order_status
      and o.fulfilled_at is null
      and o.paid_at is null
      and o.created_at < now() - p_pending_max_age
    for update of e
  )
  update public.user_coupon_entitlements e
  set
    status = 'available',
    reserved_merchant_trade_no = null,
    reserved_at = null,
    updated_at = now()
  from stale s
  where e.id = s.id
    and e.status = 'reserved';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─── 建立訂單前預留券（FOR UPDATE 防併發 double redeem） ───

create or replace function public.reserve_user_coupon_for_ecpay_order(
  p_entitlement_id uuid,
  p_user_id uuid,
  p_merchant_trade_no text,
  p_product_type text default 'membership'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent public.user_coupon_entitlements%rowtype;
  v_def public.coupon_campaign_definitions%rowtype;
  v_trade text := nullif(btrim(coalesce(p_merchant_trade_no, '')), '');
  v_gender text;
begin
  if v_trade is null then
    raise exception 'MISSING_MERCHANT_TRADE_NO';
  end if;

  if p_product_type is distinct from 'membership' then
    raise exception 'COUPON_NOT_APPLICABLE_TO_PRODUCT';
  end if;

  perform public.release_stale_user_coupon_reservations();

  select * into v_ent
  from public.user_coupon_entitlements e
  where e.id = p_entitlement_id
  for update;

  if not found then
    raise exception 'COUPON_ENTITLEMENT_NOT_FOUND';
  end if;

  if v_ent.user_id is distinct from p_user_id then
    raise exception 'COUPON_ENTITLEMENT_USER_MISMATCH';
  end if;

  if v_ent.status = 'redeemed' then
    raise exception 'COUPON_ALREADY_REDEEMED';
  end if;

  if v_ent.status = 'cancelled' then
    raise exception 'COUPON_CANCELLED';
  end if;

  if v_ent.expires_at is not null and v_ent.expires_at <= now() then
    raise exception 'COUPON_EXPIRED';
  end if;

  select * into v_def
  from public.coupon_campaign_definitions d
  where d.campaign_key = v_ent.campaign_key;

  if not found or not v_def.enabled then
    raise exception 'COUPON_CAMPAIGN_DISABLED';
  end if;

  if v_def.eligible_product_key is distinct from 'membership_male' then
    raise exception 'COUPON_NOT_APPLICABLE_TO_PRODUCT';
  end if;

  select p.gender into v_gender
  from public.profiles p
  where p.id = p_user_id;

  if v_gender is distinct from 'male' then
    raise exception 'COUPON_MALE_ONLY';
  end if;

  if public._user_has_paid_membership_ecpay(p_user_id) then
    raise exception 'COUPON_NOT_FIRST_MEMBERSHIP_PURCHASE';
  end if;

  if v_ent.status = 'reserved' then
    if v_ent.reserved_merchant_trade_no = v_trade then
      return jsonb_build_object(
        'ok', true,
        'already_reserved', true,
        'campaign_key', v_ent.campaign_key
      );
    end if;
    raise exception 'COUPON_ALREADY_RESERVED';
  end if;

  if v_ent.status <> 'available' then
    raise exception 'COUPON_NOT_AVAILABLE';
  end if;

  update public.user_coupon_entitlements
  set
    status = 'reserved',
    reserved_merchant_trade_no = v_trade,
    reserved_at = now(),
    updated_at = now()
  where id = v_ent.id;

  return jsonb_build_object(
    'ok', true,
    'already_reserved', false,
    'campaign_key', v_ent.campaign_key
  );
end;
$$;

-- ─── 訂單建立失敗或作廢時釋放預留 ───

create or replace function public.release_user_coupon_reservation_for_ecpay(
  p_merchant_trade_no text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade text := nullif(btrim(coalesce(p_merchant_trade_no, '')), '');
  v_ent public.user_coupon_entitlements%rowtype;
begin
  if v_trade is null then
    raise exception 'MISSING_MERCHANT_TRADE_NO';
  end if;

  select * into v_ent
  from public.user_coupon_entitlements e
  where e.reserved_merchant_trade_no = v_trade
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  if v_ent.status = 'redeemed' then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  update public.user_coupon_entitlements
  set
    status = 'available',
    reserved_merchant_trade_no = null,
    reserved_at = null,
    updated_at = now()
  where id = v_ent.id
    and status = 'reserved';

  return jsonb_build_object('ok', true, 'released', true);
end;
$$;

-- ─── 入帳後兌換券（不 raise；供 fulfill／reconcile 使用） ───

create or replace function public.attempt_user_coupon_redemption_for_ecpay_order(
  p_merchant_trade_no text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade text := nullif(btrim(coalesce(p_merchant_trade_no, '')), '');
  v_order public.ecpay_orders%rowtype;
  v_ent public.user_coupon_entitlements%rowtype;
  v_err text;
begin
  if v_trade is null then
    return jsonb_build_object('ok', false, 'reason', 'MISSING_MERCHANT_TRADE_NO');
  end if;

  select * into v_order
  from public.ecpay_orders o
  where o.merchant_trade_no = v_trade
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'ORDER_NOT_FOUND');
  end if;

  if v_order.user_coupon_entitlement_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'NO_COUPON');
  end if;

  if v_order.coupon_redemption_status = 'redeemed' then
    return jsonb_build_object('ok', true, 'already_redeemed', true);
  end if;

  select * into v_ent
  from public.user_coupon_entitlements e
  where e.id = v_order.user_coupon_entitlement_id
  for update;

  if not found then
    v_err := 'COUPON_ENTITLEMENT_NOT_FOUND';
    update public.ecpay_orders
    set
      coupon_redemption_status = 'reconciliation_required',
      coupon_redemption_error = v_err,
      updated_at = now()
    where id = v_order.id;
    return jsonb_build_object(
      'ok', false,
      'reconciliation_required', true,
      'security', true,
      'error', v_err
    );
  end if;

  if v_ent.user_id is distinct from v_order.user_id then
    v_err := 'COUPON_ENTITLEMENT_USER_MISMATCH';
    update public.user_coupon_entitlements
    set status = 'reconciliation_required', updated_at = now()
    where id = v_ent.id;
    update public.ecpay_orders
    set
      coupon_redemption_status = 'reconciliation_required',
      coupon_redemption_error = v_err,
      updated_at = now()
    where id = v_order.id;
    return jsonb_build_object(
      'ok', false,
      'reconciliation_required', true,
      'security', true,
      'error', v_err
    );
  end if;

  if v_ent.status = 'redeemed'
     and v_ent.redeemed_merchant_trade_no is not distinct from v_trade then
    update public.ecpay_orders
    set
      coupon_redemption_status = 'redeemed',
      coupon_redeemed_at = coalesce(coupon_redeemed_at, v_ent.redeemed_at, now()),
      coupon_redemption_error = null,
      updated_at = now()
    where id = v_order.id;
    return jsonb_build_object('ok', true, 'already_redeemed', true);
  end if;

  if v_ent.status = 'reserved'
     and v_ent.reserved_merchant_trade_no is distinct from v_trade then
    v_err := 'COUPON_RESERVATION_MISMATCH';
    update public.user_coupon_entitlements
    set status = 'reconciliation_required', updated_at = now()
    where id = v_ent.id;
    update public.ecpay_orders
    set
      coupon_redemption_status = 'reconciliation_required',
      coupon_redemption_error = v_err,
      updated_at = now()
    where id = v_order.id;
    return jsonb_build_object(
      'ok', false,
      'reconciliation_required', true,
      'security', true,
      'error', v_err
    );
  end if;

  begin
    update public.user_coupon_entitlements
    set
      status = 'redeemed',
      redeemed_at = now(),
      redeemed_merchant_trade_no = v_trade,
      reserved_merchant_trade_no = null,
      reserved_at = null,
      updated_at = now()
    where id = v_ent.id;

    update public.ecpay_orders
    set
      coupon_redemption_status = 'redeemed',
      coupon_redeemed_at = now(),
      coupon_redemption_error = null,
      updated_at = now()
    where id = v_order.id;

    return jsonb_build_object(
      'ok', true,
      'redeemed', true,
      'campaign_key', v_ent.campaign_key
    );
  exception
    when others then
      v_err := SQLERRM;
      update public.user_coupon_entitlements
      set status = 'reconciliation_required', updated_at = now()
      where id = v_ent.id;
      update public.ecpay_orders
      set
        coupon_redemption_status = 'reconciliation_required',
        coupon_redemption_error = left(v_err, 500),
        updated_at = now()
      where id = v_order.id;
      return jsonb_build_object(
        'ok', false,
        'reconciliation_required', true,
        'error', v_err
      );
  end;
end;
$$;

-- ─── service：重試 coupon 兌換（已 fulfill；不重複 grant／payment event） ───

create or replace function public.reconcile_ecpay_coupon_redemption_for_service(
  p_merchant_trade_no text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trade text := nullif(btrim(coalesce(p_merchant_trade_no, '')), '');
  v_order public.ecpay_orders%rowtype;
  v_result jsonb;
begin
  if v_trade is null then
    raise exception 'MISSING_MERCHANT_TRADE_NO';
  end if;

  select * into v_order
  from public.ecpay_orders o
  where o.merchant_trade_no = v_trade;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.fulfilled_at is null then
    raise exception 'ORDER_NOT_FULFILLED';
  end if;

  if v_order.user_coupon_entitlement_id is null then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  if v_order.coupon_redemption_status = 'redeemed' then
    return jsonb_build_object('ok', true, 'already_redeemed', true);
  end if;

  v_result := public.attempt_user_coupon_redemption_for_ecpay_order(v_trade);
  return v_result || jsonb_build_object('merchant_trade_no', v_trade);
end;
$$;

-- ─── service 發券（lifecycle／測試；禁止 client） ───

create or replace function public.issue_user_coupon_entitlement_for_service(
  p_user_id uuid,
  p_campaign_key text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_def public.coupon_campaign_definitions%rowtype;
  v_row public.user_coupon_entitlements%rowtype;
begin
  select * into v_def
  from public.coupon_campaign_definitions d
  where d.campaign_key = nullif(btrim(p_campaign_key), '')
    and d.enabled;

  if not found then
    raise exception 'COUPON_CAMPAIGN_DISABLED';
  end if;

  insert into public.user_coupon_entitlements (
    user_id,
    campaign_key,
    expires_at
  )
  values (
    p_user_id,
    v_def.campaign_key,
    p_expires_at
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'entitlement_id', v_row.id,
    'campaign_key', v_row.campaign_key
  );
end;
$$;

-- ─── fulfill：入帳後兌換 acquisition 券 ───

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
  v_coupon_status text;
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
  set
    fulfilled_at = now(),
    coupon_redemption_status = case
      when user_coupon_entitlement_id is null then coalesce(coupon_redemption_status, 'not_applicable')
      else 'pending'
    end,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  v_coupon_status := v_order.coupon_redemption_status;

  if v_order.user_coupon_entitlement_id is not null then
    perform public.attempt_user_coupon_redemption_for_ecpay_order(v_merchant);
    select o.coupon_redemption_status into v_coupon_status
    from public.ecpay_orders o
    where o.id = v_order.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_fulfilled', false,
    'product_type', v_order.product_type,
    'pack_key', v_order.pack_key,
    'subscription_expires_at', v_grant->>'subscription_expires_at',
    'coupon_redemption_status', v_coupon_status
  );
end;
$$;

revoke all on function public._user_has_paid_membership_ecpay(uuid) from public, anon, authenticated;
revoke all on function public.release_stale_user_coupon_reservations(interval) from public, anon, authenticated;
revoke all on function public.reserve_user_coupon_for_ecpay_order(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_user_coupon_reservation_for_ecpay(text) from public, anon, authenticated;
revoke all on function public.attempt_user_coupon_redemption_for_ecpay_order(text) from public, anon, authenticated;
revoke all on function public.reconcile_ecpay_coupon_redemption_for_service(text) from public, anon, authenticated;
revoke all on function public.issue_user_coupon_entitlement_for_service(uuid, text, timestamptz) from public, anon, authenticated;

grant execute on function public.release_stale_user_coupon_reservations(interval) to service_role;
grant execute on function public.reserve_user_coupon_for_ecpay_order(uuid, uuid, text, text) to service_role;
grant execute on function public.release_user_coupon_reservation_for_ecpay(text) to service_role;
grant execute on function public.attempt_user_coupon_redemption_for_ecpay_order(text) to service_role;
grant execute on function public.reconcile_ecpay_coupon_redemption_for_service(text) to service_role;
grant execute on function public.issue_user_coupon_entitlement_for_service(uuid, text, timestamptz) to service_role;

-- ─── 一般 payment_promo_campaigns：最低 5 折（coupon 不受此限） ───

comment on column public.coupon_campaign_definitions.eligible_product_key is
  '僅限對應 checkout 商品；membership_male = ECPay VIP 月卡（男性 acquisition）';

-- 僅調整「未來仍可能生效」且低於 5 折的列；已結束／已取消保留原始 discount_tenths
update public.payment_promo_campaigns
set
  discount_tenths = 5,
  updated_at = now()
where discount_tenths < 5
  and cancelled_at is null
  and ends_at > now();

alter table public.payment_promo_campaigns
  drop constraint if exists payment_promo_campaigns_discount_tenths_check;

alter table public.payment_promo_campaigns
  add constraint payment_promo_campaigns_discount_tenths_check
  check (
    discount_tenths >= 1
    and discount_tenths <= 10
    and (
      discount_tenths >= 5
      or cancelled_at is not null
      or ends_at <= now()
    )
  );

comment on column public.payment_promo_campaigns.discount_tenths is
  '一般全站特價 1–10；進行中／排程中最低 5 折；已結束／已取消可保留歷史 1–4 折';

create or replace function public._payment_promo_campaign_may_still_apply(
  p_row public.payment_promo_campaigns
)
returns boolean
language sql
stable
as $$
  select p_row.cancelled_at is null and p_row.ends_at > now();
$$;

create or replace function public.payment_promo_campaign_discount_guard()
returns trigger
language plpgsql
as $$
begin
  if public._payment_promo_campaign_may_still_apply(new)
     and new.discount_tenths < 5 then
    raise exception 'GENERAL_PROMO_DISCOUNT_TOO_LOW';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_promo_campaign_discount_guard_trg
  on public.payment_promo_campaigns;
create trigger payment_promo_campaign_discount_guard_trg
  before insert or update of discount_tenths, cancelled_at, ends_at
  on public.payment_promo_campaigns
  for each row
  execute function public.payment_promo_campaign_discount_guard();

create or replace function public._payment_effective_price_ntd(
  p_product_key text,
  p_campaign public.payment_promo_campaigns default public._payment_active_promo_campaign()
)
returns int
language plpgsql
stable
as $$
declare
  v_list int;
  v_tenths int;
  v_factor numeric;
begin
  v_list := public._payment_list_price_ntd(p_product_key);
  if v_list is null then
    return null;
  end if;

  if p_campaign.id is null
     or not public._payment_promo_applies(p_campaign, p_product_key) then
    return v_list;
  end if;

  v_tenths := greatest(p_campaign.discount_tenths, 5);
  v_factor := v_tenths::numeric / 10.0;
  return greatest(1, floor(v_list * v_factor)::int);
end;
$$;

create or replace function public.admin_create_payment_promo_campaign(
  p_label text,
  p_discount_tenths int,
  p_ends_at timestamptz,
  p_product_keys text[] default array['all']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.payment_promo_campaigns;
begin
  if not public.current_user_is_admin() then
    raise exception 'Admin only';
  end if;

  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'Label required';
  end if;

  if p_discount_tenths < 5 or p_discount_tenths > 10 then
    raise exception 'Discount must be 5-10 tenths (minimum 50%% of list price)';
  end if;

  if p_ends_at is null or p_ends_at <= now() then
    raise exception 'End date must be in the future';
  end if;

  if p_product_keys is null or cardinality(p_product_keys) = 0 then
    p_product_keys := array['all']::text[];
  end if;

  insert into public.payment_promo_campaigns (
    label,
    discount_tenths,
    product_keys,
    starts_at,
    ends_at,
    created_by
  )
  values (
    trim(p_label),
    p_discount_tenths,
    p_product_keys,
    now(),
    p_ends_at,
    v_user
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'campaign', to_jsonb(v_row)
  );
end;
$$;

notify pgrst, 'reload schema';
