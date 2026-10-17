-- 163：48h acquisition 券不與 membership discount code 疊加（對齊 API 權威規則）
-- 非 destructive：僅 UPDATE 既有 campaign definition；不碰 orders / entitlements。

update public.coupon_campaign_definitions
set
  allows_membership_discount_code = false,
  updated_at = now()
where campaign_key = 'APPROVED_48H_200';

notify pgrst, 'reload schema';
