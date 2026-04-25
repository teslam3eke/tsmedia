-- ============================================================
-- Migration 001: 補上地點欄位與收入認證欄位
-- 在 Supabase Dashboard > SQL Editor 貼上全部執行
-- ============================================================

-- 地點欄位
alter table public.profiles
  add column if not exists work_region      text check (work_region      in ('north','central','south','east')),
  add column if not exists home_region      text check (home_region      in ('north','central','south','east')),
  add column if not exists preferred_region text check (preferred_region in ('north','central','south','east'));

-- 收入認證欄位
alter table public.profiles
  add column if not exists income_tier        text check (income_tier in ('silver','gold','diamond')),
  add column if not exists show_income_border boolean not null default false;

-- verification_docs 補欄位
alter table public.verification_docs
  add column if not exists verification_kind   text not null default 'employment'
    check (verification_kind in ('employment','income')),
  add column if not exists claimed_income_tier text
    check (claimed_income_tier in ('silver','gold','diamond'));

-- 放寬 doc_type 限制以支援收入文件
alter table public.verification_docs
  drop constraint if exists verification_docs_doc_type_check;
alter table public.verification_docs
  add constraint verification_docs_doc_type_check
  check (doc_type in ('employee_id','tax_return','payslip','bank_statement','other'));
