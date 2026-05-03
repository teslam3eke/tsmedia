-- 測試用：所有創始會員（profiles.founding_member_no IS NOT NULL）各
--   +100 愛心、+100 超級喜歡、+100 解除拼圖
-- 冪等：同一 user 同一種點數不因重跑 migration 重複入帳（以 related_ref 判斷）

DO $$
DECLARE
  u uuid;
  b int;
BEGIN
  FOR u IN SELECT id FROM public.profiles WHERE founding_member_no IS NOT NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE user_id = u AND related_ref = 'founding_test_pack_2026_05_01:heart'
    ) THEN
      b := public._credit_balance(u, 'heart');
      INSERT INTO public.credit_transactions (
        user_id, kind, credit_type, amount, balance_after, description, related_ref
      )
      VALUES (
        u,
        'admin_adjust',
        'heart',
        100,
        b + 100,
        '測試補給：創始會員愛心 +100',
        'founding_test_pack_2026_05_01:heart'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE user_id = u AND related_ref = 'founding_test_pack_2026_05_01:super_like'
    ) THEN
      b := public._credit_balance(u, 'super_like');
      INSERT INTO public.credit_transactions (
        user_id, kind, credit_type, amount, balance_after, description, related_ref
      )
      VALUES (
        u,
        'admin_adjust',
        'super_like',
        100,
        b + 100,
        '測試補給：創始會員超級喜歡 +100',
        'founding_test_pack_2026_05_01:super_like'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE user_id = u AND related_ref = 'founding_test_pack_2026_05_01:blur_unlock'
    ) THEN
      b := public._credit_balance(u, 'blur_unlock');
      INSERT INTO public.credit_transactions (
        user_id, kind, credit_type, amount, balance_after, description, related_ref
      )
      VALUES (
        u,
        'admin_adjust',
        'blur_unlock',
        100,
        b + 100,
        '測試補給：創始會員解除拼圖 +100',
        'founding_test_pack_2026_05_01:blur_unlock'
      );
    END IF;
  END LOOP;
END $$;
