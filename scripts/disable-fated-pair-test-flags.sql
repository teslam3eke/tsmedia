-- 正式環境：週四 app 日地選、週五 app 日天選（關閉任意日測試旗標）

update public.app_feature_flags
set enabled = true
where key = 'fated_pair_enabled';

update public.app_feature_flags
set enabled = false
where key in (
  'fated_pair_any_day',
  'fated_pair_any_day_heaven',
  'fated_pair_any_day_earth',
  'instant_match_always_open'
);

-- 確認：
-- select key, enabled from public.app_feature_flags
-- where key like 'fated_pair%' or key = 'instant_match_always_open'
-- order by key;
-- select public.app_day_key_now(), public.fated_pair_heaven_active_for_day(), public.fated_pair_earth_active_for_day(), public.instant_match_open_now();
