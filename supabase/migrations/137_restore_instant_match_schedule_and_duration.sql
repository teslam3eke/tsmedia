-- 137：結束即時配對測試設定，恢復正式時段與 7 分鐘聊天。
-- 時段由 instant_match_open_now() 依台北時間 22:00–01:00 判斷；
-- 聊天長度由 instant_match_chat_duration_interval() 的預設分支回傳 7 分鐘。

insert into public.app_feature_flags (key, enabled)
values
  ('instant_match_always_open', false),
  ('instant_match_ten_second_test', false),
  ('instant_match_one_minute_test', false)
on conflict (key) do update set enabled = excluded.enabled;

notify pgrst, 'reload schema';
