-- 135：測試用 — 即時配對聊天暫時縮短為 10 秒。
-- 恢復正式 7 分鐘：
-- update public.app_feature_flags
-- set enabled = false
-- where key in ('instant_match_ten_second_test', 'instant_match_one_minute_test');

insert into public.app_feature_flags (key, enabled)
values ('instant_match_ten_second_test', true)
on conflict (key) do update set enabled = excluded.enabled;

update public.app_feature_flags
set enabled = false
where key = 'instant_match_one_minute_test';

create or replace function public.instant_match_chat_duration_interval()
returns interval
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(
      (select f.enabled
       from public.app_feature_flags f
       where f.key = 'instant_match_ten_second_test'),
      false
    ) then interval '10 seconds'
    when coalesce(
      (select f.enabled
       from public.app_feature_flags f
       where f.key = 'instant_match_one_minute_test'),
      false
    ) then interval '1 minute'
    else interval '7 minutes'
  end;
$$;

comment on function public.instant_match_chat_duration_interval() is
  '即時房聊天長度；10 秒測試旗標優先，其次 1 分鐘測試旗標，預設 7 分鐘。';

notify pgrst, 'reload schema';
