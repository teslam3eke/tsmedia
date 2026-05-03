-- ============================================================
-- 039: 探索 RPC 不可標成 STABLE — 否則 PostgREST 以唯讀交易執行
--
-- 現象：get_daily_discover_deck_v2 回傳 PG 25006
--   "cannot execute INSERT in a read-only transaction"
-- 原因：薄包裝函式被宣告為 STABLE；PostgREST 對 STABLE/IMMUTABLE 的 RPC
--       使用 read-only transaction，而 __get_daily_discover_deck_impl
--       會 insert/delete daily_discover_deck、insert daily_discover_shown。
-- 修正：改為 VOLATILE（有副作用的函式之正確分類）。
-- ============================================================

create or replace function public.get_daily_discover_deck()
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  select public.__get_daily_discover_deck_impl();
$$;

comment on function public.get_daily_discover_deck() is
  'Daily discover deck RPC; thin sql wrapper over __get_daily_discover_deck_impl for PostgREST.';

grant execute on function public.get_daily_discover_deck() to authenticated;

create or replace function public.get_daily_discover_deck_v2()
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  select public.__get_daily_discover_deck_impl();
$$;

comment on function public.get_daily_discover_deck_v2() is
  'Explore deck RPC (REST calls this name); bypasses PostgREST stale cache on get_daily_discover_deck.';

grant execute on function public.get_daily_discover_deck_v2() to authenticated;

notify pgrst, 'reload schema';
