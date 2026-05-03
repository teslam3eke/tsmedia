-- ============================================================
-- Migration 012: 讓 messages 表可接 Realtime (postgres_changes)
-- 在 Supabase Dashboard > SQL Editor 執行；若已加過可略過
-- ============================================================

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end $$;
