-- 109：愛心加購包 + 每次購買 VIP 月卡均贈 5 愛心／3 超喜／20 拼圖

create or replace function public.grant_credit_pack_for_user(p_user_id uuid, p_pack_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_heart int;
  v_super int;
  v_blur int;
  v_amount int;
  v_gender text;
  v_purchased timestamptz;
begin
  if p_user_id is null then
    raise exception 'User required';
  end if;

  if p_pack_key = 'heart_5' then
    v_amount := 5;
    v_heart := public._credit_balance(p_user_id, 'heart');
    insert into public.credit_transactions (
      user_id, kind, credit_type, amount, balance_after, description, related_ref
    )
    values (
      p_user_id,
      'purchase',
      'heart',
      v_amount,
      v_heart + v_amount,
      '加購道具：愛心 x5',
      'pack:heart_5'
    );
    return jsonb_build_object('ok', true, 'pack_key', p_pack_key, 'heart', v_amount);

  elsif p_pack_key = 'super_like_5' then
    v_amount := 5;
    v_super := public._credit_balance(p_user_id, 'super_like');
    insert into public.credit_transactions (
      user_id, kind, credit_type, amount, balance_after, description, related_ref
    )
    values (
      p_user_id,
      'purchase',
      'super_like',
      v_amount,
      v_super + v_amount,
      '加購道具：超級喜歡 x5',
      'pack:super_like_5'
    );
    return jsonb_build_object('ok', true, 'pack_key', p_pack_key, 'super_like', v_amount);

  elsif p_pack_key = 'blur_unlock_16' then
    v_amount := 16;
    v_blur := public._credit_balance(p_user_id, 'blur_unlock');
    insert into public.credit_transactions (
      user_id, kind, credit_type, amount, balance_after, description, related_ref
    )
    values (
      p_user_id,
      'purchase',
      'blur_unlock',
      v_amount,
      v_blur + v_amount,
      '加購道具：解除拼圖 x16',
      'pack:blur_unlock_16'
    );
    return jsonb_build_object('ok', true, 'pack_key', p_pack_key, 'blur_unlock', v_amount);

  elsif p_pack_key = 'crown_effect' then
    select p.gender::text, p.crown_effect_purchased_at
    into v_gender, v_purchased
    from public.profiles p
    where p.id = p_user_id;

    if v_gender is distinct from 'male' then
      raise exception 'CROWN_EFFECT_MALE_ONLY';
    end if;

    if v_purchased is not null then
      return jsonb_build_object('ok', true, 'pack_key', p_pack_key, 'already_purchased', true);
    end if;

    update public.profiles
    set crown_effect_purchased_at = now(),
        updated_at = now()
    where id = p_user_id;

    return jsonb_build_object('ok', true, 'pack_key', p_pack_key, 'crown_effect', true);

  else
    raise exception 'Invalid pack';
  end if;
end;
$$;

create or replace function public.purchase_credit_pack(p_pack_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_purchased timestamptz;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if p_pack_key not in ('heart_5', 'super_like_5', 'blur_unlock_16', 'crown_effect') then
    raise exception 'Invalid pack';
  end if;

  if p_pack_key = 'crown_effect' then
    select crown_effect_purchased_at into v_purchased
    from public.profiles
    where id = v_user;

    if v_purchased is not null then
      return jsonb_build_object('ok', false, 'reason', 'already_purchased');
    end if;
  end if;

  return public.grant_credit_pack_for_user(v_user, p_pack_key);
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

  v_price := case when v_gender = 'male' then 399 else 299 end;

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
