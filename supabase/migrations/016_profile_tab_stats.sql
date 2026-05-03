-- 「我的」頁統計：連續登入天數、累積登入天數、收到愛心／超級喜歡（依 profile_interactions）

alter table public.profiles
  add column if not exists login_last_app_day text,
  add column if not exists login_streak int not null default 0,
  add column if not exists login_total_days int not null default 0;

-- 與 app_day_key_now / 每日獎勵 同一套換日邏輯（Asia/Taipei −22h）
create or replace function public.refresh_profile_tab_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today text;
  v_yesterday text;
  v_last text;
  v_streak int;
  v_total int;
  v_hearts bigint;
  v_supers bigint;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  v_today := public.app_day_key_now();
  v_yesterday := to_char(
    ((current_timestamp at time zone 'Asia/Taipei') - interval '22 hours')::date - interval '1 day',
    'YYYY-MM-DD'
  );

  select login_last_app_day, login_streak, login_total_days
  into v_last, v_streak, v_total
  from public.profiles
  where id = v_user;

  if v_last is distinct from v_today then
    if v_last is null then
      v_streak := 1;
    elsif v_last = v_yesterday then
      v_streak := coalesce(v_streak, 0) + 1;
    else
      v_streak := 1;
    end if;
    v_total := coalesce(v_total, 0) + 1;

    update public.profiles
    set
      login_last_app_day = v_today,
      login_streak = v_streak,
      login_total_days = v_total,
      updated_at = now()
    where id = v_user;
  end if;

  select coalesce(login_streak, 0), coalesce(login_total_days, 0)
  into v_streak, v_total
  from public.profiles
  where id = v_user;

  select
    count(*) filter (where action = 'like'),
    count(*) filter (where action = 'super_like')
  into v_hearts, v_supers
  from public.profile_interactions
  where target_user_id = v_user;

  return jsonb_build_object(
    'login_streak_days', v_streak,
    'login_total_days', v_total,
    'hearts_received', coalesce(v_hearts, 0)::int,
    'super_likes_received', coalesce(v_supers, 0)::int
  );
end;
$$;

grant execute on function public.refresh_profile_tab_stats() to authenticated;
