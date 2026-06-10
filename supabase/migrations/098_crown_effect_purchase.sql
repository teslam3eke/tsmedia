-- 098：皇冠特效 — 男性限購一次、永久解鎖（profiles.crown_effect_purchased_at）

alter table public.profiles
  add column if not exists crown_effect_purchased_at timestamptz;

create or replace function public.grant_credit_pack_for_user(p_user_id uuid, p_pack_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super int;
  v_blur int;
  v_amount int;
  v_gender text;
  v_purchased timestamptz;
begin
  if p_user_id is null then
    raise exception 'User required';
  end if;

  if p_pack_key = 'super_like_5' then
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

  if p_pack_key not in ('super_like_5', 'blur_unlock_16', 'crown_effect') then
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

notify pgrst, 'reload schema';
