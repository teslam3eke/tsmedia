-- ============================================================
-- PostgREST RPC 400 / PG 42601 修正（薄包裝）
--
-- 現象：REST 呼叫 get_daily_discover_deck 回傳
--   "a column definition list is only allowed for functions returning \"record\""
-- 某些 PostgREST 版本對「SECURITY DEFINER + RETURNS jsonb + plpgsql」的 RPC
-- 會產生不合法 SQL；改由 LANGUAGE sql 的一行包裝呼叫實作體，通常可排除。
--
-- 作法：將既有 plpgsql 實作更名為 __get_daily_discover_deck_impl，對外入口改為 sql 包裝。
-- 須已存在 public.get_daily_discover_deck()（見 032／034）。
-- 僅在對外函式仍為 plpgsql 時才 rename，避免重跑 migration 時誤動 sql 包裝。
-- ============================================================

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.proname = 'get_daily_discover_deck'
      and p.pronargs = 0
      and l.lanname = 'plpgsql'
  ) then
    alter function public.get_daily_discover_deck()
      rename to __get_daily_discover_deck_impl;
  end if;
end
$$;

create or replace function public.get_daily_discover_deck()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.__get_daily_discover_deck_impl();
$$;

comment on function public.get_daily_discover_deck() is
  'Daily discover deck RPC; thin sql wrapper over __get_daily_discover_deck_impl for PostgREST.';

grant execute on function public.get_daily_discover_deck() to authenticated;

notify pgrst, 'reload schema';
