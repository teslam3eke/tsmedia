-- 094：配對成功後 30 分鐘內，道具「隨機解 1 片」可一次解 2 格（仍扣 1 次 blur_unlock）
-- 與前端 getRecentMatchBoostState／puzzleRecentMatchBoostEnabled 對齊；即時升格配對（instant_carry）不適用。

create or replace function public.spend_blur_unlock_tile(
  p_match_id uuid,
  p_tile int default null,
  p_bonus_tile int default null
)
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
  v_tiles int[] := array[]::int[];
  v_boost_active boolean := false;
  t int;
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

  v_tiles := array[p_tile];

  v_boost_active :=
    v_match.instant_carry_session_id is null
    and now() < v_match.created_at + interval '30 minutes';

  if p_bonus_tile is not null then
    if not v_boost_active then
      raise exception 'Bonus tile only allowed during recent match boost window';
    end if;
    if p_bonus_tile < 0 or p_bonus_tile > 47 then
      raise exception 'Invalid bonus tile';
    end if;
    if p_bonus_tile = p_tile then
      raise exception 'Invalid bonus tile';
    end if;
    if p_bonus_tile = any(coalesce(v_state.unlocked_tiles, '{}'::int[])) then
      raise exception 'Bonus tile already unlocked';
    end if;
    v_tiles := v_tiles || p_bonus_tile;
  end if;

  update public.photo_unlock_states
  set unlocked_tiles = coalesce(
      (
        select array_agg(distinct tile order by tile)
        from unnest(coalesce(unlocked_tiles, '{}'::int[]) || v_tiles) as tile
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
    case
      when p_bonus_tile is not null then '聊天照片拼圖解除模糊 2 格（配對後加倍）'
      else '聊天照片拼圖解除模糊 1 格'
    end,
    p_match_id::text
  );

  return v_state;
end;
$$;

notify pgrst, 'reload schema';
