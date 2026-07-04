-- 120：測試用 — app_feature_flags.instant_match_always_open=true 時任何時間可排隊／撮合
-- 恢復正式時段：update app_feature_flags set enabled = false where key = 'instant_match_always_open';

insert into public.app_feature_flags (key, enabled)
values ('instant_match_always_open', true)
on conflict (key) do update set enabled = excluded.enabled;

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
    or extract(hour from (current_timestamp at time zone 'Asia/Taipei'))::int >= 22
    or extract(hour from (current_timestamp at time zone 'Asia/Taipei'))::int < 1;
$$;

comment on function public.instant_match_open_now() is
  '台灣 22:00–01:00 或 instant_match_always_open 旗標為 true 時開放排隊。';

notify pgrst, 'reload schema';
