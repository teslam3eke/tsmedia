-- ============================================================
-- 068：生活照 AI 審核失敗次數（每 app 日最多 10 次，與 app_day_key_now 換日一致）
-- ============================================================

create table if not exists public.life_photo_verify_failures (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  app_day_key  text not null,
  created_at   timestamptz not null default now()
);

create index if not exists life_photo_verify_failures_user_day_idx
  on public.life_photo_verify_failures (user_id, app_day_key, created_at desc);

comment on table public.life_photo_verify_failures is
  '生活照 OpenAI 審核未通過紀錄；每使用者每 app 日最多 10 次';

alter table public.life_photo_verify_failures enable row level security;

drop policy if exists "life_photo_verify_failures select own" on public.life_photo_verify_failures;
create policy "life_photo_verify_failures select own"
  on public.life_photo_verify_failures for select
  using (auth.uid() = user_id);

create or replace function public.get_my_life_photo_verify_failure_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_day text := public.app_day_key_now();
  v_count int;
  v_limit int := 10;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::int into v_count
  from public.life_photo_verify_failures f
  where f.user_id = v_uid and f.app_day_key = v_day;

  return jsonb_build_object(
    'count', v_count,
    'limit', v_limit,
    'remaining', greatest(0, v_limit - v_count),
    'limited', v_count >= v_limit,
    'app_day_key', v_day
  );
end;
$$;

comment on function public.get_my_life_photo_verify_failure_status() is
  '今日生活照審核失敗次數（每 app 日 10 次上限）';

grant execute on function public.get_my_life_photo_verify_failure_status() to authenticated;

notify pgrst, 'reload schema';
