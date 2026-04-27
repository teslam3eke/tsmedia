-- ============================================================
-- Testing helper: reset this account's employment/income verification state
-- 在 Supabase Dashboard > SQL Editor 執行即可。
-- 若要重設其他帳號，請把 target_user_id 改成該使用者 UUID。
-- ============================================================

do $$
declare
  target_user_id uuid := '00a8f130-ad77-44df-aef1-43a3a225b0b5';
begin
  -- 回到「未認證 / 未送審」狀態，讓前端重新顯示上傳入口。
  update public.profiles
  set
    is_verified = false,
    verification_status = 'pending',
    income_tier = null,
    show_income_border = false
  where id = target_user_id;

  -- 測試用：清掉舊驗證單，避免 income 最新一筆仍顯示審核中/已通過/已拒絕。
  delete from public.verification_docs
  where user_id = target_user_id
    and verification_kind in ('employment', 'income');

  -- 清掉舊審核通知，避免測試時看到過期結果。
  delete from public.app_notifications
  where user_id = target_user_id
    and kind in ('verification_approved', 'verification_rejected');
end $$;
