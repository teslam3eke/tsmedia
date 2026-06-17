-- 118：認證通過站內彈窗 — 移除「AI 審核時間：約 5 秒」文案

create or replace function public.finalize_due_ai_reviews()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  doc record;
  v_updated int;
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
        reviewer_note = coalesce(reviewer_note, 'AI 自動審核通過')
    where id = doc.id
      and status = 'pending';

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      continue;
    end if;

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
        '你的職業認證已通過。'
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
        '你的收入認證已通過，可以到編輯個人資訊開啟收入皇冠。'
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.finalize_due_ai_reviews() to authenticated;

notify pgrst, 'reload schema';
