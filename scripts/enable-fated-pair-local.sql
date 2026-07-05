-- 本地／Staging 測試用（任意 app 日可 poll）
-- 正式排程請改跑 disable-fated-pair-test-flags.sql
-- 排程（台北 app 日 22:00 換日）：週四地選、週五天選

update public.app_feature_flags
set enabled = true
where key = 'fated_pair_enabled';

update public.app_feature_flags
set enabled = false
where key in ('fated_pair_any_day_heaven', 'fated_pair_any_day_earth');

-- 任意 app 日同時測天選＋地選（本地常用）：
update public.app_feature_flags
set enabled = true
where key = 'fated_pair_any_day';

-- 或分開測（同日只跑其中一種）：
-- update public.app_feature_flags set enabled = true where key = 'fated_pair_any_day_heaven';
-- update public.app_feature_flags set enabled = true where key = 'fated_pair_any_day_earth';

-- 若要重跑當日批次指派（改 MBTI 後重測）：
-- delete from public.fated_pair_assignments where app_day_key = public.app_day_key_now();
-- delete from public.fated_pair_batch_runs where app_day_key = public.app_day_key_now();
-- delete from public.fated_pair_user_day_state where app_day_key = public.app_day_key_now();
-- delete from public.daily_discover_deck where app_day_key = public.app_day_key_now();
--
-- 若曾誤點 X／背景被記成「今日略過」，清當日 state 即可再彈：
-- update public.fated_pair_user_day_state set heaven_dismissed = false, earth_dismissed = false
--   where app_day_key = public.app_day_key_now();
