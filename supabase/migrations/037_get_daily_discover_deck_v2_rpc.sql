-- ============================================================
-- get_daily_discover_deck_v2：繞過 PostgREST 對舊 RPC 名稱的快取／42601
--
-- 若 REST 呼叫 get_daily_discover_deck 仍為 400：
--   "a column definition list is only allowed for functions returning \"record\""
-- 即使已跑 036 sql 包裝，可能是同一個 exposed name 的中繼資料未更新。
-- 使用全新函式名讓 PostgREST 重新解析（仍委派 __get_daily_discover_deck_impl）。
--
-- 前置：須已存在 public.__get_daily_discover_deck_impl（migration 036）。
-- ============================================================

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = '__get_daily_discover_deck_impl'
  ) then
    raise exception 'Missing __get_daily_discover_deck_impl — apply migration 036 first.';
  end if;
end
$$;

create or replace function public.get_daily_discover_deck_v2()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.__get_daily_discover_deck_impl();
$$;

comment on function public.get_daily_discover_deck_v2() is
  'Explore deck RPC (REST calls this name); bypasses PostgREST stale cache on get_daily_discover_deck.';

grant execute on function public.get_daily_discover_deck_v2() to authenticated;

notify pgrst, 'reload schema';
