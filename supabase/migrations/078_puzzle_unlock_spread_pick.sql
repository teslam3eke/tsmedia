-- ============================================================
-- 078：拼圖解鎖改為 spread + 連續解鎖避開相鄰格（與前端 puzzleUnlockPick 一致）
--       sync 不再線性合併 0..n（避免與訊息推導重疊）；道具解鎖由前端指定格位。
-- ============================================================

-- ─── sync_photo_unlock_state：僅確保列存在，聊天解鎖由前端推導 ─────────────

create or replace function public.sync_photo_unlock_state(p_match_id uuid)
returns public.photo_unlock_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_state public.photo_unlock_states%rowtype;
begin
  select * into v_match
  from public.matches
  where id = p_match_id;

  if not found then
    raise exception 'Match not found';
  end if;

  if auth.uid() is not null and auth.uid() not in (v_match.user_a, v_match.user_b) then
    raise exception 'Not a match participant';
  end if;

  insert into public.photo_unlock_states (match_id, unlocked_tiles, total_tiles, updated_at)
  values (p_match_id, '{}'::int[], 48, now())
  on conflict (match_id) do nothing;

  select * into v_state
  from public.photo_unlock_states
  where match_id = p_match_id;

  if not found then
    raise exception 'photo_unlock_states insert failed';
  end if;

  return v_state;
end;
$$;

-- ─── spend_blur_unlock_tile：前端傳入 p_tile（spread 選格），僅寫入道具解鎖格 ─

create or replace function public.spend_blur_unlock_tile(p_match_id uuid, p_tile int default null)
returns public.photo_unlock_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
  v_state public.photo_unlock_states%rowtype;
  v_balance int := 0;
  v_next_tile int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
    and (user_a = v_user or user_b = v_user);

  if not found then
    raise exception 'Match not found';
  end if;

  v_state := public.sync_photo_unlock_state(p_match_id);

  if coalesce(array_length(v_state.unlocked_tiles, 1), 0) >= 48 then
    return v_state;
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.credit_transactions
  where user_id = v_user
    and credit_type = 'blur_unlock';

  if v_balance <= 0 then
    raise exception 'Insufficient blur unlock credits';
  end if;

  if p_tile is null then
    raise exception 'Tile required';
  end if;

  if p_tile < 0 or p_tile > 47 then
    raise exception 'Invalid tile';
  end if;

  if p_tile = any(coalesce(v_state.unlocked_tiles, '{}'::int[])) then
    raise exception 'Tile already unlocked';
  end if;

  v_next_tile := p_tile;

  update public.photo_unlock_states
  set unlocked_tiles = coalesce(
      (
        select array_agg(distinct tile order by tile)
        from unnest(coalesce(unlocked_tiles, '{}'::int[]) || array[v_next_tile]) as tile
      ),
      '{}'::int[]
    ),
    updated_at = now()
  where match_id = p_match_id
  returning * into v_state;

  insert into public.credit_transactions (
    user_id, kind, credit_type, amount, balance_after, description, related_ref
  )
  values (
    v_user,
    'spend',
    'blur_unlock',
    -1,
    v_balance - 1,
    '聊天照片拼圖解除模糊 1 格',
    p_match_id::text
  );

  return v_state;
end;
$$;

notify pgrst, 'reload schema';
