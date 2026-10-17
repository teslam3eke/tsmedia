-- 164：Acquisition coupon lifecycle 核心（anchor、unique、issue v2、email delivery 基礎）
-- 不 backfill anchor；不建 cron；不寄信。

-- ─── 1) Lifecycle anchor（男性首次 approved 寫入一次） ───

alter table public.profiles
  add column if not exists acquisition_lifecycle_anchor_at timestamptz;

comment on column public.profiles.acquisition_lifecycle_anchor_at is
  '男性首次取得 approved 資格時間（immutable）；供 48h/7d acquisition lifecycle；不 backfill 舊會員。';

create or replace function public._profiles_guard_acquisition_lifecycle_anchor()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.acquisition_lifecycle_anchor_at is not null then
      new.acquisition_lifecycle_anchor_at := old.acquisition_lifecycle_anchor_at;
    elsif new.gender = 'male'
      and new.verification_status = 'approved'::public.profile_verification_status
      and old.verification_status is distinct from 'approved'::public.profile_verification_status
      and new.acquisition_lifecycle_anchor_at is null then
      new.acquisition_lifecycle_anchor_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_acquisition_lifecycle_anchor on public.profiles;
create trigger profiles_guard_acquisition_lifecycle_anchor
  before update on public.profiles
  for each row
  execute procedure public._profiles_guard_acquisition_lifecycle_anchor();

-- ─── 2) user + campaign 唯一（Production 安全 dedupe 後建 UNIQUE） ───

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, campaign_key
      order by issued_at asc, id asc
    ) as rn
  from public.user_coupon_entitlements
)
delete from public.user_coupon_entitlements e
using ranked r
where e.id = r.id
  and r.rn > 1;

create unique index if not exists user_coupon_entitlements_user_campaign_uidx
  on public.user_coupon_entitlements (user_id, campaign_key);

-- ─── 3) Authoritative：曾成功付費 VIP（不含 complete_monthly_membership 模擬） ───

create or replace function public.user_has_ever_paid_vip_membership(p_user_id uuid)
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
    from public.newebpay_orders n
    where n.user_id = p_user_id
      and n.product_type = 'membership'
      and n.status = 'paid'
  )
  or exists (
    select 1
    from public.subscription_payment_events e
    where e.user_id = p_user_id
  );
$$;

comment on function public.user_has_ever_paid_vip_membership(uuid) is
  '曾成功付費 VIP（ECPay / NewebPay membership paid / subscription_payment_events）；不含 mock complete_monthly_membership。';

create or replace function public._user_has_paid_membership_ecpay(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_ever_paid_vip_membership(p_user_id);
$$;

revoke all on function public.user_has_ever_paid_vip_membership(uuid) from public, anon, authenticated;
grant execute on function public.user_has_ever_paid_vip_membership(uuid) to service_role;

-- ─── 4) Issue V2（service_role、idempotent、固定 issued_at / expires_at） ───

create or replace function public._acquisition_lifecycle_campaign_expires_at(
  p_campaign_key text,
  p_issued_at timestamptz
)
returns timestamptz
language sql
immutable
as $$
  select case
    when p_campaign_key in ('APPROVED_48H_200', 'APPROVED_7D_30PCT') then
      p_issued_at + interval '48 hours'
    else null
  end;
$$;

create or replace function public._acquisition_lifecycle_issue_window_met(
  p_campaign_key text,
  p_anchor timestamptz
)
returns boolean
language sql
stable
as $$
  select case
    when p_campaign_key = 'APPROVED_48H_200' then now() >= p_anchor + interval '48 hours'
    when p_campaign_key = 'APPROVED_7D_30PCT' then now() >= p_anchor + interval '7 days'
    else false
  end;
$$;

create or replace function public.issue_acquisition_coupon_entitlement_v2(
  p_user_id uuid,
  p_campaign_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := nullif(btrim(p_campaign_key), '');
  v_existing public.user_coupon_entitlements%rowtype;
  v_profile public.profiles%rowtype;
  v_def public.coupon_campaign_definitions%rowtype;
  v_issued timestamptz;
  v_expires timestamptz;
begin
  if p_user_id is null or v_key is null then
    raise exception 'COUPON_INVALID_REQUEST';
  end if;

  if v_key not in ('APPROVED_48H_200', 'APPROVED_7D_30PCT') then
    raise exception 'COUPON_CAMPAIGN_NOT_LIFECYCLE';
  end if;

  select * into v_existing
  from public.user_coupon_entitlements e
  where e.user_id = p_user_id
    and e.campaign_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_existed', true,
      'entitlement_id', v_existing.id,
      'campaign_key', v_existing.campaign_key,
      'issued_at', v_existing.issued_at,
      'expires_at', v_existing.expires_at,
      'status', v_existing.status
    );
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = p_user_id;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if v_profile.gender is distinct from 'male' then
    raise exception 'COUPON_MALE_ONLY';
  end if;

  if v_profile.verification_status is distinct from 'approved'::public.profile_verification_status then
    raise exception 'COUPON_LIFECYCLE_NOT_APPROVED';
  end if;

  if v_profile.acquisition_lifecycle_anchor_at is null then
    raise exception 'COUPON_LIFECYCLE_ANCHOR_MISSING';
  end if;

  if public.user_has_ever_paid_vip_membership(p_user_id) then
    raise exception 'COUPON_NOT_FIRST_MEMBERSHIP_PURCHASE';
  end if;

  if not public._acquisition_lifecycle_issue_window_met(v_key, v_profile.acquisition_lifecycle_anchor_at) then
    raise exception 'COUPON_LIFECYCLE_TOO_EARLY';
  end if;

  select * into v_def
  from public.coupon_campaign_definitions d
  where d.campaign_key = v_key
    and d.enabled;

  if not found then
    raise exception 'COUPON_CAMPAIGN_DISABLED';
  end if;

  v_issued := now();
  v_expires := public._acquisition_lifecycle_campaign_expires_at(v_key, v_issued);

  begin
    insert into public.user_coupon_entitlements (
      user_id,
      campaign_key,
      issued_at,
      expires_at,
      status
    )
    values (
      p_user_id,
      v_key,
      v_issued,
      v_expires,
      'available'
    )
    returning * into v_existing;
  exception
    when unique_violation then
      select * into v_existing
      from public.user_coupon_entitlements e
      where e.user_id = p_user_id
        and e.campaign_key = v_key;
  end;

  if not found then
    raise exception 'COUPON_ISSUE_FAILED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_existed', false,
    'entitlement_id', v_existing.id,
    'campaign_key', v_existing.campaign_key,
    'issued_at', v_existing.issued_at,
    'expires_at', v_existing.expires_at,
    'status', v_existing.status
  );
end;
$$;

revoke all on function public.issue_acquisition_coupon_entitlement_v2(uuid, text) from public, anon, authenticated;
grant execute on function public.issue_acquisition_coupon_entitlement_v2(uuid, text) to service_role;

-- ─── 5) Coupon Email delivery 基礎（不寄信） ───

create table if not exists public.acquisition_coupon_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null
    references public.user_coupon_entitlements (id) on delete cascade,
  sent_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  last_error text,
  in_flight_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists acquisition_coupon_email_deliveries_entitlement_uidx
  on public.acquisition_coupon_email_deliveries (entitlement_id);

alter table public.acquisition_coupon_email_deliveries enable row level security;

drop policy if exists "acquisition coupon email deliveries: no direct access"
  on public.acquisition_coupon_email_deliveries;
create policy "acquisition coupon email deliveries: no direct access"
  on public.acquisition_coupon_email_deliveries for all
  using (false)
  with check (false);

revoke all on table public.acquisition_coupon_email_deliveries from anon, authenticated;

drop trigger if exists acquisition_coupon_email_deliveries_updated_at
  on public.acquisition_coupon_email_deliveries;
create trigger acquisition_coupon_email_deliveries_updated_at
  before update on public.acquisition_coupon_email_deliveries
  for each row execute procedure public.handle_updated_at();

create or replace function public.claim_acquisition_coupon_email_delivery(
  p_entitlement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent public.user_coupon_entitlements%rowtype;
  v_row public.acquisition_coupon_email_deliveries%rowtype;
begin
  if p_entitlement_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_entitlement_id');
  end if;

  select * into v_ent
  from public.user_coupon_entitlements e
  where e.id = p_entitlement_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'entitlement_not_found');
  end if;

  insert into public.acquisition_coupon_email_deliveries (entitlement_id)
  values (p_entitlement_id)
  on conflict (entitlement_id) do nothing;

  select * into v_row
  from public.acquisition_coupon_email_deliveries d
  where d.entitlement_id = p_entitlement_id
  for update;

  if v_row.sent_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;

  if v_row.in_flight_until is not null and v_row.in_flight_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'in_flight');
  end if;

  update public.acquisition_coupon_email_deliveries
  set
    attempts = coalesce(attempts, 0) + 1,
    last_attempt_at = now(),
    in_flight_until = now() + interval '90 seconds'
  where entitlement_id = p_entitlement_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'entitlement_id', v_row.entitlement_id,
    'user_id', v_ent.user_id,
    'campaign_key', v_ent.campaign_key
  );
end;
$$;

create or replace function public.mark_acquisition_coupon_email_sent(
  p_entitlement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_entitlement_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_entitlement_id');
  end if;

  update public.acquisition_coupon_email_deliveries
  set
    sent_at = coalesce(sent_at, now()),
    in_flight_until = null,
    last_error = null
  where entitlement_id = p_entitlement_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_acquisition_coupon_email_in_flight(
  p_entitlement_id uuid,
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
  if p_entitlement_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_entitlement_id');
  end if;

  update public.acquisition_coupon_email_deliveries
  set
    in_flight_until = null,
    last_error = coalesce(v_err, last_error)
  where entitlement_id = p_entitlement_id
    and sent_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.claim_acquisition_coupon_email_delivery(uuid) from public, anon, authenticated;
revoke all on function public.mark_acquisition_coupon_email_sent(uuid) from public, anon, authenticated;
revoke all on function public.release_acquisition_coupon_email_in_flight(uuid, text) from public, anon, authenticated;

grant execute on function public.claim_acquisition_coupon_email_delivery(uuid) to service_role;
grant execute on function public.mark_acquisition_coupon_email_sent(uuid) to service_role;
grant execute on function public.release_acquisition_coupon_email_in_flight(uuid, text) to service_role;

notify pgrst, 'reload schema';
