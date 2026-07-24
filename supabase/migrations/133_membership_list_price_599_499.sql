-- 133：VIP 月卡原價調整（男 599／女 499；須與 membershipProducts.ts / paymentProducts.ts 一致）

create or replace function public._payment_list_price_ntd(p_product_key text)
returns int
language plpgsql
immutable
as $$
begin
  case p_product_key
    when 'membership_male' then return 599;
    when 'membership_female' then return 499;
    when 'heart_5' then return 149;
    when 'super_like_5' then return 199;
    when 'blur_unlock_16' then return 99;
    when 'crown_effect' then return 299;
    else return null;
  end case;
end;
$$;

create or replace function public.grant_monthly_membership_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gender text;
  v_price int;
  v_expires timestamptz;
  v_h int;
  v_s int;
  v_b int;
begin
  if p_user_id is null then
    raise exception 'User required';
  end if;

  select gender, subscription_expires_at
  into v_gender, v_expires
  from public.profiles where id = p_user_id;

  if v_gender is null then
    raise exception 'Profile gender required';
  end if;

  v_price := public._payment_list_price_ntd(
    case when v_gender = 'male' then 'membership_male' else 'membership_female' end
  );

  v_expires := greatest(coalesce(v_expires, now()), now()) + interval '30 days';

  update public.profiles
  set subscription_expires_at = v_expires,
      updated_at = now()
  where id = p_user_id;

  begin
    v_h := public._credit_balance(p_user_id, 'heart');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (p_user_id, 'purchase', 'heart', 5, v_h + 5, 'VIP 月卡：愛心 x5');

    v_s := public._credit_balance(p_user_id, 'super_like');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (p_user_id, 'purchase', 'super_like', 3, v_s + 3, 'VIP 月卡：超級喜歡 x3');

    v_b := public._credit_balance(p_user_id, 'blur_unlock');
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (p_user_id, 'purchase', 'blur_unlock', 20, v_b + 20, 'VIP 月卡：解除拼圖 x20');
  exception
    when others then
      raise warning 'grant_monthly_membership monthly gifts failed for %: %', p_user_id, sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true,
    'price_ntd', v_price,
    'subscription_expires_at', v_expires
  );
end;
$$;

notify pgrst, 'reload schema';
