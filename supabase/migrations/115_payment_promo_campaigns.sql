-- ============================================================
-- 115：後台可管理付費特價（折數、到期日、文宣）；全站定價由 DB 解析
-- ============================================================

create table if not exists public.payment_promo_campaigns (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  discount_tenths smallint not null,
  product_keys text[] not null default array['all']::text[],
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  cancelled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_promo_campaigns_discount_tenths_check
    check (discount_tenths >= 1 and discount_tenths <= 10),
  constraint payment_promo_campaigns_ends_after_starts_check
    check (ends_at > starts_at)
);

comment on table public.payment_promo_campaigns is
  '付費商品特價活動；discount_tenths=2 表示 2 折（原價 × 0.2）';
comment on column public.payment_promo_campaigns.product_keys is
  'all 或 membership / heart_5 / super_like_5 / blur_unlock_16 / crown_effect';

create index if not exists payment_promo_campaigns_active_idx
  on public.payment_promo_campaigns (starts_at, ends_at)
  where cancelled_at is null;

alter table public.payment_promo_campaigns enable row level security;

drop trigger if exists payment_promo_campaigns_updated_at on public.payment_promo_campaigns;
create trigger payment_promo_campaigns_updated_at
  before update on public.payment_promo_campaigns
  for each row execute procedure public.handle_updated_at();

-- ─── 內部：原價常數（須與 membershipProducts.ts / paymentProducts.ts 一致） ───

create or replace function public._payment_list_price_ntd(p_product_key text)
returns int
language plpgsql
immutable
as $$
begin
  case p_product_key
    when 'membership_male' then return 399;
    when 'membership_female' then return 299;
    when 'heart_5' then return 149;
    when 'super_like_5' then return 199;
    when 'blur_unlock_16' then return 99;
    when 'crown_effect' then return 299;
    else return null;
  end case;
end;
$$;

create or replace function public._payment_active_promo_campaign()
returns public.payment_promo_campaigns
language sql
stable
security definer
set search_path = public
as $$
  select c.*
  from public.payment_promo_campaigns c
  where c.cancelled_at is null
    and c.starts_at <= now()
    and c.ends_at > now()
  order by c.created_at desc
  limit 1;
$$;

create or replace function public._payment_promo_applies(
  p_campaign public.payment_promo_campaigns,
  p_product_key text
)
returns boolean
language sql
immutable
as $$
  select p_campaign.id is not null
    and (
      'all' = any (p_campaign.product_keys)
      or p_product_key = any (p_campaign.product_keys)
      or (
        p_product_key in ('membership_male', 'membership_female')
        and 'membership' = any (p_campaign.product_keys)
      )
    );
$$;

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

  v_factor := p_campaign.discount_tenths::numeric / 10.0;
  return greatest(1, round(v_list * v_factor)::int);
end;
$$;

create or replace function public.get_public_payment_pricing()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_campaign public.payment_promo_campaigns := public._payment_active_promo_campaign();
  v_promo jsonb := null;
begin
  if v_campaign.id is not null then
    v_promo := jsonb_build_object(
      'id', v_campaign.id,
      'label', v_campaign.label,
      'discount_tenths', v_campaign.discount_tenths,
      'ends_at', v_campaign.ends_at,
      'product_keys', to_jsonb(v_campaign.product_keys)
    );
  end if;

  return jsonb_build_object(
    'promo', v_promo,
    'membership', jsonb_build_object(
      'male', jsonb_build_object(
        'list_price_ntd', public._payment_list_price_ntd('membership_male'),
        'price_ntd', public._payment_effective_price_ntd('membership_male', v_campaign)
      ),
      'female', jsonb_build_object(
        'list_price_ntd', public._payment_list_price_ntd('membership_female'),
        'price_ntd', public._payment_effective_price_ntd('membership_female', v_campaign)
      )
    ),
    'packs', jsonb_build_object(
      'heart_5', jsonb_build_object(
        'list_price_ntd', public._payment_list_price_ntd('heart_5'),
        'price_ntd', public._payment_effective_price_ntd('heart_5', v_campaign)
      ),
      'super_like_5', jsonb_build_object(
        'list_price_ntd', public._payment_list_price_ntd('super_like_5'),
        'price_ntd', public._payment_effective_price_ntd('super_like_5', v_campaign)
      ),
      'blur_unlock_16', jsonb_build_object(
        'list_price_ntd', public._payment_list_price_ntd('blur_unlock_16'),
        'price_ntd', public._payment_effective_price_ntd('blur_unlock_16', v_campaign)
      ),
      'crown_effect', jsonb_build_object(
        'list_price_ntd', public._payment_list_price_ntd('crown_effect'),
        'price_ntd', public._payment_effective_price_ntd('crown_effect', v_campaign)
      )
    )
  );
end;
$$;

grant execute on function public.get_public_payment_pricing() to authenticated, anon;

-- ─── 管理後台 ───────────────────────────────────────────────────────────────

create or replace function public.admin_list_payment_promo_campaigns()
returns setof public.payment_promo_campaigns
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Admin only';
  end if;

  return query
  select *
  from public.payment_promo_campaigns
  order by created_at desc;
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

  if p_discount_tenths < 1 or p_discount_tenths > 10 then
    raise exception 'Discount must be 1-10 tenths';
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

create or replace function public.admin_cancel_payment_promo_campaign(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_promo_campaigns;
begin
  if not public.current_user_is_admin() then
    raise exception 'Admin only';
  end if;

  update public.payment_promo_campaigns
  set cancelled_at = now(),
      updated_at = now()
  where id = p_id
    and cancelled_at is null
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found_or_already_cancelled');
  end if;

  return jsonb_build_object('ok', true, 'campaign', to_jsonb(v_row));
end;
$$;

grant execute on function public.admin_list_payment_promo_campaigns() to authenticated;
grant execute on function public.admin_create_payment_promo_campaign(text, int, timestamptz, text[]) to authenticated;
grant execute on function public.admin_cancel_payment_promo_campaign(uuid) to authenticated;

-- 延續原 PAYMENT_TEST_MODE 2 折行為（若尚無進行中活動）
insert into public.payment_promo_campaigns (label, discount_tenths, product_keys, starts_at, ends_at)
select
  '試營運特價',
  2,
  array['all']::text[],
  now(),
  timestamptz '2026-12-31 15:59:59+08'
where not exists (
  select 1
  from public.payment_promo_campaigns c
  where c.cancelled_at is null
    and c.ends_at > now()
);

notify pgrst, 'reload schema';
