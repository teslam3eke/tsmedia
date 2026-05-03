-- =============================================================================
-- DAY 0 測試重置（僅限開發／Staging — 請勿在正式環境執行）
-- =============================================================================
-- 效果：
--   • 清空聊天、配對、探索互動、每日探索 deck、封鎖、站內通知、每日領獎紀錄
--   • 清空所有點數流水後，為每位 profiles 使用者各發「愛心 100」
--   • 可選：重置連登統計（見下方）
--
-- 使用方式：Supabase Dashboard → SQL Editor → 整份貼上執行（需 postgres/service_role）
--
-- 若執行報 FK 錯誤，請依錯誤訊息調整刪除順序或先刪除引用該表的資料。
-- =============================================================================

begin;

-- ── 依 FK 安全順序清空 ───────────────────────────────────────────────────────

delete from public.message_reports;
delete from public.profile_reports;
delete from public.messages;
delete from public.photo_unlock_states;
delete from public.matches;
delete from public.profile_interactions;

delete from public.daily_discover_deck;
delete from public.daily_discover_shown;
delete from public.daily_bonus_claims;

delete from public.profile_blocks;

delete from public.app_notifications;

delete from public.credit_transactions;

-- ── 每位會員愛心 = 100（超級喜歡／拼圖點數在本次為 0）──────────────────────────

insert into public.credit_transactions (
  user_id,
  kind,
  credit_type,
  amount,
  balance_after,
  description,
  related_ref
)
select
  p.id,
  'admin_adjust',
  'heart',
  100,
  100,
  'Day0 測試重置：愛心歸零後發放 100',
  'day0_reset_v2_heart100'
from public.profiles p;

-- ── 可選：重置「我的」連登統計（需要 migration 016 欄位）──────────────────────

update public.profiles set
  login_last_app_day = null,
  login_streak = 0,
  login_total_days = 0;

commit;

-- =============================================================================
-- 選用：男性若不想再被導向「身分／職業驗證」流程（略過後下次登入仍會進驗證，
--       因為 App 規定 verification_status = pending 的男性必定進該頁）
--
--   update public.profiles
--   set verification_status = 'submitted'
--   where gender = 'male' and verification_status = 'pending';
--
-- （submitted = 已送出待審，routeAfterSecurityCheck 就不會再丢進 identity-verify）
-- =============================================================================
