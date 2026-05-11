-- 即時配對：同場 instant_sessions 尚未寫入 matches 前，對方 profiles 依舊被 RLS 擋住，
-- getProfile(peer) 0 列 + .single() → PGRST116／406，拼圖無生活照、大區塊只顯示 placeholder。

drop policy if exists "profiles: instant session peer read" on public.profiles;

create policy "profiles: instant session peer read"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1
      from public.instant_sessions s
      where s.aborted_at is null
        and (
          (s.user_a = auth.uid() and s.user_b = public.profiles.id)
          or (s.user_b = auth.uid() and s.user_a = public.profiles.id)
        )
    )
  );

notify pgrst, 'reload schema';
