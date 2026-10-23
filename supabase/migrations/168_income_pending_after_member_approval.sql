-- 168：Onboarding 收入皇冠方案 B — 會員申請已通過時，收入 verification_docs 可維持 pending
--
-- 無新欄位／無狀態 enum 變更：130 起 application 與 doc 狀態本即獨立。
-- 此 migration 補：說明註解 + 後台「待審收入皇冠」查詢用 partial index。

comment on column public.verification_docs.application_id is
  '所屬 verification_applications；會員整包通過後 income 列可仍 pending，由管理員另審皇冠（方案 B）。';

comment on column public.verification_docs.status is
  '與所屬 application.status 可不一致：例如 application=approved 且 verification_kind=income 時仍可 pending。';

-- 管理後台 getPendingVerifications（income + manual + pending）與同條件報表
create index if not exists verification_docs_pending_income_manual_idx
  on public.verification_docs (submitted_at asc)
  where status = 'pending'
    and verification_kind = 'income'
    and review_mode = 'manual';

notify pgrst, 'reload schema';
