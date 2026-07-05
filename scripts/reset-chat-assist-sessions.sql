-- =============================================================================
-- 清空所有聊天小助手場次（測試用）
-- =============================================================================
-- 效果：刪除 match_chat_assist_sessions（answers／claims 隨 FK cascade）
-- 不動：match_puzzle_manual_unlocks（已領的小助手拼圖格保留）
--
-- Supabase Dashboard → SQL Editor → 整份貼上執行
-- =============================================================================

begin;

delete from public.match_chat_assist_sessions;

commit;
