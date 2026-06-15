-- 117：PWA 前景 presence — 認證通過推播僅在使用者未開啟 App 時送出

create table if not exists public.user_app_presence (
  user_id    uuid not null references auth.users (id) on delete cascade,
  client_key text not null,
  visibility text not null default 'hidden'
    check (visibility in ('visible', 'hidden')),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_key)
);

create index if not exists user_app_presence_visible_idx
  on public.user_app_presence (user_id, updated_at desc)
  where visibility = 'visible';

alter table public.user_app_presence enable row level security;

drop policy if exists "user_app_presence select own" on public.user_app_presence;
create policy "user_app_presence select own"
  on public.user_app_presence for select
  using (auth.uid() = user_id);

drop policy if exists "user_app_presence insert own" on public.user_app_presence;
create policy "user_app_presence insert own"
  on public.user_app_presence for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_app_presence update own" on public.user_app_presence;
create policy "user_app_presence update own"
  on public.user_app_presence for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_app_presence delete own" on public.user_app_presence;
create policy "user_app_presence delete own"
  on public.user_app_presence for delete
  using (auth.uid() = user_id);

create or replace function public.upsert_user_app_presence(
  p_client_key text,
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

  insert into public.user_app_presence (user_id, client_key, visibility, updated_at)
  values (v_uid, v_key, p_visibility, now())
  on conflict (user_id, client_key) do update set
    visibility = excluded.visibility,
    updated_at = now();
end;
$$;

comment on function public.upsert_user_app_presence(text, text) is
  'PWA 心跳：前景開啟 App 時 Webhook 對此 client_key 略過 verification_approved 推播';

grant execute on function public.upsert_user_app_presence(text, text) to authenticated;

notify pgrst, 'reload schema';
