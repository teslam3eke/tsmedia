-- ============================================================
-- 108：一般配對聊天道具解鎖改為每人各自進度（不再共用 photo_unlock_states）
-- 聊天解鎖仍由前端依訊息推導；DB 只存各使用者以道具解鎖的格。
-- ============================================================

create table if not exists public.match_puzzle_manual_unlocks (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  unlocked_tiles int[] not null default '{}'::int[],
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

comment on table public.match_puzzle_manual_unlocks is
  '配對聊天：各使用者以 blur_unlock 道具解鎖的全域拼圖格（0–47）；僅本人可見';

alter table public.match_puzzle_manual_unlocks enable row level security;

drop policy if exists "match_puzzle_manual: own read" on public.match_puzzle_manual_unlocks;
create policy "match_puzzle_manual: own read"
  on public.match_puzzle_manual_unlocks for select
  using (auth.uid() = user_id);

-- 舊版共用列不再作為權威來源（聊天進度改由前端推導）
truncate table public.photo_unlock_states;

-- ─── 回傳本人道具解鎖格（相容 photo_unlock_states 列型別）──────────────────

create or replace function public.sync_photo_unlock_state(p_match_id uuid)
returns public.photo_unlock_states
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
  v_manual int[] := '{}'::int[];
  v_now timestamptz := now();
begin
  select * into v_match
  from public.matches
  where id = p_match_id;

  if not found then
    raise exception 'Match not found';
  end if;

  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if v_user not in (v_match.user_a, v_match.user_b) then
    raise exception 'Not a match participant';
  end if;

  select coalesce(unlocked_tiles, '{}'::int[]) into v_manual
  from public.match_puzzle_manual_unlocks
  where match_id = p_match_id
    and user_id = v_user;

  return (
    p_match_id,
    48,
    coalesce(v_manual, '{}'::int[]),
    v_now,
    v_now
  )::public.photo_unlock_states;
end;
$$;

grant execute on function public.sync_photo_unlock_state(uuid) to authenticated;

-- ─── 消耗 blur_unlock：僅更新本人列 ─────────────────────────────────────────

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
  v_prev int[] := '{}'::int[];
  v_merged int[] := '{}'::int[];
  v_balance int := 0;
  v_tiles int[] := array[]::int[];
  v_boost_active boolean := false;
  v_now timestamptz := now();
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

  select coalesce(unlocked_tiles, '{}'::int[]) into v_prev
  from public.match_puzzle_manual_unlocks
  where match_id = p_match_id
    and user_id = v_user;

  if not found then
    v_prev := '{}'::int[];
  end if;

  if coalesce(array_length(v_prev, 1), 0) >= 48 then
    return (
      p_match_id,
      48,
      v_prev,
      v_now,
      v_now
    )::public.photo_unlock_states;
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

  if p_tile = any(v_prev) then
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
    if p_bonus_tile = any(v_prev) then
      raise exception 'Bonus tile already unlocked';
    end if;
    v_tiles := v_tiles || p_bonus_tile;
  end if;

  v_merged := coalesce(
    (
      select array_agg(distinct tile order by tile)
      from unnest(v_prev || v_tiles) as tile
    ),
    '{}'::int[]
  );

  insert into public.match_puzzle_manual_unlocks (match_id, user_id, unlocked_tiles, updated_at)
  values (p_match_id, v_user, v_merged, v_now)
  on conflict (match_id, user_id) do update
    set unlocked_tiles = excluded.unlocked_tiles,
        updated_at = excluded.updated_at;

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

  return (
    p_match_id,
    48,
    v_merged,
    v_now,
    v_now
  )::public.photo_unlock_states;
end;
$$;

grant execute on function public.spend_blur_unlock_tile(uuid, int, int) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.match_puzzle_manual_unlocks;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
