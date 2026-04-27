-- ============================================================
-- Migration 003: 站內通知（審核通過 / 拒絕）
-- 在 Supabase Dashboard > SQL Editor 貼上並執行
-- ============================================================

create table if not exists public.app_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade not null,
  kind       text not null check (kind in ('verification_approved', 'verification_rejected')),
  title      text not null,
  body       text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

alter table public.app_notifications enable row level security;

-- 重複執行安全：先移除舊 policy 再建立
drop policy if exists "notifications: own read" on public.app_notifications;
create policy "notifications: own read"
  on public.app_notifications for select
  using (auth.uid() = user_id);

drop policy if exists "notifications: own update" on public.app_notifications;
create policy "notifications: own update"
  on public.app_notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notifications: admin insert" on public.app_notifications;
create policy "notifications: admin insert"
  on public.app_notifications for insert
  with check (public.current_user_is_admin());

create index if not exists app_notifications_user_unread_idx
  on public.app_notifications (user_id, read_at, created_at desc);
