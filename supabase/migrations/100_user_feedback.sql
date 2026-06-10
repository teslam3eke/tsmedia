-- ============================================================
-- Migration 100: 會員意見反映
-- ============================================================

create type public.user_feedback_category as enum (
  'bug',
  'account',
  'payment',
  'discover',
  'instant_match',
  'verify',
  'safety',
  'suggestion',
  'other'
);

create table if not exists public.user_feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  category      public.user_feedback_category not null,
  body          text not null,
  status        text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewer_note text
);

create index if not exists user_feedback_status_idx
  on public.user_feedback (status, created_at desc);

create index if not exists user_feedback_user_idx
  on public.user_feedback (user_id, created_at desc);

alter table public.user_feedback enable row level security;

drop policy if exists "user_feedback: own insert" on public.user_feedback;
create policy "user_feedback: own insert"
  on public.user_feedback for insert
  with check (user_id = auth.uid());

drop policy if exists "user_feedback: own read" on public.user_feedback;
create policy "user_feedback: own read"
  on public.user_feedback for select
  using (user_id = auth.uid());

drop policy if exists "user_feedback: admin read" on public.user_feedback;
create policy "user_feedback: admin read"
  on public.user_feedback for select
  using (public.current_user_is_admin());

drop policy if exists "user_feedback: admin update" on public.user_feedback;
create policy "user_feedback: admin update"
  on public.user_feedback for update
  using (public.current_user_is_admin());

create or replace function public.submit_user_feedback(
  p_category public.user_feedback_category,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := trim(p_body);
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', '請先登入。');
  end if;

  if v_body is null or length(v_body) < 10 then
    return jsonb_build_object('ok', false, 'error', '請至少輸入 10 個字。');
  end if;

  if length(v_body) > 2000 then
    return jsonb_build_object('ok', false, 'error', '內容不可超過 2000 字。');
  end if;

  insert into public.user_feedback (user_id, category, body)
  values (v_uid, p_category, v_body);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.submit_user_feedback(public.user_feedback_category, text) from public;
grant execute on function public.submit_user_feedback(public.user_feedback_category, text) to authenticated;

notify pgrst, 'reload schema';
