-- ============================================================
-- 067：Server-side chat presence（Webhook 依裝置決定是否發訊息推播）
--
-- 前景開啟某 match 聊天室 → upsert presence；Webhook 對該 client_key 的
-- push 訂閱略過 OS 推播。SW 端抑制仍保留作為備援。
-- ============================================================

alter table public.push_subscriptions
  add column if not exists client_key text;

create index if not exists push_subscriptions_user_client_key_idx
  on public.push_subscriptions (user_id, client_key)
  where client_key is not null;

comment on column public.push_subscriptions.client_key is
  '與 user_chat_presence.client_key 對齊；每 PWA 安裝一組 localStorage UUID';

create table if not exists public.user_chat_presence (
  user_id          uuid not null references auth.users (id) on delete cascade,
  client_key       text not null,
  active_match_id  uuid references public.matches (id) on delete set null,
  visibility       text not null default 'hidden'
    check (visibility in ('visible', 'hidden')),
  updated_at       timestamptz not null default now(),
  primary key (user_id, client_key)
);

create index if not exists user_chat_presence_active_idx
  on public.user_chat_presence (user_id, active_match_id, updated_at desc)
  where active_match_id is not null;

alter table public.user_chat_presence enable row level security;

drop policy if exists "user_chat_presence select own" on public.user_chat_presence;
create policy "user_chat_presence select own"
  on public.user_chat_presence for select
  using (auth.uid() = user_id);

drop policy if exists "user_chat_presence insert own" on public.user_chat_presence;
create policy "user_chat_presence insert own"
  on public.user_chat_presence for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_chat_presence update own" on public.user_chat_presence;
create policy "user_chat_presence update own"
  on public.user_chat_presence for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_chat_presence delete own" on public.user_chat_presence;
create policy "user_chat_presence delete own"
  on public.user_chat_presence for delete
  using (auth.uid() = user_id);

create or replace function public.upsert_user_chat_presence(
  p_client_key text,
  p_active_match_id uuid,
  p_visibility text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := nullif(trim(p_client_key), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if v_key is null then
    raise exception 'client_key required';
  end if;
  if p_visibility not in ('visible', 'hidden') then
    raise exception 'invalid visibility';
  end if;

  insert into public.user_chat_presence (
    user_id, client_key, active_match_id, visibility, updated_at
  )
  values (
    v_uid,
    v_key,
    p_active_match_id,
    p_visibility,
    now()
  )
  on conflict (user_id, client_key) do update set
    active_match_id = excluded.active_match_id,
    visibility = excluded.visibility,
    updated_at = now();
end;
$$;

comment on function public.upsert_user_chat_presence(text, uuid, text) is
  'PWA 心跳：前景在某 match 聊天室時 Webhook 對此 client_key 略過 message_received 推播';

grant execute on function public.upsert_user_chat_presence(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
