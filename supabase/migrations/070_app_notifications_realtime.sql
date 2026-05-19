-- Realtime：站內通知 INSERT → MainScreen 即時彈窗（取代 5s poll）
alter publication supabase_realtime add table public.app_notifications;

notify pgrst, 'reload schema';
