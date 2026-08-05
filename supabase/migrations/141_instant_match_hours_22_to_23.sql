-- 141：即時配對加入等候／撮合時段改為台灣時間每日 22:00–23:00。
-- 進行中的場次不強制中斷；instant_match_always_open 測試旗標仍可略過時段。

create or replace function public.instant_match_open_now()
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce(
      (select f.enabled from public.app_feature_flags f where f.key = 'instant_match_always_open'),
      false
    )
    or extract(hour from (current_timestamp at time zone 'Asia/Taipei'))::int = 22;
$$;

comment on function public.instant_match_open_now() is
  '台灣時間每日 22:00–23:00，或 instant_match_always_open 旗標為 true 時開放排隊。';

notify pgrst, 'reload schema';
