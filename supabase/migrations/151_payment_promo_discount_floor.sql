-- 151：特價折扣後金額改為無條件捨去（floor）。
-- 例：男會員原價 599、5 折 → 299.5 元，round 會變 300，floor 為 299。

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
  return greatest(1, floor(v_list * v_factor)::int);
end;
$$;

notify pgrst, 'reload schema';
