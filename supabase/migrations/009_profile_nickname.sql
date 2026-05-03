-- ============================================================
-- Migration 009: 公開顯示暱稱
-- 真實姓名保留給認證使用；探索、配對、聊天應優先顯示 nickname。
-- ============================================================

alter table public.profiles
  add column if not exists nickname text;

