/** 同一場 chat assist 的 modal 是否已處理（送出／關閉後不再自動彈出）。 */

const HANDLED_PREFIX = 'tsm_chat_assist_handled:'

export function isChatAssistModalHandled(sessionId: string): boolean {
  if (!sessionId) return false
  try {
    return localStorage.getItem(`${HANDLED_PREFIX}${sessionId}`) === '1'
  } catch {
    return false
  }
}

export function markChatAssistModalHandled(sessionId: string): void {
  if (!sessionId) return
  try {
    localStorage.setItem(`${HANDLED_PREFIX}${sessionId}`, '1')
  } catch {
    /* private mode */
  }
}
