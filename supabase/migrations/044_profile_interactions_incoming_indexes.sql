-- ============================================================
-- 044: 探索 RPC 熱路徑索引（減輕 PostgREST「Warp / timeout manager」斷線）
--
-- Dashboard 若出現：Warp server error: Thread killed by timeout manager
-- 多半是本機資料庫中某請求超出 PostgREST/Gateway 對單請求的 CPU／時間上限。
-- __get_daily_discover_deck_impl 對 profile_interactions 的「incoming 愛心／超喜」
-- subquery（依 target_user_id 或 target_profile_key 過濾）若無合適索引，資料量稍大就容易全表掃描。
--
-- 此檔為 CONCURRENTLY 以外的標準 migration；正式環境資料量大時可先於維護窗手動 CREATE INDEX CONCURRENTLY。
-- ============================================================

create index if not exists profile_interactions_incoming_target_uid_idx
  on public.profile_interactions (target_user_id, actor_user_id)
  where action in ('like', 'super_like')
    and target_user_id is not null;

create index if not exists profile_interactions_incoming_target_key_idx
  on public.profile_interactions (target_profile_key, actor_user_id)
  where action in ('like', 'super_like');

