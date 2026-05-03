-- ============================================================
-- Migration 008: 服務條款同意紀錄 + 檢舉功能
-- 在 Supabase Dashboard > SQL Editor 貼上並執行
-- ============================================================

alter table public.profiles
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

create table if not exists public.profile_reports (
  id                    uuid primary key default gen_random_uuid(),
  reporter_user_id      uuid references auth.users on delete cascade not null,
  reported_user_id      uuid references auth.users on delete set null,
  reported_profile_key  text not null,
  reported_display_name text,
  reason                text not null check (reason in (
    'fake_profile',
    'married_or_not_single',
    'harassment',
    'scam_or_sales',
    'inappropriate_content',
    'privacy_violation',
    'other'
  )),
  details               text,
  status                text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at            timestamptz not null default now(),
  reviewed_at           timestamptz,
  reviewer_note         text
);

create index if not exists profile_reports_reporter_idx
  on public.profile_reports (reporter_user_id, created_at desc);

create index if not exists profile_reports_status_idx
  on public.profile_reports (status, created_at desc);

alter table public.profile_reports enable row level security;

drop policy if exists "reports: own insert" on public.profile_reports;
create policy "reports: own insert"
  on public.profile_reports for insert
  with check (reporter_user_id = auth.uid());

drop policy if exists "reports: own read" on public.profile_reports;
create policy "reports: own read"
  on public.profile_reports for select
  using (reporter_user_id = auth.uid());

drop policy if exists "reports: admin read" on public.profile_reports;
create policy "reports: admin read"
  on public.profile_reports for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

drop policy if exists "reports: admin update" on public.profile_reports;
create policy "reports: admin update"
  on public.profile_reports for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );
