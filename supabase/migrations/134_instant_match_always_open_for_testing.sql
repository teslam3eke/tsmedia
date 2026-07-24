-- 134：測試期間暫時取消即時配對時段限制。
-- 恢復正式 22:00–01:00 時段時，將此旗標改為 false，並同步還原前端
-- src/lib/instantMatchHours.ts 的 TEMPORARILY_ALWAYS_OPEN。

insert into public.app_feature_flags (key, enabled)
values ('instant_match_always_open', true)
on conflict (key) do update set enabled = excluded.enabled;

notify pgrst, 'reload schema';
