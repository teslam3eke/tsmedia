-- 154：首次審核通過者的第一副探索牌，固定近七日愛心排行前三名。
--
-- 規格：
-- 1) 僅 migration 上線後，profiles.verification_status 人生第一次轉為 approved 的會員取得一次資格。
-- 2) 資格保留到未來第一次成功建立探索 deck，不因換日失效。
-- 3) 第 1～3 張固定為「該 viewer 有效候選池」中近七日收到 like 數第 1～3 名；
--    第 4～6 張沿用 152 的原始牌組順序，並去除重複。
-- 4) 特殊 deck 的 pinned prefix 不洗牌；incoming super_like 僅能排在 prefix 後方。
-- 5) 特殊 deck 建立後即消耗資格；隔日與後續 deck 完全走原規則。

-- ── 一次性資格與稽核資料 ──────────────────────────────────────────────────

create table if not exists public.first_approved_discover_boosts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  eligible_at        timestamptz not null,
  consumed_at        timestamptz,
  deck_app_day_key   text,
  pinned_user_ids    uuid[] not null default array[]::uuid[],
  pinned_heart_counts integer[] not null default array[]::integer[],
  created_at         timestamptz not null default now(),
  constraint first_approved_discover_boosts_consumed_pair_check
    check (
      (consumed_at is null and deck_app_day_key is null)
      or (consumed_at is not null and deck_app_day_key is not null)
    )
);

comment on table public.first_approved_discover_boosts is
  '首次審核通過者的一次性探索熱門前三資格；現有 approved 會員於 154 套用時預先標記 consumed。';

alter table public.first_approved_discover_boosts enable row level security;

-- 不開放一般客戶端直接讀寫；僅 trigger／security definer 探索函式使用。
revoke all on table public.first_approved_discover_boosts from anon, authenticated;

-- 觸發器必須早於基準回填，避免套用期間 approved 轉換漏登記。
create or replace function public.register_first_approved_discover_boost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status = 'approved'
     and old.verification_status is distinct from new.verification_status then
    -- 與探索 RPC 使用同一把會員級交易鎖。若核准與建牌同時發生，
    -- 兩者會依取得鎖的先後完整執行，不會在 DELETE 後又寫回普通 deck。
    perform pg_advisory_xact_lock(
      hashtextextended('first-approved-discover:' || new.id::text, 0)
    );

    insert into public.first_approved_discover_boosts (user_id, eligible_at)
    values (new.id, now())
    on conflict (user_id) do nothing;

    if found then
      -- 只在「真的新增首次資格」時清除；舊會員 re-approved 的 ON CONFLICT
      -- 不得誤刪其當日正常 deck。
      delete from public.daily_discover_deck
      where viewer_user_id = new.id
        and app_day_key = public.app_day_key_now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_register_first_approved_discover_boost
  on public.profiles;

create trigger profiles_register_first_approved_discover_boost
  after update of verification_status on public.profiles
  for each row
  when (
    new.verification_status = 'approved'
    and old.verification_status is distinct from new.verification_status
  )
  execute function public.register_first_approved_discover_boost();

-- CREATE TRIGGER 取得的 profiles 表鎖會持有到 migration 交易提交；
-- 因此先建立 trigger 再回填，可正確切開上線前／後的 approved 轉換。
insert into public.first_approved_discover_boosts (
  user_id,
  eligible_at,
  consumed_at,
  deck_app_day_key
)
select
  prior.user_id,
  now(),
  now(),
  public.app_day_key_now()
from (
  -- 現在已通過，或歷史申請／身分文件曾通過，都視為上線前已享有過審核結果。
  -- 這也防止目前為 rejected 的舊會員日後再 approved 時誤拿新資格。
  select p.id as user_id
  from public.profiles p
  where p.verification_status = 'approved'

  union

  select va.user_id
  from public.verification_applications va
  where va.status = 'approved'

  union

  select vd.user_id
  from public.verification_docs vd
  where vd.status = 'approved'
    and vd.verification_kind in ('employment', 'identity')
) prior
on conflict (user_id) do nothing;

-- ── 牌組策略欄位：讓同日快取重讀仍可保護前三名 ────────────────────────────

alter table public.daily_discover_deck
  add column if not exists build_strategy text not null default 'normal',
  add column if not exists pinned_prefix_count integer not null default 0;

alter table public.daily_discover_deck
  drop constraint if exists daily_discover_deck_build_strategy_check;

alter table public.daily_discover_deck
  add constraint daily_discover_deck_build_strategy_check
    check (build_strategy in ('normal', 'first_approved_popular'));

alter table public.daily_discover_deck
  drop constraint if exists daily_discover_deck_pinned_prefix_count_check;

alter table public.daily_discover_deck
  add constraint daily_discover_deck_pinned_prefix_count_check
    check (pinned_prefix_count between 0 and 3);

-- ── 最近七日熱門排行索引 ────────────────────────────────────────────────────

create index if not exists profile_interactions_like_target_recent_idx
  on public.profile_interactions (target_user_id, created_at desc, actor_user_id)
  where action = 'like' and target_user_id is not null;

create index if not exists profile_interactions_like_target_key_recent_idx
  on public.profile_interactions (target_profile_key, created_at desc, actor_user_id)
  where action = 'like';

-- ── 熱門前三：完整沿用 148/152 的年齡放寬與候選安全條件 ─────────────────────

create or replace function public._discover_first_approved_popular_targets(
  p_viewer uuid,
  p_my_gender text,
  p_pref text
)
returns table(user_id uuid, heart_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_my_age integer;
  v_saved_age_min integer;
  v_saved_age_max integer;
  v_strict_age_min integer;
  v_strict_age_max integer;
  v_age_min integer;
  v_age_max integer;
  v_hard_candidate_count integer;
  v_order_expand text[];
  v_strict_pref boolean;
  v_has_region_candidate boolean;
begin
  select p.age, p.preferred_age_min, p.preferred_age_max
  into v_my_age, v_saved_age_min, v_saved_age_max
  from public.profiles p
  where p.id = p_viewer;

  if v_saved_age_min is not null and v_saved_age_max is not null then
    v_strict_age_min := v_saved_age_min;
    v_strict_age_max := v_saved_age_max;
  elsif v_my_age is null then
    v_strict_age_min := 18;
    v_strict_age_max := 80;
  else
    v_my_age := greatest(18, least(80, v_my_age));
    v_strict_age_min := greatest(18, v_my_age - 5);
    v_strict_age_max := least(80, v_my_age + 5);

    if v_strict_age_max - v_strict_age_min < 10 then
      if v_strict_age_min = 18 then
        v_strict_age_max := 28;
      else
        v_strict_age_min := 70;
      end if;
    end if;
  end if;

  v_age_min := v_strict_age_min;
  v_age_max := v_strict_age_max;

  select count(*)
  into v_hard_candidate_count
  from public.profiles p
  where public._daily_discover_candidate_ok_age(
    p_viewer, p.id, p_my_gender, null::text, false, v_age_min, v_age_max
  );

  if v_hard_candidate_count < 6 then
    v_age_min := greatest(18, v_strict_age_min - 3);
    v_age_max := least(80, v_strict_age_max + 3);

    select count(*)
    into v_hard_candidate_count
    from public.profiles p
    where public._daily_discover_candidate_ok_age(
      p_viewer, p.id, p_my_gender, null::text, false, v_age_min, v_age_max
    );
  end if;

  if v_hard_candidate_count < 6 then
    v_age_min := greatest(18, v_strict_age_min - 6);
    v_age_max := least(80, v_strict_age_max + 6);

    select count(*)
    into v_hard_candidate_count
    from public.profiles p
    where public._daily_discover_candidate_ok_age(
      p_viewer, p.id, p_my_gender, null::text, false, v_age_min, v_age_max
    );
  end if;

  if v_hard_candidate_count < 6 then
    v_age_min := null;
    v_age_max := null;
  end if;

  v_order_expand := public._daily_discover_region_order(p_pref);
  v_strict_pref := p_pref is not null and btrim(p_pref) <> '';

  select exists (
    select 1
    from public.profiles p
    where exists (
      select 1
      from (select unnest(v_order_expand) as region) ord
      where public._daily_discover_candidate_ok_age(
        p_viewer, p.id, p_my_gender, ord.region, false, v_age_min, v_age_max
      )
    )
  )
  into v_has_region_candidate;

  return query
  select ranked.id, ranked.hearts
  from (
    select
      p.id,
      (
        select count(distinct i.actor_user_id)::integer
        from public.profile_interactions i
        where i.action = 'like'
          and i.created_at >= now() - interval '7 days'
          and (
            i.target_user_id = p.id
            or i.target_profile_key = p.id::text
            or i.target_profile_key = ('user:' || p.id::text)
          )
      ) as hearts,
      p.age,
      p.login_last_app_day,
      p.updated_at
    from public.profiles p
    where (
      exists (
        select 1
        from (select unnest(v_order_expand) as region) ord
        where public._daily_discover_candidate_ok_age(
          p_viewer, p.id, p_my_gender, ord.region, false, v_age_min, v_age_max
        )
      )
      or (
        not v_strict_pref
        and not v_has_region_candidate
        and public._daily_discover_candidate_ok_age(
          p_viewer, p.id, p_my_gender, null::text, false, v_age_min, v_age_max
        )
      )
    )
  ) ranked
  order by
    ranked.hearts desc,
    case when ranked.age between v_strict_age_min and v_strict_age_max then 0 else 1 end,
    ranked.login_last_app_day desc nulls last,
    ranked.updated_at desc nulls last,
    ranked.id
  limit 3;
end;
$$;

comment on function public._discover_first_approved_popular_targets(uuid, text, text) is
  '首次通過特殊 deck：同一有效年齡／安全／區域擴展池中，依最近 7x24h 收到的不重複 like 人數取前三。';

revoke all on function public._discover_first_approved_popular_targets(uuid, text, text)
  from public, anon, authenticated;

-- 特殊 deck 同日重讀時，超喜仍優先，但只能排在固定熱門 prefix 後方。
create or replace function public._discover_apply_super_like_after_pinned_prefix(
  p_viewer uuid,
  p_my_gender text,
  p_region_order text[],
  p_deck uuid[],
  p_pinned_prefix_count integer
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_deck uuid[] := coalesce(p_deck, array[]::uuid[]);
  v_super uuid[] := array[]::uuid[];
  v_out uuid[] := array[]::uuid[];
  v_prefix_count integer;
  r uuid;
  i integer;
begin
  v_prefix_count := least(
    greatest(coalesce(p_pinned_prefix_count, 0), 0),
    cardinality(v_deck)
  );

  if v_prefix_count = 0 then
    return public._discover_apply_super_like_priority(
      p_viewer, p_my_gender, p_region_order, v_deck
    );
  end if;

  -- 固定熱門 prefix 永遠先放。
  for i in 1..v_prefix_count loop
    if v_deck[i] is not null and not (v_deck[i] = any(v_out)) then
      v_out := array_append(v_out, v_deck[i]);
    end if;
  end loop;

  -- 不直接委派舊 helper：舊 helper 假設輸入永遠是 base 6，
  -- 對已含額外超喜槽位的快取 deck 再套用時可能截短。這裡保留全部超喜。
  select coalesce(array_agg(q.actor_uid order by q.mx desc), array[]::uuid[])
  into v_super
  from (
    select
      i.actor_user_id as actor_uid,
      max(i.created_at) as mx
    from public.profile_interactions i
    where i.action = 'super_like'
      and i.actor_user_id is not null
      and i.actor_user_id <> p_viewer
      and (
        i.target_user_id = p_viewer
        or i.target_profile_key = p_viewer::text
        or i.target_profile_key = ('user:' || p_viewer::text)
      )
    group by i.actor_user_id
  ) q
  where public._discover_incoming_super_like_ok(
    p_viewer, q.actor_uid, p_my_gender
  );

  foreach r in array v_super loop
    if r is not null and not (r = any(v_out)) then
      v_out := array_append(v_out, r);
    end if;
  end loop;

  -- 最後接回原 deck 其餘成員，確保快取中的 base 與額外槽位都不遺失。
  foreach r in array v_deck loop
    if r is not null and not (r = any(v_out)) then
      v_out := array_append(v_out, r);
    end if;
  end loop;

  return v_out;
end;
$$;

revoke all on function public._discover_apply_super_like_after_pinned_prefix(
  uuid, text, text[], uuid[], integer
) from public, anon, authenticated;

-- ── 保留 152 原始實作，外層僅攔截一次性特殊牌組 ─────────────────────────────

alter function public.__get_daily_discover_deck_impl()
  rename to __get_daily_discover_deck_normal_impl;

-- 防止客戶端繞過一次性外層直接呼叫原始建牌函式。
revoke all on function public.__get_daily_discover_deck_normal_impl()
  from public, anon, authenticated;

create or replace function public.__get_daily_discover_deck_impl()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_day text := public.app_day_key_now();
  v_my_gender text;
  v_pref text;
  v_verification_status text;
  v_order_expand text[];
  v_has_boost boolean := false;
  v_original uuid[] := array[]::uuid[];
  v_final uuid[] := array[]::uuid[];
  v_hot_ids uuid[] := array[]::uuid[];
  v_hot_counts integer[] := array[]::integer[];
  v_strategy text;
  v_pinned_count integer;
  v_inserted_hot uuid[] := array[]::uuid[];
  v_removed_original uuid[] := array[]::uuid[];
  r uuid;
  rec record;
begin
  if v_viewer is null then
    raise exception 'Not authenticated';
  end if;

  -- 與 approved trigger 使用同一把交易鎖。鎖必須早於 profile／deck 讀取：
  -- 若探索先取得鎖，核准會等普通 deck 完成後再新增資格並刪除該 deck；
  -- 若核准先取得鎖，探索醒來後會直接看到 approved 與未消耗資格。
  perform pg_advisory_xact_lock(
    hashtextextended('first-approved-discover:' || v_viewer::text, 0)
  );

  select
    p.gender::text,
    p.preferred_region::text,
    p.verification_status::text
  into v_my_gender, v_pref, v_verification_status
  from public.profiles p
  where p.id = v_viewer;

  if v_my_gender is null then
    return '[]'::jsonb;
  end if;

  v_order_expand := public._daily_discover_region_order(v_pref);

  -- 快取命中：特殊牌保護 prefix；普通牌完全沿用既有超喜置頂。
  select d.target_user_ids, d.build_strategy, d.pinned_prefix_count
  into v_original, v_strategy, v_pinned_count
  from public.daily_discover_deck d
  where d.viewer_user_id = v_viewer
    and d.app_day_key = v_day;

  if found and cardinality(coalesce(v_original, array[]::uuid[])) > 0 then
    if v_strategy = 'first_approved_popular' and v_pinned_count > 0 then
      v_final := public._discover_apply_super_like_after_pinned_prefix(
        v_viewer, v_my_gender, v_order_expand, v_original, v_pinned_count
      );
    else
      v_final := public._discover_apply_super_like_priority(
        v_viewer, v_my_gender, v_order_expand, v_original
      );
    end if;
    return public._daily_discover_profiles_json(v_viewer, v_day, v_final);
  end if;

  -- FOR UPDATE 讓同一會員的並行首次請求只能有一個建立／消耗特殊 deck。
  perform 1
  from public.first_approved_discover_boosts b
  where b.user_id = v_viewer
    and b.consumed_at is null
    and v_verification_status = 'approved'
  for update;
  v_has_boost := found;

  -- 等待 row lock 的請求醒來時，前一交易可能已建立 deck；務必再讀一次。
  select d.target_user_ids, d.build_strategy, d.pinned_prefix_count
  into v_original, v_strategy, v_pinned_count
  from public.daily_discover_deck d
  where d.viewer_user_id = v_viewer
    and d.app_day_key = v_day;

  if found and cardinality(coalesce(v_original, array[]::uuid[])) > 0 then
    if v_strategy = 'first_approved_popular' and v_pinned_count > 0 then
      v_final := public._discover_apply_super_like_after_pinned_prefix(
        v_viewer, v_my_gender, v_order_expand, v_original, v_pinned_count
      );
    else
      v_final := public._discover_apply_super_like_priority(
        v_viewer, v_my_gender, v_order_expand, v_original
      );
    end if;
    return public._daily_discover_profiles_json(v_viewer, v_day, v_final);
  end if;

  if not v_has_boost then
    return public.__get_daily_discover_deck_normal_impl();
  end if;

  -- 先讓 152 原函式完整產生普通 deck，後三張才能真正沿用原規則。
  perform public.__get_daily_discover_deck_normal_impl();

  select d.target_user_ids
  into v_original
  from public.daily_discover_deck d
  where d.viewer_user_id = v_viewer
    and d.app_day_key = v_day;

  v_original := coalesce(v_original, array[]::uuid[]);
  if cardinality(v_original) = 0 then
    -- 沒有任何候選人時不消耗資格，未來有池量後仍能取得特殊第一副牌。
    return '[]'::jsonb;
  end if;

  for rec in
    select pop.user_id, pop.heart_count
    from public._discover_first_approved_popular_targets(
      v_viewer, v_my_gender, v_pref
    ) pop
  loop
    v_hot_ids := array_append(v_hot_ids, rec.user_id);
    v_hot_counts := array_append(v_hot_counts, rec.heart_count);
    if not (rec.user_id = any(v_final)) then
      v_final := array_append(v_final, rec.user_id);
    end if;
  end loop;

  v_pinned_count := cardinality(v_final);

  -- 原 deck 依原順序補到 base 6；熱門前三與普通牌重複時自動略過。
  foreach r in array v_original loop
    exit when cardinality(v_final) >= 6;
    if r is not null and not (r = any(v_final)) then
      v_final := array_append(v_final, r);
    end if;
  end loop;

  -- 原 deck 中未進 base 6、但確實曾對 viewer 超喜者，保留為第 7 張後額外槽位。
  foreach r in array v_original loop
    if r is null or r = any(v_final) then
      continue;
    end if;
    if exists (
      select 1
      from public.profile_interactions i
      where i.actor_user_id = r
        and i.action = 'super_like'
        and (
          i.target_user_id = v_viewer
          or i.target_profile_key = v_viewer::text
          or i.target_profile_key = ('user:' || v_viewer::text)
        )
    ) then
      v_final := array_append(v_final, r);
    end if;
  end loop;

  -- 修正 normal_impl 已寫入的 shown：移除實際未展示者的一次計數。
  select coalesce(array_agg(x), array[]::uuid[])
  into v_removed_original
  from unnest(v_original) as u(x)
  where not (x = any(v_final));

  if cardinality(v_removed_original) > 0 then
    update public.daily_discover_shown s
    set deck_show_count = s.deck_show_count - 1
    where s.viewer_user_id = v_viewer
      and s.shown_user_id = any(v_removed_original);

    delete from public.daily_discover_shown s
    where s.viewer_user_id = v_viewer
      and s.shown_user_id = any(v_removed_original)
      and s.deck_show_count <= 0;
  end if;

  -- 熱門前三若原本不在 normal deck，補上實際展示紀錄。
  select coalesce(array_agg(x), array[]::uuid[])
  into v_inserted_hot
  from unnest(v_hot_ids) as u(x)
  where not (x = any(v_original));

  if cardinality(v_inserted_hot) > 0 then
    insert into public.daily_discover_shown (
      viewer_user_id, shown_user_id, first_app_day_key, deck_show_count
    )
    select v_viewer, x, v_day, 1
    from unnest(v_inserted_hot) as u(x)
    on conflict (viewer_user_id, shown_user_id)
    do update set
      deck_show_count = public.daily_discover_shown.deck_show_count + 1;
  end if;

  update public.daily_discover_deck
  set
    target_user_ids = v_final,
    build_strategy = 'first_approved_popular',
    pinned_prefix_count = v_pinned_count
  where viewer_user_id = v_viewer
    and app_day_key = v_day;

  update public.first_approved_discover_boosts
  set
    consumed_at = now(),
    deck_app_day_key = v_day,
    pinned_user_ids = v_hot_ids,
    pinned_heart_counts = v_hot_counts
  where user_id = v_viewer
    and consumed_at is null;

  return public._daily_discover_profiles_json(v_viewer, v_day, v_final);
end;
$$;

comment on function public.__get_daily_discover_deck_impl() is
  '探索 deck 外層：首次 approved 資格的第一副牌固定近七日愛心前三；其餘與後續牌組委派 152 原規則。';

revoke all on function public.__get_daily_discover_deck_impl()
  from public, anon, authenticated;

-- 包裝 RPC 會間接寫入 deck／shown／boost，必須維持 VOLATILE，避免 PostgREST 25006。
create or replace function public.get_daily_discover_deck()
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  select public.__get_daily_discover_deck_impl();
$$;

create or replace function public.get_daily_discover_deck_v2()
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  select public.__get_daily_discover_deck_impl();
$$;

grant execute on function public.get_daily_discover_deck() to authenticated;
grant execute on function public.get_daily_discover_deck_v2() to authenticated;

notify pgrst, 'reload schema';
