-- ============================================================
-- Migration 011: 聊天照片 4x4 拼圖解鎖 / 解除模糊道具
-- ============================================================

create table if not exists public.photo_unlock_states (
  match_id       uuid primary key references public.matches on delete cascade,
  total_tiles    int not null default 16 check (total_tiles = 16),
  unlocked_tiles int[] not null default '{}',
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

alter table public.photo_unlock_states enable row level security;

drop policy if exists "photo unlock: participant read" on public.photo_unlock_states;
create policy "photo unlock: participant read"
  on public.photo_unlock_states for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

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

  -- 雙方都要有互動：雙方各 3 則訊息解鎖 1 格，最多 16 格。
  v_target_unlocked := least(16, floor(least(v_count_a, v_count_b) / 3)::int);

  insert into public.photo_unlock_states (match_id, unlocked_tiles, updated_at)
  values (
    p_match_id,
    coalesce(array(select generate_series(0, v_target_unlocked - 1)), '{}'),
    now()
  )
  on conflict (match_id)
  do update set
    unlocked_tiles = (
      select array_agg(distinct tile order by tile)
      from unnest(
        coalesce(public.photo_unlock_states.unlocked_tiles, '{}') ||
        coalesce(excluded.unlocked_tiles, '{}')
      ) as tile
    ),
    updated_at = now()
  returning * into v_state;

  return v_state;
end;
$$;

grant execute on function public.sync_photo_unlock_state(uuid) to authenticated;

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

  if coalesce(array_length(v_state.unlocked_tiles, 1), 0) >= 16 then
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
  from generate_series(0, 15) as tile
  where not (tile = any(v_state.unlocked_tiles))
  order by tile
  limit 1;

  update public.photo_unlock_states
  set unlocked_tiles = (
      select array_agg(distinct tile order by tile)
      from unnest(unlocked_tiles || array[v_next_tile]) as tile
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

grant execute on function public.spend_blur_unlock_tile(uuid) to authenticated;

create or replace function public.simulate_partner_match_message(
  p_match_id uuid,
  p_body text default '我也回你一則，測試拼圖解鎖。'
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
  v_partner uuid;
  v_message public.messages%rowtype;
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

  v_partner := case when v_match.user_a = v_user then v_match.user_b else v_match.user_a end;

  insert into public.messages (match_id, sender_id, body)
  values (p_match_id, v_partner, trim(coalesce(p_body, '我也回你一則，測試拼圖解鎖。')))
  returning * into v_message;

  perform public.sync_photo_unlock_state(p_match_id);

  return v_message;
end;
$$;

grant execute on function public.simulate_partner_match_message(uuid, text) to authenticated;

create or replace function public.send_match_message(
  p_match_id uuid,
  p_body text
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_match public.matches%rowtype;
  v_message public.messages%rowtype;
  v_receiver uuid;
  v_recent_count int;
begin
  if v_sender is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Message body is required';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
    and (user_a = v_sender or user_b = v_sender);

  if not found then
    raise exception 'Match not found';
  end if;

  v_receiver := case when v_match.user_a = v_sender then v_match.user_b else v_match.user_a end;

  if exists (
    select 1 from public.profile_blocks b
    where (b.blocker_user_id = v_sender and b.blocked_user_id = v_receiver)
       or (b.blocker_user_id = v_receiver and b.blocked_user_id = v_sender)
  ) then
    raise exception 'Messaging blocked';
  end if;

  select count(*) into v_recent_count
  from public.messages
  where sender_id = v_sender
    and created_at > now() - interval '1 minute';

  if v_recent_count >= 8 then
    raise exception 'Message rate limit exceeded';
  end if;

  insert into public.messages (match_id, sender_id, body)
  values (p_match_id, v_sender, trim(p_body))
  returning * into v_message;

  perform public.sync_photo_unlock_state(p_match_id);

  insert into public.app_notifications (user_id, kind, title, body)
  values (
    v_receiver,
    'message_received',
    '你收到一則新訊息',
    '配對對象傳了新訊息給你。'
  );

  return v_message;
end;
$$;

grant execute on function public.send_match_message(uuid, text) to authenticated;
