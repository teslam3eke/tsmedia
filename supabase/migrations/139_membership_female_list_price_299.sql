-- 139：女性 VIP 月卡原價由 499 調整為 299。
-- 進行中的特價活動仍會依此原價套用折扣；其餘商品價格不變。

create or replace function public._payment_list_price_ntd(p_product_key text)
returns int
language plpgsql
immutable
as $$
begin
  case p_product_key
    when 'membership_male' then return 599;
    when 'membership_female' then return 299;
    when 'heart_5' then return 149;
    when 'super_like_5' then return 199;
    when 'blur_unlock_16' then return 99;
    when 'crown_effect' then return 299;
    else return null;
  end case;
end;
$$;

notify pgrst, 'reload schema';
