-- ============================================================
-- 073：測試用 — 批量核准所有男性職業認證
-- 在 Supabase Dashboard > SQL Editor 執行（或 supabase db push）。
-- 僅影響 employment；收入認證（income）不變。
-- ============================================================

-- 1. 待審 employment 文件 → approved
update public.verification_docs
set
  status = 'approved',
  reviewed_at = coalesce(reviewed_at, now()),
  reviewer_note = coalesce(reviewer_note, '測試環境批量核准（073）')
where verification_kind = 'employment'
  and status in ('pending', 'rejected');

-- 2. 男性 profile → 已通過；company 優先保留原值，其次最新 employment doc，否則 TSMC
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
    'TSMC'::text
  )
where p.gender = 'male'
  and (
    p.verification_status is distinct from 'approved'
    or p.is_verified is distinct from true
  );

notify pgrst, 'reload schema';
