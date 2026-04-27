-- ============================================================
-- Migration 004: AI 自動審核流程
-- - AI 通過後最早 15 秒才自動核准 / 通知
-- - AI 拒絕或逾時改人工審閱
-- - 支援職業認證與收入認證
-- ============================================================

alter table public.verification_docs
  add column if not exists review_mode text not null default 'manual'
    check (review_mode in ('manual', 'ai_auto')),
  add column if not exists ai_review_ready_at timestamptz,
  add column if not exists manual_review_reason text;

create index if not exists verification_docs_ai_due_idx
  on public.verification_docs (user_id, status, review_mode, ai_review_ready_at);

-- 使用者打開 app 時呼叫：把已滿 15 秒且 AI 通過的 pending 案件轉為 approved，
-- 並寫入站內通知。security definer 讓函式可安全更新 profile / notification。
create or replace function public.finalize_due_ai_reviews()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  doc record;
begin
  if auth.uid() is null then
    return;
  end if;

  for doc in
    select *
    from public.verification_docs
    where user_id = auth.uid()
      and status = 'pending'
      and review_mode = 'ai_auto'
      and ai_passed = true
      and ai_review_ready_at <= now()
  loop
    update public.verification_docs
    set status = 'approved',
        reviewed_at = now(),
        reviewer_note = coalesce(reviewer_note, 'AI 自動審核通過（AI 審核時間：約 15 秒）')
    where id = doc.id;

    if doc.verification_kind = 'employment' then
      update public.profiles
      set is_verified = true,
          verification_status = 'approved',
          company = doc.company
      where id = doc.user_id;

      insert into public.app_notifications (user_id, kind, title, body)
      values (
        doc.user_id,
        'verification_approved',
        '職業認證已通過',
        'AI 已完成審核並通過你的職業認證。AI 審核時間：約 15 秒。'
      );
    elsif doc.verification_kind = 'income' then
      update public.profiles
      set income_tier = doc.claimed_income_tier
      where id = doc.user_id;

      insert into public.app_notifications (user_id, kind, title, body)
      values (
        doc.user_id,
        'verification_approved',
        '收入認證已通過',
        'AI 已完成審核並通過你的收入認證。AI 審核時間：約 15 秒。'
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.finalize_due_ai_reviews() to authenticated;
