-- 本機／Staging 手動測試：天選 any time + 即時配對 any time
-- 正式排程請改跑 scripts/disable-fated-pair-test-flags.sql
-- 天選正式排程（台北 app 日 22:00 換日）：週四地選、週五天選
-- 即時配對正式時段：台灣 22:00–隔日 01:00
--
-- 前端本機另需 .env.local：VITE_INSTANT_MATCH_ALWAYS_OPEN=1（InstantMatchTab UI 才會顯示可排隊）

-- ── 天選：任意 app 日 ────────────────────────────────────────

update public.app_feature_flags
set enabled = true
where key = 'fated_pair_enabled';

update public.app_feature_flags
set enabled = false
where key in ('fated_pair_any_day_heaven', 'fated_pair_any_day_earth');

update public.app_feature_flags
set enabled = true
where key = 'fated_pair_any_day';

-- ── 即時配對：任意時間可排隊／撮合（DB instant_match_open_now）──

update public.app_feature_flags
set enabled = true
where key = 'instant_match_always_open';

-- ── 確認 ─────────────────────────────────────────────────────

select key, enabled
from public.app_feature_flags
where key in (
  'fated_pair_enabled',
  'fated_pair_any_day',
  'fated_pair_any_day_heaven',
  'fated_pair_any_day_earth',
  'instant_match_always_open'
)
order by key;

select
  public.app_day_key_now() as app_day_key,
  public.fated_pair_heaven_active_for_day() as heaven_active,
  public.fated_pair_earth_active_for_day() as earth_active,
  public.instant_match_open_now() as instant_open;

-- ── 重測：清當日天選／地選（改 MBTI 或想重跑批次時取消註解）────
-- 或本機執行：npx tsx scripts/reset-fated-pair-today.ts

-- delete from public.fated_pair_assignments where app_day_key = public.app_day_key_now();
-- delete from public.fated_pair_batch_runs where app_day_key = public.app_day_key_now();
-- delete from public.fated_pair_user_day_state where app_day_key = public.app_day_key_now();
-- delete from public.daily_discover_deck where app_day_key = public.app_day_key_now();

-- 僅清探索 deck／shown（測天選前先開探索會佔名單）：scripts/clear-discover-deck-today.sql

-- 若曾誤點 X／「今日略過」，清當日 state 即可再彈：
-- update public.fated_pair_user_day_state
-- set heaven_dismissed = false, earth_dismissed = false
-- where app_day_key = public.app_day_key_now();

-- 若曾按「再也不顯示天選之人」：
-- update public.profiles set fated_heaven_dismissed_forever = false
-- where id in (select id from auth.users where email = 'founding004@tsmedia.tw');

-- ── 錄影：手動指定 founding004（女）天選 ↔ founding003（男）────────
-- 取消下面整段註解後執行；登入 founding004 進主殼應彈天選（只關閉、不接受即可）

/*
do $$
declare
  v_day text := public.app_day_key_now();
  v_u4 uuid;
  v_u3 uuid;
begin
  select id into v_u4 from auth.users where email = 'founding004@tsmedia.tw';
  select id into v_u3 from auth.users where email = 'founding003@tsmedia.tw';
  if v_u4 is null or v_u3 is null then
    raise exception '找不到 founding004 或 founding003';
  end if;

  delete from public.fated_pair_user_day_state
  where app_day_key = v_day and user_id in (v_u4, v_u3);

  delete from public.fated_pair_assignments where app_day_key = v_day;

  insert into public.fated_pair_assignments (
    app_day_key, user_id, kind, partner_user_id, golden_score, challenge_score, interest_overlap
  ) values
    (v_day, v_u4, 'heaven', v_u3, 10, null, 3),
    (v_day, v_u3, 'heaven', v_u4, 10, null, 3);

  insert into public.fated_pair_batch_runs (app_day_key)
  values (v_day)
  on conflict (app_day_key) do nothing;

  update public.profiles set fated_heaven_dismissed_forever = false where id = v_u4;
end $$;
*/
