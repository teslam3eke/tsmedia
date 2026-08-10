-- 145：停止女性首次審核通過時自動贈送 30 天 VIP。
-- 女性免費試用改由折扣碼流程主動兌換；既有會員效期不回收、不縮短。

drop trigger if exists profiles_grant_female_membership_on_first_approval
  on public.profiles;

drop function if exists public.grant_female_membership_on_first_approval();

notify pgrst, 'reload schema';
