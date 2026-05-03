-- ============================================================
-- PostgREST schema cache reload（探索 RPC 400 / PG 42601）
--
-- 若 REST 呼叫 get_daily_discover_deck 回傳：
--   "a column definition list is only allowed for functions returning \"record\""
-- 多半是 PostgREST 快取的函式簽章與實際 `RETURNS jsonb` 不一致，導致產生錯誤 SQL。
-- `NOTIFY pgrst, 'reload schema'` 會請 PostgREST 重載 schema（Supabase 託管環境可用）。
--
-- 套用後請再試 App；若仍 400，於 SQL Editor 確認：
--   select pg_get_function_result(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'get_daily_discover_deck';
-- 應為 jsonb。若非 jsonb，請重新執行 migration 034 的 create or replace。
-- ============================================================

notify pgrst, 'reload schema';
