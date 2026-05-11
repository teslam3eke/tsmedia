import type { InstantMatchPollResult } from '@/lib/db'

/** 「我知道了」後 idle 提示（需與 migration idle hint 意旨一致） */
export const INSTANT_MATCH_IDLE_HINT =
  '尚未加入等候。點「開始配對」加入；需同時有另一位使用者也在等候才會開房。'

/** 「我知道了」後 DB 仍會回傳同場次的 done——略過並顯示 idle，避免馬上跳出結束頁 */
export function applyDismissedSessionFilter(
  data: InstantMatchPollResult,
  dismissedIds: ReadonlySet<string>,
): InstantMatchPollResult {
  if (data.status !== 'done') return data
  if (!data.session_id || !dismissedIds.has(data.session_id)) return data
  return {
    status: 'idle',
    hint: INSTANT_MATCH_IDLE_HINT,
  }
}
