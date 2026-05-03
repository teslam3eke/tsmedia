-- ============================================================
-- Migration 010: 封鎖 / 訊息檢舉 / 點數 ledger
-- ============================================================

alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'banned'));

create table if not exists public.profile_blocks (
  id                  uuid primary key default gen_random_uuid(),
  blocker_user_id     uuid references auth.users on delete cascade not null,
  blocked_user_id     uuid references auth.users on delete cascade,
  blocked_profile_key text not null,
  blocked_display_name text,
  reason              text,
  created_at          timestamptz not null default now(),
  unique (blocker_user_id, blocked_profile_key)
);

create table if not exists public.message_reports (
  id                    uuid primary key default gen_random_uuid(),
  reporter_user_id      uuid references auth.users on delete cascade not null,
  reported_user_id      uuid references auth.users on delete set null,
  match_id              uuid references public.matches on delete set null,
  message_id            uuid references public.messages on delete set null,
  reported_profile_key  text,
  reported_display_name text,
  message_body          text,
  reason                text not null check (reason in (
    'harassment',
    'scam_or_sales',
    'inappropriate_content',
    'privacy_violation',
    'other'
  )),
  details               text,
  status                text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at            timestamptz not null default now(),
  reviewed_at           timestamptz,
  reviewer_note         text
);

create table if not exists public.credit_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users on delete cascade not null,
  kind             text not null check (kind in ('purchase', 'spend', 'refund', 'admin_adjust')),
  credit_type      text not null check (credit_type in ('heart', 'super_like', 'blur_unlock', 'point')),
  amount           int not null,
  balance_after    int,
  description      text,
  related_user_id  uuid references auth.users on delete set null,
  related_ref      text,
  created_at       timestamptz not null default now()
);

create index if not exists profile_blocks_blocker_idx on public.profile_blocks (blocker_user_id, created_at desc);
create index if not exists profile_blocks_blocked_user_idx on public.profile_blocks (blocked_user_id);
create index if not exists message_reports_status_idx on public.message_reports (status, created_at desc);
create index if not exists credit_transactions_user_idx on public.credit_transactions (user_id, created_at desc);

alter table public.profile_blocks enable row level security;
alter table public.message_reports enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists "blocks: own read" on public.profile_blocks;
create policy "blocks: own read" on public.profile_blocks for select
  using (blocker_user_id = auth.uid());

drop policy if exists "blocks: own insert" on public.profile_blocks;
create policy "blocks: own insert" on public.profile_blocks for insert
  with check (blocker_user_id = auth.uid());

drop policy if exists "blocks: own delete" on public.profile_blocks;
create policy "blocks: own delete" on public.profile_blocks for delete
  using (blocker_user_id = auth.uid());

drop policy if exists "message_reports: own insert" on public.message_reports;
create policy "message_reports: own insert" on public.message_reports for insert
  with check (reporter_user_id = auth.uid());

drop policy if exists "message_reports: own read" on public.message_reports;
create policy "message_reports: own read" on public.message_reports for select
  using (reporter_user_id = auth.uid());

drop policy if exists "message_reports: admin read" on public.message_reports;
create policy "message_reports: admin read" on public.message_reports for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "message_reports: admin update" on public.message_reports;
create policy "message_reports: admin update" on public.message_reports for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "credits: own read" on public.credit_transactions;
create policy "credits: own read" on public.credit_transactions for select
  using (user_id = auth.uid());

drop policy if exists "credits: own insert" on public.credit_transactions;
create policy "credits: own insert" on public.credit_transactions for insert
  with check (user_id = auth.uid());

drop policy if exists "credits: admin read" on public.credit_transactions;
create policy "credits: admin read" on public.credit_transactions for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create or replace function public.record_profile_block(
  p_blocked_profile_key text,
  p_blocked_user_id uuid default null,
  p_blocked_display_name text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocker uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
begin
  if v_blocker is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profile_blocks (
    blocker_user_id, blocked_user_id, blocked_profile_key, blocked_display_name, reason
  )
  values (
    v_blocker, p_blocked_user_id, p_blocked_profile_key, p_blocked_display_name, p_reason
  )
  on conflict (blocker_user_id, blocked_profile_key)
  do update set
    blocked_user_id = excluded.blocked_user_id,
    blocked_display_name = excluded.blocked_display_name,
    reason = excluded.reason,
    created_at = now();

  if p_blocked_user_id is not null and p_blocked_user_id <> v_blocker then
    v_user_a := least(v_blocker, p_blocked_user_id);
    v_user_b := greatest(v_blocker, p_blocked_user_id);
    delete from public.matches where user_a = v_user_a and user_b = v_user_b;
  end if;
end;
$$;

grant execute on function public.record_profile_block(text, uuid, text, text) to authenticated;

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

  if exists (
    select 1 from public.profile_blocks b
    where b.blocker_user_id = v_actor
      and (b.blocked_profile_key = p_target_profile_key or b.blocked_user_id = p_target_user_id)
  ) or (
    p_target_user_id is not null and exists (
      select 1 from public.profile_blocks b
      where b.blocker_user_id = p_target_user_id
        and b.blocked_user_id = v_actor
    )
  ) then
    return jsonb_build_object('matched', false, 'blocked', true);
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
