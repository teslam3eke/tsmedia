-- ============================================================
-- Migration 002: 管理員欄位 + AI 初審結果欄位
-- 在 Supabase Dashboard > SQL Editor 貼上並執行
-- ============================================================

-- 1. profiles 加入 is_admin
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- 2. verification_docs 加入 AI 初審結果欄位
alter table public.verification_docs
  add column if not exists ai_passed     boolean,
  add column if not exists ai_company    text check (ai_company in ('TSMC', 'MediaTek')),
  add column if not exists ai_confidence text check (ai_confidence in ('high', 'medium', 'low')),
  add column if not exists ai_reason     text;

-- ============================================================
-- 3. 建立 security definer 函式避免 RLS 遞迴問題
-- ============================================================

-- 此函式以 postgres 身份執行，繞過 RLS，安全地判斷目前用戶是否為管理員
create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  )
$$;

-- ============================================================
-- 4. RLS Policies — 讓管理員可以讀取所有文件 & 審核
-- ============================================================

-- 管理員可讀取所有 verification_docs
drop policy if exists "Admin can view all verification docs" on public.verification_docs;
create policy "Admin can view all verification docs"
  on public.verification_docs for select
  using (
    auth.uid() = user_id
    or public.current_user_is_admin()
  );

-- 管理員可更新任意 verification_docs（核准 / 拒絕）
drop policy if exists "Admin can update verification docs" on public.verification_docs;
create policy "Admin can update verification docs"
  on public.verification_docs for update
  using (public.current_user_is_admin());

-- 管理員可更新任意 profiles（核准後寫入 is_verified / income_tier 等）
drop policy if exists "Admin can update all profiles" on public.profiles;
create policy "Admin can update all profiles"
  on public.profiles for update
  using (
    id = auth.uid()
    or public.current_user_is_admin()
  );

-- 管理員可讀取所有 profiles（顯示申請人姓名）
drop policy if exists "Admin can view all profiles" on public.profiles;
create policy "Admin can view all profiles"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.current_user_is_admin()
  );

-- ============================================================
-- 4. 設定你自己的帳號為管理員（先登入 app 讓 profile 存在）
--    把下面的 YOUR_USER_UUID 換成你的實際 UUID
--    （可在 Supabase > Authentication > Users 找到）
-- ============================================================
update public.profiles set is_admin = true where id = '00a8f130-ad77-44df-aef1-43a3a225b0b5';
