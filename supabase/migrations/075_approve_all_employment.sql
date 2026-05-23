-- ============================================================
-- 075：測試用 — 批量核准所有使用者職業認證（不限性別）
-- 在 Supabase Dashboard > SQL Editor 執行（或 supabase db push）。
-- 僅影響 employment 文件與 profiles.verification_status；收入認證不變。
-- ============================================================

-- 1. 待審 employment 文件 → approved
update public.verification_docs
set
  status = 'approved',
  reviewed_at = coalesce(reviewed_at, now()),
  reviewer_note = coalesce(reviewer_note, '測試環境批量核准（075）')
where verification_kind = 'employment'
  and status in ('pending', 'rejected');

-- 2. 所有 profile → 職業認證已通過
update public.profiles p
set
  is_verified = true,
  verification_status = 'approved',
  company = coalesce(
    p.company,
    (
      select vd.company
      from public.verification_docs vd
      where vd.user_id = p.id
        and vd.verification_kind = 'employment'
        and vd.company is not null
      order by vd.submitted_at desc
      limit 1
    ),
    case when p.gender = 'male' then 'TSMC'::text else p.company end
  )
where p.verification_status is distinct from 'approved'
   or p.is_verified is distinct from true;

notify pgrst, 'reload schema';
