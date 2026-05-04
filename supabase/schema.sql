-- ============================================================
-- TsMedia — Supabase Schema
-- 在 Supabase Dashboard > SQL Editor 貼上並執行
-- ============================================================

-- ── 1. profiles ─────────────────────────────────────────────
create table if not exists public.profiles (
  id                  uuid references auth.users on delete cascade primary key,
  name                text,
  nickname            text,
  gender              text check (gender in ('male', 'female')),
  age                 int check (age between 18 and 80),
  company             text check (company in ('TSMC', 'MediaTek')),
  job_title           text,
  department          text,
  bio                 text,
  interests           text[],
  -- 隨機抽取的問題 + 作答，格式：[{id, category, text, answer}]
  questionnaire       jsonb,
  -- 生活照的 Supabase Storage 路徑陣列
  photo_urls          text[],
  is_verified         boolean not null default false,
  account_status      text not null default 'active' check (account_status in ('active','suspended','banned')),
  verification_status text not null default 'pending'
                        check (verification_status in ('pending','submitted','approved','rejected')),
  -- 地點欄位
  work_region         text check (work_region in ('north','central','south','east')),
  home_region         text check (home_region in ('north','central','south','east')),
  preferred_region    text check (preferred_region in ('north','central','south','east')),
  -- 收入認證
  income_tier         text check (income_tier in ('silver','gold','diamond')),
  show_income_border  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Migration: add gender column if table already exists ─────────────────────
-- 在 Supabase Dashboard > SQL Editor 執行此段來新增 gender 欄位：
-- alter table public.profiles add column if not exists gender text check (gender in ('male', 'female'));

-- ── Migration: add region columns (work / home / preferred) ───────────────────
-- 在 Supabase Dashboard > SQL Editor 執行下面三行：
-- alter table public.profiles add column if not exists work_region      text check (work_region      in ('north','central','south','east'));
-- alter table public.profiles add column if not exists home_region      text check (home_region      in ('north','central','south','east'));
-- alter table public.profiles add column if not exists preferred_region text check (preferred_region in ('north','central','south','east'));

-- ── Migration: income verification + border effect ────────────────────────────
-- 在 Supabase Dashboard > SQL Editor 執行以下區塊：
-- alter table public.profiles
--   add column if not exists income_tier text check (income_tier in ('silver','gold','diamond')),
--   add column if not exists show_income_border boolean not null default false;
--
-- alter table public.verification_docs
--   add column if not exists verification_kind    text not null default 'employment' check (verification_kind in ('employment','income')),
--   add column if not exists claimed_income_tier  text check (claimed_income_tier in ('silver','gold','diamond'));
--
-- -- Relax doc_type so income docs can use broader categories:
-- alter table public.verification_docs drop constraint if exists verification_docs_doc_type_check;
-- alter table public.verification_docs
--   add constraint verification_docs_doc_type_check
--   check (doc_type in ('employee_id','tax_return','payslip','bank_statement','other'));

-- 自動更新 updated_at
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_profile_updated on public.profiles;
create trigger on_profile_updated
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

-- 新用戶註冊時自動建立空白 profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 2. verification_docs ─────────────────────────────────────
create table if not exists public.verification_docs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users on delete cascade not null,
  company         text check (company in ('TSMC', 'MediaTek')),
  doc_type        text check (doc_type in ('employee_id', 'tax_return', 'payslip')),
  -- Storage path: proofs/{user_id}/{filename}
  doc_url         text,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  submitted_at    timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewer_note   text
);

-- ── 3. Row Level Security ────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.verification_docs enable row level security;

-- profiles: 僅本人可讀寫
create policy "profiles: own read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: own insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);

-- verification_docs: 僅本人可讀寫
create policy "docs: own read"
  on public.verification_docs for select
  using (auth.uid() = user_id);

create policy "docs: own insert"
  on public.verification_docs for insert
  with check (auth.uid() = user_id);

-- ── 4. Storage Buckets ───────────────────────────────────────
-- 在 Supabase Dashboard > Storage 手動建立以下兩個 bucket（設為 private）：
--
--   photos  — 生活照，路徑：photos/{user_id}/{filename}；RLS：本人可寫、已登入可讀（discover 簽名 URL）
--   proofs  — 驗證文件，路徑：proofs/{user_id}/{filename}
--
-- 或執行以下 SQL（需要 storage schema 權限）：

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

-- Storage RLS：寫入僅本人資料夾；讀取允許已登入使用者讀整個 photos（他人頭像簽名 URL）

drop policy if exists "photos: own folder" on storage.objects;

create policy "photos: insert own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: update own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: delete own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos: select authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'photos');

create policy "proofs: own folder"
  on storage.objects for all
  using (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 後台預覽：管理員需能對任意 proofs 路徑建立簽名 URL（與 migration 040 一致）
create policy "proofs: admin select all"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'proofs'
    and public.current_user_is_admin()
  );
