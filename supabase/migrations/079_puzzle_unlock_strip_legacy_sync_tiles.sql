-- ============================================================
-- 079：清除 photo_unlock_states 中舊版 sync 線性合併的聊天格（0..n-1）
--       078 後 DB 只應保留道具解鎖格；否則前端選格與 DB 不一致會觸發 already unlocked。
-- ============================================================

with chat_targets as (
  select
    m.id as match_id,
    floor(
      least(
        (
          select count(*)::numeric
          from public.messages msg_a
          where msg_a.match_id = m.id
            and msg_a.sender_id = m.user_a
        ),
        (
          select count(*)::numeric
          from public.messages msg_b
          where msg_b.match_id = m.id
            and msg_b.sender_id = m.user_b
        )
      ) / 3
    )::int as chat_target
  from public.matches m
  where m.instant_carry_session_id is null
),
legacy_linear as (
  select ct.match_id, g.g as tile
  from chat_targets ct
  cross join lateral generate_series(
    0,
    greatest(0, least(47, ct.chat_target - 1))
  ) as g
  where ct.chat_target > 0
)
update public.photo_unlock_states pos
set
  unlocked_tiles = coalesce(
    (
      select array_agg(distinct t order by t)
      from unnest(coalesce(pos.unlocked_tiles, '{}'::int[])) as t
      where not exists (
        select 1
        from legacy_linear ll
        where ll.match_id = pos.match_id
          and ll.tile = t
      )
    ),
    '{}'::int[]
  ),
  updated_at = now()
where exists (
  select 1
  from legacy_linear ll
  where ll.match_id = pos.match_id
);

notify pgrst, 'reload schema';
