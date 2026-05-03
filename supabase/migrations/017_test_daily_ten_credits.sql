-- 測試用：每個 app 日（與 app_day_key_now 一致，每晚 10 點換日）第一次讀取餘額時，將愛心／超喜／解除拼圖補到至少 10。
-- 需同時在專案啟用 VITE_TEST_DAILY_TEN=1，並在 DB 開啟旗標（預設關閉，避免正式環境被濫用）：

--   update public.app_feature_flags set enabled = true where key = 'test_daily_ten_credits';

create table if not exists public.app_feature_flags (
  key text primary key,
  enabled boolean not null default false
);

insert into public.app_feature_flags (key, enabled) values ('test_daily_ten_credits', false)
  on conflict (key) do nothing;

create table if not exists public.test_credit_daily_bump (
  user_id uuid not null references auth.users (id) on delete cascade,
  app_day_key text not null,
  bumped_at timestamptz not null default now(),
  primary key (user_id, app_day_key)
);

alter table public.test_credit_daily_bump enable row level security;

create or replace function public.test_ensure_daily_ten_credits()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today text;
  v_h int; v_s int; v_b int;
  v_add int;
  v_flag boolean;
begin
  if v_user is null then
    return;
  end if;

  select coalesce(f.enabled, false) into v_flag
  from public.app_feature_flags f
  where f.key = 'test_daily_ten_credits';

  if not coalesce(v_flag, false) then
    return;
  end if;

  v_today := public.app_day_key_now();

  if exists (
    select 1 from public.test_credit_daily_bump b
    where b.user_id = v_user and b.app_day_key = v_today
  ) then
    return;
  end if;

  v_h := public._credit_balance(v_user, 'heart');
  if v_h < 10 then
    v_add := 10 - v_h;
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_user, 'purchase', 'heart', v_add, v_h + v_add, '測試模式：每日補給（愛心）');
  end if;

  v_s := public._credit_balance(v_user, 'super_like');
  if v_s < 10 then
    v_add := 10 - v_s;
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_user, 'purchase', 'super_like', v_add, v_s + v_add, '測試模式：每日補給（超級喜歡）');
  end if;

  v_b := public._credit_balance(v_user, 'blur_unlock');
  if v_b < 10 then
    v_add := 10 - v_b;
    insert into public.credit_transactions (user_id, kind, credit_type, amount, balance_after, description)
    values (v_user, 'purchase', 'blur_unlock', v_add, v_b + v_add, '測試模式：每日補給（解除拼圖）');
  end if;

  insert into public.test_credit_daily_bump (user_id, app_day_key)
  values (v_user, v_today)
  on conflict (user_id, app_day_key) do nothing;
end;
$$;

grant execute on function public.test_ensure_daily_ten_credits() to authenticated;
