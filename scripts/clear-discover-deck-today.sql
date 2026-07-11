-- 清除當 app 日探索 deck／shown（手動測天選前建議先跑）
-- 執行後：硬重整 PWA，勿先開探索再測天選（先進主殼讓 fated_pair_poll）

select public.app_day_key_now() as app_day_key;

delete from public.daily_discover_deck
where app_day_key = public.app_day_key_now();

-- 可選：清指定帳號的「曾出現在探索」紀錄（founding004 測天選常用）
delete from public.daily_discover_shown s
using auth.users u
where u.id = s.viewer_user_id
  and u.email = 'founding004@tsmedia.tw';

-- 確認
select count(*) as deck_rows_today
from public.daily_discover_deck
where app_day_key = public.app_day_key_now();
