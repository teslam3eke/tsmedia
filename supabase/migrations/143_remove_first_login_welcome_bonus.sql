-- 143：停止發放一次性首次登入禮。
-- 保留既有 first_login_bonus_granted_at 與歷史交易，不回收已發出的愛心／拼圖。
-- 舊版前端若仍呼叫 RPC，回傳 removed 而不寫入任何資料。

create or replace function public.claim_first_login_welcome_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return jsonb_build_object('ok', false, 'reason', 'removed');
end;
$$;

grant execute on function public.claim_first_login_welcome_bonus() to authenticated;

notify pgrst, 'reload schema';
