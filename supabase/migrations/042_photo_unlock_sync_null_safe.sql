-- ============================================================
-- 042: 修正 sync_photo_unlock_state 寫入 unlocked_tiles = NULL
--
-- 現象：首則訊息後 floor(min(count)/3)=0 → generate_series(0,-1) 無列，
--       ARRAY(subselect) 可能為 NULL；另 ON CONFLICT 更新時 unnest 無列則
--       array_agg(...) 為 NULL，違反 unlocked_tiles NOT NULL。
-- ============================================================

create or replace function public.sync_photo_unlock_state(p_match_id uuid)
returns public.photo_unlock_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_count_a int := 0;
  v_count_b int := 0;
  v_target_unlocked int := 0;
  v_new_unlocked int[] := '{}'::int[];
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

  select count(*) into v_count_a
  from public.messages
  where match_id = p_match_id
    and sender_id = v_match.user_a;

  select count(*) into v_count_b
  from public.messages
  where match_id = p_match_id
    and sender_id = v_match.user_b;

  -- 雙方各 3 則訊息累計 1 格，最多 48 格（3 張 × 16）。
  v_target_unlocked := least(48, floor(least(v_count_a, v_count_b) / 3)::int);

  if v_target_unlocked <= 0 then
    v_new_unlocked := '{}'::int[];
  else
    v_new_unlocked := array(select g from generate_series(0, v_target_unlocked - 1) as g);
  end if;

  insert into public.photo_unlock_states (match_id, unlocked_tiles, updated_at)
  values (p_match_id, v_new_unlocked, now())
  on conflict (match_id)
  do update set
    unlocked_tiles = coalesce(
      (
        select array_agg(distinct tile order by tile)
        from unnest(
          coalesce(public.photo_unlock_states.unlocked_tiles, '{}'::int[]) ||
          coalesce(excluded.unlocked_tiles, '{}'::int[])
        ) as tile
      ),
      '{}'::int[]
    ),
    updated_at = now()
  returning * into v_state;

  return v_state;
end;
$$;

-- spend_blur_unlock_tile：避免 unlocked_tiles 異常為 NULL 時 unnest／array_agg 產生 NULL
create or replace function public.spend_blur_unlock_tile(p_match_id uuid)
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

  select tile into v_next_tile
  from generate_series(0, 47) as tile
  where not (tile = any(coalesce(v_state.unlocked_tiles, '{}'::int[])))
  order by tile
  limit 1;

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

-- 若先前錯誤寫入已留下 NULL，補成空陣列
update public.photo_unlock_states
set unlocked_tiles = '{}'::int[]
where unlocked_tiles is null;
