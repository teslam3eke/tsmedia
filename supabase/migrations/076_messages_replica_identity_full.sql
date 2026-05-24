-- 076：messages UPDATE（read_at）需完整 WAL 列，Realtime filter 與 RLS 才能穩定推送給配對雙方。
-- 若已讀仍須離開再進聊天室才更新，請在 Supabase SQL Editor 執行本檔。

alter table public.messages replica identity full;

notify pgrst, 'reload schema';
