-- ============================================================
-- 一次性清理 push_subscriptions 殘留 endpoint
-- 在 Supabase Dashboard > SQL Editor 執行。
--
-- 1) 每個 user_id + client_key 只保留 updated_at 最新一筆
-- 2) 刪除 client_key IS NULL 的 legacy 列
-- ============================================================

-- 預覽將刪除的列（可先跑這段確認）
-- with ranked as (
--   select
--     id,
--     user_id,
--     client_key,
--     left(endpoint, 60) as endpoint_preview,
--     updated_at,
--     row_number() over (
--       partition by user_id, client_key
--       order by updated_at desc
--     ) as rn
--   from public.push_subscriptions
--   where client_key is not null
-- )
-- select * from ranked where rn > 1
-- union all
-- select id, user_id, client_key, left(endpoint, 60), updated_at, 0
-- from public.push_subscriptions
-- where client_key is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, client_key
      order by updated_at desc
    ) as rn
  from public.push_subscriptions
  where client_key is not null
)
delete from public.push_subscriptions ps
using ranked r
where ps.id = r.id
  and r.rn > 1;

delete from public.push_subscriptions
where client_key is null;
