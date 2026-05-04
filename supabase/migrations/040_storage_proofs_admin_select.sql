-- ============================================================
-- 040: 管理員可 SELECT proofs bucket 任意物件（後台簽名 URL / 預覽）
--
-- 現象：verification_docs 已有 Admin SELECT RLS，但 storage.objects
--       僅「本人資料夾」政策；createSignedUrl 仍檢查物件讀取權限，
--       管理員無法預覽其他使用者的職業／收入驗證原始檔。
-- ============================================================

drop policy if exists "proofs: admin select all" on storage.objects;

create policy "proofs: admin select all"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'proofs'
    and public.current_user_is_admin()
  );
