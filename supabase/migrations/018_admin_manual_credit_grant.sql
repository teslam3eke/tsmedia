-- 一次性：為管理員帳戶加點（愛心 +100、超級喜歡 +100、解除拼圖 +999）
-- 冪等：同一 user 不會因重跑 migration 重複入帳（以 related_ref 判斷）
--
-- 若專案內有多位 is_admin，此檔會對「所有」管理員加點。若只幫自己加，請在 Supabase SQL
-- 改為單一 uuid，例如：
--   FOR u IN SELECT 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid AS id
--   LOOP ...（其餘不變）

DO $$
DECLARE
  u uuid;
  b int;
BEGIN
  FOR u IN SELECT id FROM public.profiles WHERE is_admin = true
  LOOP
    -- 愛心 +100
    IF NOT EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE user_id = u AND related_ref = 'admin_bonus_2026_04_30:heart'
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
        '管理員手動加點：愛心 +100',
        'admin_bonus_2026_04_30:heart'
      );
    END IF;

    -- 超級喜歡 +100
    IF NOT EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE user_id = u AND related_ref = 'admin_bonus_2026_04_30:super_like'
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
        '管理員手動加點：超級喜歡 +100',
        'admin_bonus_2026_04_30:super_like'
      );
    END IF;

    -- 解除拼圖 +999
    IF NOT EXISTS (
      SELECT 1 FROM public.credit_transactions
      WHERE user_id = u AND related_ref = 'admin_bonus_2026_04_30:blur_unlock'
    ) THEN
      b := public._credit_balance(u, 'blur_unlock');
      INSERT INTO public.credit_transactions (
        user_id, kind, credit_type, amount, balance_after, description, related_ref
      )
      VALUES (
        u,
        'admin_adjust',
        'blur_unlock',
        999,
        b + 999,
        '管理員手動加點：解除拼圖 +999',
        'admin_bonus_2026_04_30:blur_unlock'
      );
    END IF;
  END LOOP;
END $$;
