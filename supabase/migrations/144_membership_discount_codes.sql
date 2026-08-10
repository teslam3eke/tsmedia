-- 144：30 天會員專用折扣碼。
-- TSVIP：男性於活動價再折 NT$100；女性免金流直接延長 30 天。
-- 女性可於到期或剩餘 3 天內重複兌換；免費兌換不發放付費月卡購買禮。

create table if not exists public.membership_discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  male_discount_ntd int not null default 0 check (male_discount_ntd >= 0),
  female_free_days int not null default 0 check (female_free_days >= 0),
  enabled boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code = upper(trim(code)) and length(code) between 3 and 40),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.membership_discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.membership_discount_codes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  benefit_kind text not null check (benefit_kind in ('female_free')),
  subscription_expires_at timestamptz not null,
  redeemed_at timestamptz not null default now()
);

create index if not exists membership_discount_redemptions_user_idx
  on public.membership_discount_redemptions (user_id, redeemed_at desc);

alter table public.membership_discount_codes enable row level security;
alter table public.membership_discount_redemptions enable row level security;

drop policy if exists "membership discount codes: no direct access"
  on public.membership_discount_codes;
create policy "membership discount codes: no direct access"
  on public.membership_discount_codes for all
  using (false)
  with check (false);

drop policy if exists "membership discount redemptions: no direct access"
  on public.membership_discount_redemptions;
create policy "membership discount redemptions: no direct access"
  on public.membership_discount_redemptions for all
  using (false)
  with check (false);

drop trigger if exists membership_discount_codes_updated_at
  on public.membership_discount_codes;
create trigger membership_discount_codes_updated_at
  before update on public.membership_discount_codes
  for each row execute procedure public.handle_updated_at();

insert into public.membership_discount_codes (
  code,
  male_discount_ntd,
  female_free_days,
  enabled
)
values ('TSVIP', 100, 30, true)
on conflict (code) do update
set male_discount_ntd = excluded.male_discount_ntd,
    female_free_days = excluded.female_free_days,
    enabled = excluded.enabled,
    updated_at = now();

create or replace function public.preview_membership_discount_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code public.membership_discount_codes;
  v_profile public.profiles;
  v_price int;
  v_available_at timestamptz;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_user;

  if v_profile.id is null
     or v_profile.account_status is distinct from 'active'
     or v_profile.verification_status is distinct from 'approved'
  then
    return jsonb_build_object('ok', false, 'reason', 'membership_not_eligible');
  end if;

  select *
  into v_code
  from public.membership_discount_codes c
  where c.code = upper(trim(coalesce(p_code, '')))
    and c.enabled = true
    and c.starts_at <= now()
    and (c.ends_at is null or c.ends_at > now())
  limit 1;

  if v_code.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  if v_profile.gender = 'male' and v_code.male_discount_ntd > 0 then
    v_price := public._payment_effective_price_ntd('membership_male');
    return jsonb_build_object(
      'ok', true,
      'benefit', 'male_discount',
      'code', v_code.code,
      'discount_ntd', v_code.male_discount_ntd,
      'base_price_ntd', v_price,
      'final_price_ntd', greatest(1, v_price - v_code.male_discount_ntd)
    );
  end if;

  if v_profile.gender = 'female' and v_code.female_free_days > 0 then
    if v_profile.subscription_expires_at is not null
       and v_profile.subscription_expires_at > now() + interval '3 days'
    then
      v_available_at := v_profile.subscription_expires_at - interval '3 days';
      return jsonb_build_object(
        'ok', false,
        'reason', 'too_early',
        'available_at', v_available_at
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'benefit', 'female_free',
      'code', v_code.code,
      'free_days', v_code.female_free_days
    );
  end if;

  return jsonb_build_object('ok', false, 'reason', 'not_applicable');
end;
$$;

create or replace function public.redeem_female_membership_discount_code(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code public.membership_discount_codes;
  v_profile public.profiles;
  v_expires timestamptz;
  v_available_at timestamptz;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_user
  for update;

  if v_profile.id is null
     or v_profile.gender is distinct from 'female'
     or v_profile.account_status is distinct from 'active'
     or v_profile.verification_status is distinct from 'approved'
  then
    return jsonb_build_object('ok', false, 'reason', 'membership_not_eligible');
  end if;

  select *
  into v_code
  from public.membership_discount_codes c
  where c.code = upper(trim(coalesce(p_code, '')))
    and c.enabled = true
    and c.starts_at <= now()
    and (c.ends_at is null or c.ends_at > now())
    and c.female_free_days > 0
  limit 1;

  if v_code.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  if v_profile.subscription_expires_at is not null
     and v_profile.subscription_expires_at > now() + interval '3 days'
  then
    v_available_at := v_profile.subscription_expires_at - interval '3 days';
    return jsonb_build_object(
      'ok', false,
      'reason', 'too_early',
      'available_at', v_available_at
    );
  end if;

  v_expires :=
    greatest(coalesce(v_profile.subscription_expires_at, now()), now())
    + make_interval(days => v_code.female_free_days);

  update public.profiles
  set subscription_expires_at = v_expires,
      updated_at = now()
  where id = v_user;

  insert into public.membership_discount_redemptions (
    code_id,
    user_id,
    benefit_kind,
    subscription_expires_at
  )
  values (
    v_code.id,
    v_user,
    'female_free',
    v_expires
  );

  return jsonb_build_object(
    'ok', true,
    'benefit', 'female_free',
    'free_days', v_code.female_free_days,
    'subscription_expires_at', v_expires
  );
end;
$$;

revoke all on function public.preview_membership_discount_code(text) from public;
revoke all on function public.redeem_female_membership_discount_code(text) from public;
grant execute on function public.preview_membership_discount_code(text) to authenticated;
grant execute on function public.redeem_female_membership_discount_code(text) to authenticated;

alter table public.ecpay_orders
  add column if not exists membership_discount_code text;

notify pgrst, 'reload schema';
