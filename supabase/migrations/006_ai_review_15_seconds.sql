-- ============================================================
-- Migration 006: AI 審核時間調整為 15 秒
-- 若 004 已經執行過，請再執行這份以更新 Supabase function 文案。
-- 實際 ready_at 由前端送件時寫入 now() + 15 seconds。
-- ============================================================

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
