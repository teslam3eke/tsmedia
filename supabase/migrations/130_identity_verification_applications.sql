-- 130：身分認證申請（整包人工審核）— 不限 TSMC/MediaTek，新增 application 聚合

-- ── 1) profiles.company 改自由文字 ─────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_company_check;
alter table public.verification_docs drop constraint if exists verification_docs_company_check;

-- ── 2) verification_kind 擴充 identity / bonus ───────────────────────────────
alter table public.verification_docs drop constraint if exists verification_docs_verification_kind_check;
alter table public.verification_docs
  add constraint verification_docs_verification_kind_check
  check (verification_kind in ('employment', 'income', 'identity', 'bonus'));

-- ── 3) doc_type 擴充政府證件 ─────────────────────────────────────────────────
alter table public.verification_docs drop constraint if exists verification_docs_doc_type_check;
alter table public.verification_docs
  add constraint verification_docs_doc_type_check
  check (doc_type in (
    'national_id', 'passport', 'driver_license',
    'employee_id', 'tax_return', 'payslip', 'bank_statement', 'other'
  ));

-- ── 4) verification_applications ─────────────────────────────────────────────
-- 可重複執行：型別已存在時略過
do $$ begin
  create type public.verification_application_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

create table if not exists public.verification_applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  status        public.verification_application_status not null default 'pending',
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewer_note text
);

create index if not exists verification_applications_user_submitted_idx
  on public.verification_applications (user_id, submitted_at desc);

create index if not exists verification_applications_status_submitted_idx
  on public.verification_applications (status, submitted_at asc);

alter table public.verification_docs
  add column if not exists application_id uuid references public.verification_applications(id) on delete set null;

create index if not exists verification_docs_application_id_idx
  on public.verification_docs (application_id);

-- ── 5) RLS ───────────────────────────────────────────────────────────────────
alter table public.verification_applications enable row level security;

drop policy if exists "verification_applications: own read" on public.verification_applications;
create policy "verification_applications: own read"
  on public.verification_applications for select
  using (auth.uid() = user_id);

drop policy if exists "verification_applications: own insert" on public.verification_applications;
create policy "verification_applications: own insert"
  on public.verification_applications for insert
  with check (auth.uid() = user_id);

-- 前端送審失敗時 rollback 剛建立的 pending 列（無此 policy 會殘留空申請，卡住重送）
drop policy if exists "verification_applications: own delete pending" on public.verification_applications;
create policy "verification_applications: own delete pending"
  on public.verification_applications for delete
  using (auth.uid() = user_id and status = 'pending');

-- 送審 rollback 用：若 application 建立後 docs/profile 任一步失敗，前端可刪掉本人 pending 文件列。
drop policy if exists "verification_docs: own delete pending application docs" on public.verification_docs;
create policy "verification_docs: own delete pending application docs"
  on public.verification_docs for delete
  using (
    auth.uid() = user_id
    and status = 'pending'
    and application_id is not null
  );

drop policy if exists "verification_applications: admin read all" on public.verification_applications;
create policy "verification_applications: admin read all"
  on public.verification_applications for select
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));

drop policy if exists "verification_applications: admin update all" on public.verification_applications;
create policy "verification_applications: admin update all"
  on public.verification_applications for update
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));

-- ── 6) Storage：管理員可刪除 proofs（審核通過後清除證件）────────────────────
drop policy if exists "proofs: admin delete all" on storage.objects;
create policy "proofs: admin delete all"
  on storage.objects for delete
  using (
    bucket_id = 'proofs'
    and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
    )
  );

-- ── 7) 舊帳號處理（已定案：舊用戶放行，避免配對池歸零無法測試）──────────────
-- 固定 cutoff，避免未來重跑 migration 時誤放行後續新註冊／新送審者。
-- 已有生活照的舊帳號直接視為通過；沒有生活照者仍須先補生活照，否則無法配對。
update public.profiles
set verification_status = 'approved', is_verified = true
where created_at < timestamptz '2026-07-08 17:30:00+08'
  and account_status = 'active'
  and coalesce(array_length(photo_urls, 1), 0) >= 1;

notify pgrst, 'reload schema';
