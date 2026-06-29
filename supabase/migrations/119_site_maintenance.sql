-- 119：全站維護模式（app_feature_flags + 公開 RPC，恢復時 UPDATE enabled = false）

insert into public.app_feature_flags (key, enabled)
values ('site_maintenance', true)
on conflict (key) do update set enabled = excluded.enabled;

create or replace function public.get_site_public_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'maintenance', coalesce(
      (select f.enabled from public.app_feature_flags f where f.key = 'site_maintenance'),
      false
    )
  );
$$;

comment on function public.get_site_public_status() is
  '匿名可讀：全站維護旗標。關閉維護：update app_feature_flags set enabled = false where key = ''site_maintenance'';';

grant execute on function public.get_site_public_status() to anon, authenticated;

notify pgrst, 'reload schema';
