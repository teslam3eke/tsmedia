-- =============================================================================
-- 探索「後端實際會排出哪些人」預覽（不依賴 JWT / REST）
-- =============================================================================
-- Supabase 若跳出「destructive／RLS」警告：這是預期的（含 DROP + 建立暫存表）。
-- 請選「Run without RLS」或直接確認執行即可。_discover_preview 為 TEMP 表，僅本次連線、不會透過 PostgREST 對外開 API。
--
-- 用法：Supabase Dashboard → SQL Editor（postgres）→ 將下方 VIEWER_UUID「兩處」改成同一個 UUID → 整份執行。
-- 邏輯對齊 migration 034 的 get_daily_discover_deck 組牌流程（略過「今日已有 deck 快取直接回傳」）。
--
-- 預設：黃宥翔（ef12532b-7540-44af-b5b1-bf76bf917d09）
-- =============================================================================

DROP TABLE IF EXISTS _discover_preview;
CREATE TEMP TABLE _discover_preview (
  sort_order   int,
  phase        text,
  profile_id   uuid,
  nickname     text,
  name         text,
  work_region  text,
  home_region  text
);

DO $body$
DECLARE
  -- ▼▼▼ 改成你要預覽的探索使用者（須與最底下兩段 SELECT 一致）▼▼▼
  v_viewer       uuid := 'ef12532b-7540-44af-b5b1-bf76bf917d09'::uuid;
  v_my_gender    text;
  v_pref         text;
  v_pref_norm    text;
  v_order        text[];
  v_picked       uuid[] := array[]::uuid[];
  v_strict_pref  boolean;
  r              text;
  r_pick         uuid;
  incoming_uid   uuid;
  v_need         int;
  sort_i         int := 0;
BEGIN
  SELECT p.gender::text, p.preferred_region::text
  INTO v_my_gender, v_pref
  FROM public.profiles p
  WHERE p.id = v_viewer;

  IF v_my_gender IS NULL THEN
    INSERT INTO _discover_preview VALUES (-1, 'viewer_missing_gender', NULL, NULL, NULL, NULL, NULL);
    RETURN;
  END IF;

  v_strict_pref := v_pref IS NOT NULL AND btrim(v_pref) <> '';
  v_pref_norm := lower(trim(btrim(coalesce(v_pref, ''))));

  IF v_strict_pref THEN
    v_order := array[v_pref_norm];
  ELSE
    v_order := public._daily_discover_region_order(v_pref);
  END IF;

  -- ① 曾對我 like／super_like（與 034 相同：candidate_ok(..., region from v_order, exclude_shown=false)）
  -- 注意：匿名 DO 內勿用「FROM unnest(...) AS x(col text)」，部分環境會報 42601；改用子查詢包 unnest。
  FOR incoming_uid IN
    SELECT q.actor_uid
    FROM (
      SELECT
        i.actor_user_id AS actor_uid,
        max(i.created_at) AS mx
      FROM public.profile_interactions i
      WHERE i.action IN ('like', 'super_like')
        AND i.actor_user_id IS NOT NULL
        AND i.actor_user_id <> v_viewer
        AND (
          i.target_user_id = v_viewer
          OR i.target_profile_key = v_viewer::text
          OR i.target_profile_key = ('user:' || v_viewer::text)
        )
      GROUP BY i.actor_user_id
    ) q
    WHERE EXISTS (
      SELECT 1
      FROM (SELECT unnest(v_order) AS region) ord
      WHERE public._daily_discover_candidate_ok(v_viewer, q.actor_uid, v_my_gender, ord.region, false)
    )
    ORDER BY q.mx DESC
  LOOP
    EXIT WHEN cardinality(v_picked) >= 6;
    IF NOT (incoming_uid = ANY (v_picked)) THEN
      v_picked := array_append(v_picked, incoming_uid);
      sort_i := sort_i + 1;
      INSERT INTO _discover_preview (sort_order, phase, profile_id, nickname, name, work_region, home_region)
      SELECT sort_i, '1_incoming_like', p.id, p.nickname, p.name, p.work_region::text, p.home_region::text
      FROM public.profiles p WHERE p.id = incoming_uid;
    END IF;
  END LOOP;

  -- ② 各區域：先尚未出現在探索（exclude_shown=true）
  FOREACH r IN ARRAY v_order LOOP
    EXIT WHEN cardinality(v_picked) >= 6;
    v_need := 6 - cardinality(v_picked);
    FOR r_pick IN
      SELECT p.id
      FROM public.profiles p
      WHERE public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, r, true)
        AND NOT (p.id = ANY (v_picked))
      ORDER BY
        p.login_last_app_day DESC NULLS LAST,
        p.updated_at DESC NULLS LAST,
        p.id
      LIMIT v_need
    LOOP
      v_picked := v_picked || r_pick;
      sort_i := sort_i + 1;
      INSERT INTO _discover_preview (sort_order, phase, profile_id, nickname, name, work_region, home_region)
      SELECT sort_i, '2_region_first_pass(' || r || ')', p.id, p.nickname, p.name, p.work_region::text, p.home_region::text
      FROM public.profiles p WHERE p.id = r_pick;
      EXIT WHEN cardinality(v_picked) >= 6;
    END LOOP;
  END LOOP;

  -- ③ 仍不足：同區域允許曾出現過（exclude_shown=false）
  IF cardinality(v_picked) < 6 THEN
    FOREACH r IN ARRAY v_order LOOP
      EXIT WHEN cardinality(v_picked) >= 6;
      v_need := 6 - cardinality(v_picked);
      FOR r_pick IN
        SELECT p.id
        FROM public.profiles p
        WHERE public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, r, false)
          AND NOT (p.id = ANY (v_picked))
        ORDER BY
          p.login_last_app_day DESC NULLS LAST,
          p.updated_at DESC NULLS LAST,
          p.id
        LIMIT v_need
      LOOP
        v_picked := v_picked || r_pick;
        sort_i := sort_i + 1;
        INSERT INTO _discover_preview (sort_order, phase, profile_id, nickname, name, work_region, home_region)
        SELECT sort_i, '3_region_repeat(' || r || ')', p.id, p.nickname, p.name, p.work_region::text, p.home_region::text
        FROM public.profiles p WHERE p.id = r_pick;
        EXIT WHEN cardinality(v_picked) >= 6;
      END LOOP;
    END LOOP;
  END IF;

  -- ④ 僅「未設期望區」時：不限區域補滿（034 第三階段）
  IF cardinality(v_picked) = 0 AND NOT v_strict_pref THEN
    v_need := 6;
    FOR r_pick IN
      SELECT p.id
      FROM public.profiles p
      WHERE public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, null::text, true)
        AND NOT (p.id = ANY (v_picked))
      ORDER BY
        p.login_last_app_day DESC NULLS LAST,
        p.updated_at DESC NULLS LAST,
        p.id
      LIMIT v_need
    LOOP
      v_picked := v_picked || r_pick;
      sort_i := sort_i + 1;
      INSERT INTO _discover_preview (sort_order, phase, profile_id, nickname, name, work_region, home_region)
      SELECT sort_i, '4_fallback_any_region_first', p.id, p.nickname, p.name, p.work_region::text, p.home_region::text
      FROM public.profiles p WHERE p.id = r_pick;
      EXIT WHEN cardinality(v_picked) >= 6;
    END LOOP;

    IF cardinality(v_picked) < 6 THEN
      v_need := 6 - cardinality(v_picked);
      FOR r_pick IN
        SELECT p.id
        FROM public.profiles p
        WHERE public._daily_discover_candidate_ok(v_viewer, p.id, v_my_gender, null::text, false)
          AND NOT (p.id = ANY (v_picked))
        ORDER BY
          p.login_last_app_day DESC NULLS LAST,
          p.updated_at DESC NULLS LAST,
          p.id
        LIMIT v_need
      LOOP
        v_picked := v_picked || r_pick;
        sort_i := sort_i + 1;
        INSERT INTO _discover_preview (sort_order, phase, profile_id, nickname, name, work_region, home_region)
        SELECT sort_i, '5_fallback_any_region_repeat', p.id, p.nickname, p.name, p.work_region::text, p.home_region::text
        FROM public.profiles p WHERE p.id = r_pick;
        EXIT WHEN cardinality(v_picked) >= 6;
      END LOOP;
    END IF;
  END IF;
END
$body$;

-- ── 輸出：時間點、viewer 條件、預覽名單 ───────────────────────────────────────

SELECT now() AS db_now_utc,
       timezone('Asia/Taipei', now()) AS taipei_now,
       public.app_day_key_now() AS app_day_key;

SELECT id AS viewer_id,
       gender,
       preferred_region,
       nickname,
       name
FROM public.profiles
WHERE id = 'ef12532b-7540-44af-b5b1-bf76bf917d09'::uuid;  -- 同上 VIEWER_UUID

SELECT *
FROM _discover_preview
ORDER BY sort_order;

-- 若上面為空（0 列）：代表在此規則下「無任何人」；請對照 phase / viewer_missing_gender。
