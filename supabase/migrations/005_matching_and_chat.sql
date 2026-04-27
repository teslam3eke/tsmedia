-- ============================================================
-- Migration 005: 配對 / 超級喜歡 / 聊天基礎
-- 在 Supabase Dashboard > SQL Editor 貼上並執行
-- ============================================================

-- 擴充站內通知種類
alter table public.app_notifications
  drop constraint if exists app_notifications_kind_check;

alter table public.app_notifications
  add constraint app_notifications_kind_check
  check (kind in (
    'verification_approved',
    'verification_rejected',
    'super_like_received',
    'match_created',
    'message_received'
  ));

create table if not exists public.profile_interactions (
  id                 uuid primary key default gen_random_uuid(),
  actor_user_id      uuid references auth.users on delete cascade not null,
  target_user_id     uuid references auth.users on delete cascade,
  target_profile_key text not null,
  action             text not null check (action in ('pass', 'like', 'super_like')),
  created_at         timestamptz not null default now(),
  unique (actor_user_id, target_profile_key)
);

create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid references auth.users on delete cascade not null,
  user_b     uuid references auth.users on delete cascade not null,
  created_at timestamptz not null default now(),
  constraint matches_distinct_users check (user_a <> user_b),
  unique (user_a, user_b)
);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid references public.matches on delete cascade not null,
  sender_id  uuid references auth.users on delete cascade not null,
  body       text not null check (length(trim(body)) > 0),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profile_interactions enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;

drop policy if exists "interactions: own read" on public.profile_interactions;
create policy "interactions: own read"
  on public.profile_interactions for select
  using (actor_user_id = auth.uid() or target_user_id = auth.uid());

drop policy if exists "matches: participant read" on public.matches;
create policy "matches: participant read"
  on public.matches for select
  using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "messages: match participant read" on public.messages;
create policy "messages: match participant read"
  on public.messages for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

drop policy if exists "messages: match participant insert" on public.messages;
create policy "messages: match participant insert"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- 使用者互動入口：記錄 pass / like / super_like；super_like 會通知對方；
-- 雙方互相 like/super_like 時建立 match。
create or replace function public.record_profile_interaction(
  p_target_profile_key text,
  p_action text,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_matched boolean := false;
  v_user_a uuid;
  v_user_b uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_action not in ('pass', 'like', 'super_like') then
    raise exception 'Invalid action';
  end if;

  insert into public.profile_interactions (
    actor_user_id, target_user_id, target_profile_key, action
  )
  values (
    v_actor, p_target_user_id, p_target_profile_key, p_action
  )
  on conflict (actor_user_id, target_profile_key)
  do update set
    target_user_id = excluded.target_user_id,
    action = excluded.action,
    created_at = now();

  if p_action = 'super_like' and p_target_user_id is not null and p_target_user_id <> v_actor then
    insert into public.app_notifications (user_id, kind, title, body)
    values (
      p_target_user_id,
      'super_like_received',
      '有人對你按了超級喜歡',
      '對方使用超級喜歡讓你知道他對你有興趣。'
    );
  end if;

  if p_target_user_id is not null
     and p_target_user_id <> v_actor
     and p_action in ('like', 'super_like')
     and exists (
       select 1
       from public.profile_interactions i
       where i.actor_user_id = p_target_user_id
         and i.target_user_id = v_actor
         and i.action in ('like', 'super_like')
     )
  then
    v_user_a := least(v_actor, p_target_user_id);
    v_user_b := greatest(v_actor, p_target_user_id);

    insert into public.matches (user_a, user_b)
    values (v_user_a, v_user_b)
    on conflict (user_a, user_b) do nothing;

    v_matched := true;

    insert into public.app_notifications (user_id, kind, title, body)
    values
      (v_actor, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。'),
      (p_target_user_id, 'match_created', '你們配對成功了', '你們互相喜歡，可以開始聊天了。');
  end if;

  return jsonb_build_object('matched', v_matched);
end;
$$;

grant execute on function public.record_profile_interaction(text, text, uuid) to authenticated;

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

  insert into public.messages (match_id, sender_id, body)
  values (p_match_id, v_sender, trim(p_body))
  returning * into v_message;

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
