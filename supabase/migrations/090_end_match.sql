-- 090: 解除配對（不封鎖）— 刪除 match／聊天，並清除雙向 like 以免立刻互配回來

create or replace function public.end_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_match public.matches%rowtype;
  v_peer uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'match_not_found');
  end if;

  if v_actor <> v_match.user_a and v_actor <> v_match.user_b then
    raise exception 'Not a participant';
  end if;

  v_peer := case when v_actor = v_match.user_a then v_match.user_b else v_match.user_a end;

  delete from public.matches where id = p_match_id;

  delete from public.profile_interactions
  where action in ('like', 'super_like')
    and (
      (actor_user_id = v_actor and (target_user_id = v_peer or target_profile_key = 'user:' || v_peer::text))
      or (actor_user_id = v_peer and (target_user_id = v_actor or target_profile_key = 'user:' || v_actor::text))
    );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.end_match(uuid) to authenticated;

notify pgrst, 'reload schema';
