-- 166：Registration Reminder Email（三階段 +24h/+48h/+72h；不 backfill 歷史 confirmed 用戶）

-- ─── 1) Go-live cutoff（migration 套用當下 = eligible_after；此前 email confirmed 者不進 cohort） ───

create table if not exists public.registration_reminder_rollout (
  id int primary key check (id = 1),
  eligible_after timestamptz not null
);

insert into public.registration_reminder_rollout (id, eligible_after)
values (1, now())
on conflict (id) do nothing;

comment on table public.registration_reminder_rollout is
  '單列：registration reminder 開始適用之 email_confirmed_at 下限（套用 migration 時寫入，不 backfill）。';

create or replace function public.registration_reminder_eligible_after()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select r.eligible_after
  from public.registration_reminder_rollout r
  where r.id = 1;
$$;

revoke all on function public.registration_reminder_eligible_after() from public, anon, authenticated;
grant execute on function public.registration_reminder_eligible_after() to service_role;

alter table public.registration_reminder_rollout enable row level security;

drop policy if exists "registration reminder rollout: no direct access"
  on public.registration_reminder_rollout;
create policy "registration reminder rollout: no direct access"
  on public.registration_reminder_rollout for all
  using (false)
  with check (false);

revoke all on table public.registration_reminder_rollout from anon, authenticated;

-- ─── 2) Email delivery（每 user 每 reminder_stage 最多一封；stage 1–3） ───

create table if not exists public.registration_reminder_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reminder_stage smallint not null check (reminder_stage between 1 and 3),
  sent_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  last_error text,
  in_flight_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists registration_reminder_email_deliveries_user_stage_uidx
  on public.registration_reminder_email_deliveries (user_id, reminder_stage);

alter table public.registration_reminder_email_deliveries enable row level security;

drop policy if exists "registration reminder email deliveries: no direct access"
  on public.registration_reminder_email_deliveries;
create policy "registration reminder email deliveries: no direct access"
  on public.registration_reminder_email_deliveries for all
  using (false)
  with check (false);

revoke all on table public.registration_reminder_email_deliveries from anon, authenticated;

drop trigger if exists registration_reminder_email_deliveries_updated_at
  on public.registration_reminder_email_deliveries;
create trigger registration_reminder_email_deliveries_updated_at
  before update on public.registration_reminder_email_deliveries
  for each row execute procedure public.handle_updated_at();

-- ─── 3) Claim / mark / release（service_role only） ───

create or replace function public.claim_registration_reminder_email_delivery(
  p_user_id uuid,
  p_reminder_stage smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.registration_reminder_email_deliveries%rowtype;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  end if;

  if p_reminder_stage is null or p_reminder_stage not between 1 and 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reminder_stage');
  end if;

  insert into public.registration_reminder_email_deliveries (user_id, reminder_stage)
  values (p_user_id, p_reminder_stage)
  on conflict (user_id, reminder_stage) do nothing;

  select * into v_row
  from public.registration_reminder_email_deliveries d
  where d.user_id = p_user_id
    and d.reminder_stage = p_reminder_stage
  for update;

  if v_row.sent_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;

  if v_row.in_flight_until is not null and v_row.in_flight_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'in_flight');
  end if;

  update public.registration_reminder_email_deliveries
  set
    attempts = coalesce(attempts, 0) + 1,
    last_attempt_at = now(),
    in_flight_until = now() + interval '90 seconds'
  where user_id = p_user_id
    and reminder_stage = p_reminder_stage
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_row.user_id,
    'reminder_stage', v_row.reminder_stage
  );
end;
$$;

create or replace function public.mark_registration_reminder_email_sent(
  p_user_id uuid,
  p_reminder_stage smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  end if;

  if p_reminder_stage is null or p_reminder_stage not between 1 and 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reminder_stage');
  end if;

  update public.registration_reminder_email_deliveries
  set
    sent_at = coalesce(sent_at, now()),
    in_flight_until = null,
    last_error = null
  where user_id = p_user_id
    and reminder_stage = p_reminder_stage;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_registration_reminder_email_in_flight(
  p_user_id uuid,
  p_reminder_stage smallint,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user_id');
  end if;

  if p_reminder_stage is null or p_reminder_stage not between 1 and 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reminder_stage');
  end if;

  update public.registration_reminder_email_deliveries
  set
    in_flight_until = null,
    last_error = coalesce(v_err, last_error)
  where user_id = p_user_id
    and reminder_stage = p_reminder_stage
    and sent_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.claim_registration_reminder_email_delivery(uuid, smallint) from public, anon, authenticated;
revoke all on function public.mark_registration_reminder_email_sent(uuid, smallint) from public, anon, authenticated;
revoke all on function public.release_registration_reminder_email_in_flight(uuid, smallint, text) from public, anon, authenticated;

grant execute on function public.claim_registration_reminder_email_delivery(uuid, smallint) to service_role;
grant execute on function public.mark_registration_reminder_email_sent(uuid, smallint) to service_role;
grant execute on function public.release_registration_reminder_email_in_flight(uuid, smallint, text) to service_role;

notify pgrst, 'reload schema';
