-- 111：模擬開通 complete_monthly_membership 與 109 對齊（每次購買均贈 5 愛心／3 超喜／20 拼圖）

create or replace function public.complete_monthly_membership()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_grant jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  v_grant := public.grant_monthly_membership_for_user(v_user);

  if coalesce(v_grant->>'ok', 'false') <> 'true'
     or v_grant->>'subscription_expires_at' is null then
    raise exception 'Grant failed';
  end if;

  return v_grant;
end;
$$;

grant execute on function public.complete_monthly_membership() to authenticated;

notify pgrst, 'reload schema';
