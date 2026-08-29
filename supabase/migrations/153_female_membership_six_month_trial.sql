-- 153：女性折扣碼免費試用改 6 個月；現有女性會員效期延長 5 個月。
-- TSVIP 女性 benefit 改以 female_free_months 計；既有 +5 months 僅套用目前仍有效之女性會員。

alter table public.membership_discount_codes
  add column if not exists female_free_months int not null default 0
    check (female_free_months >= 0);

comment on column public.membership_discount_codes.female_free_months is
  '女性兌換時延長月數；大於 0 時優先於 female_free_days。';

update public.membership_discount_codes
set female_free_months = 6,
    female_free_days = 0,
    updated_at = now()
where code = 'TSVIP';

-- 現有仍有效之女性會員：subscription_expires_at + 5 months（不縮短、不動已到期者）。
update public.profiles
set subscription_expires_at = subscription_expires_at + interval '5 months',
    updated_at = now()
where gender = 'female'
  and account_status = 'active'
  and verification_status = 'approved'
  and subscription_expires_at is not null
  and subscription_expires_at > now();

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
  v_female_benefit boolean;
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

  v_female_benefit :=
    coalesce(v_code.female_free_months, 0) > 0
    or coalesce(v_code.female_free_days, 0) > 0;

  if v_profile.gender = 'female' and v_female_benefit then
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
      'free_months', v_code.female_free_months,
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
  v_grant interval;
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
    and (
      coalesce(c.female_free_months, 0) > 0
      or coalesce(c.female_free_days, 0) > 0
    )
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

  v_grant :=
    case
      when coalesce(v_code.female_free_months, 0) > 0
        then make_interval(months => v_code.female_free_months)
      else make_interval(days => v_code.female_free_days)
    end;

  v_expires :=
    greatest(coalesce(v_profile.subscription_expires_at, now()), now())
    + v_grant;

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
    'free_months', v_code.female_free_months,
    'free_days', v_code.female_free_days,
    'subscription_expires_at', v_expires
  );
end;
$$;

comment on function public.preview_membership_discount_code(text) is
  '預覽折扣碼；女性 TSVIP 等可兌換 free_months 或 free_days 試用。';

comment on function public.redeem_female_membership_discount_code(text) is
  '女性兌換折扣碼免費試用；優先 female_free_months，否則 female_free_days。';

notify pgrst, 'reload schema';
