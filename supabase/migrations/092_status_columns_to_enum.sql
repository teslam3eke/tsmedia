-- 092：將固定選項的 status／review_mode 欄位改為 PostgreSQL ENUM
-- Supabase Table Editor 會顯示下拉選單；App／PostgREST 仍回傳字串標籤。

-- ── 1) ENUM 型別 ────────────────────────────────────────────────────────────

create type public.profile_account_status as enum ('active', 'suspended', 'banned');

create type public.profile_verification_status as enum (
  'pending', 'submitted', 'approved', 'rejected'
);

create type public.verification_doc_status as enum ('pending', 'approved', 'rejected');

create type public.verification_review_mode as enum ('manual', 'ai_auto');

create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');

create type public.newebpay_order_status as enum ('pending', 'paid', 'failed');

-- ── 2) 移除欄位上的 CHECK（避免與 ENUM 重複）──────────────────────────────────

create or replace function pg_temp.drop_single_column_checks(p_table regclass, p_column text)
returns void
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any (c.conkey)
    where c.conrelid = p_table
      and c.contype = 'c'
      and a.attname = p_column
      and array_length(c.conkey, 1) = 1
  loop
    execute format('alter table %s drop constraint if exists %I', p_table, r.conname);
  end loop;
end;
$$;

select pg_temp.drop_single_column_checks('public.profiles'::regclass, 'account_status');
select pg_temp.drop_single_column_checks('public.profiles'::regclass, 'verification_status');
select pg_temp.drop_single_column_checks('public.verification_docs'::regclass, 'status');
select pg_temp.drop_single_column_checks('public.verification_docs'::regclass, 'review_mode');
select pg_temp.drop_single_column_checks('public.profile_reports'::regclass, 'status');
select pg_temp.drop_single_column_checks('public.message_reports'::regclass, 'status');
select pg_temp.drop_single_column_checks('public.newebpay_orders'::regclass, 'status');

-- ── 3) 欄位轉型 ─────────────────────────────────────────────────────────────

alter table public.profiles
  alter column account_status drop default,
  alter column account_status type public.profile_account_status
    using account_status::text::public.profile_account_status,
  alter column account_status set default 'active'::public.profile_account_status;

alter table public.profiles
  alter column verification_status drop default,
  alter column verification_status type public.profile_verification_status
    using verification_status::text::public.profile_verification_status,
  alter column verification_status set default 'pending'::public.profile_verification_status;

alter table public.verification_docs
  alter column status drop default,
  alter column status type public.verification_doc_status
    using status::text::public.verification_doc_status,
  alter column status set default 'pending'::public.verification_doc_status;

alter table public.verification_docs
  alter column review_mode drop default,
  alter column review_mode type public.verification_review_mode
    using review_mode::text::public.verification_review_mode,
  alter column review_mode set default 'manual'::public.verification_review_mode;

alter table public.profile_reports
  alter column status drop default,
  alter column status type public.report_status
    using status::text::public.report_status,
  alter column status set default 'open'::public.report_status;

alter table public.message_reports
  alter column status drop default,
  alter column status type public.report_status
    using status::text::public.report_status,
  alter column status set default 'open'::public.report_status;

alter table public.newebpay_orders
  alter column status drop default,
  alter column status type public.newebpay_order_status
    using status::text::public.newebpay_order_status,
  alter column status set default 'pending'::public.newebpay_order_status;

notify pgrst, 'reload schema';
