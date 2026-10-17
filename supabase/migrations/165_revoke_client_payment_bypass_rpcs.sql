-- 165：關閉 client 端 payment bypass RPC（權限-only；不 DROP function、不動 user data）

-- ─── 1) 模擬月費開通（client mock） ───

revoke all on function public.complete_monthly_membership() from public;
revoke all on function public.complete_monthly_membership() from anon;
revoke all on function public.complete_monthly_membership() from authenticated;

-- ─── 2) 正式 VIP grant（僅 server fulfillment / service_role） ───

revoke all on function public.grant_monthly_membership_for_user(uuid) from public;
revoke all on function public.grant_monthly_membership_for_user(uuid) from anon;
revoke all on function public.grant_monthly_membership_for_user(uuid) from authenticated;
grant execute on function public.grant_monthly_membership_for_user(uuid) to service_role;

-- ─── 3) 模擬道具包購買（client mock） ───

revoke all on function public.purchase_credit_pack(text) from public;
revoke all on function public.purchase_credit_pack(text) from anon;
revoke all on function public.purchase_credit_pack(text) from authenticated;

-- ─── 4) 正式道具 grant（ECPay / TapPay server） ───

revoke all on function public.grant_credit_pack_for_user(uuid, text) from public;
revoke all on function public.grant_credit_pack_for_user(uuid, text) from anon;
revoke all on function public.grant_credit_pack_for_user(uuid, text) from authenticated;
grant execute on function public.grant_credit_pack_for_user(uuid, text) to service_role;

-- ─── 5) 測試用每日補給（017 未套用的 DB 無此函式；存在才 REVOKE） ───

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'test_ensure_daily_ten_credits'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    revoke all on function public.test_ensure_daily_ten_credits() from public;
    revoke all on function public.test_ensure_daily_ten_credits() from anon;
    revoke all on function public.test_ensure_daily_ten_credits() from authenticated;
  end if;
end;
$$;

notify pgrst, 'reload schema';
