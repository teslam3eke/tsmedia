-- 149：管理員可刪除意見反映（後台清理用）

drop policy if exists "user_feedback: admin delete" on public.user_feedback;
create policy "user_feedback: admin delete"
  on public.user_feedback for delete
  using (public.current_user_is_admin());

notify pgrst, 'reload schema';
