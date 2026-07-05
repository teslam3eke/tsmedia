/** 配對聊天輔助問答：觸發條件與訊息統計 */

import type { ChatAssistSessionRow } from '@/lib/db'

export const CHAT_ASSIST_IDLE_MS = 2 * 60 * 1000
export const CHAT_ASSIST_HOT_WINDOW_MS = 5 * 60 * 1000
export const CHAT_ASSIST_MIN_TOTAL_MESSAGES = 10
export const CHAT_ASSIST_MIN_EACH_SIDE = 2
export const CHAT_ASSIST_ENTER_GRACE_MS = 30 * 1000
export const CHAT_ASSIST_PEER_PRESENCE_MAX_AGE_MS = 45 * 1000
export const CHAT_ASSIST_POLL_MS = 8_000
export const CHAT_ASSIST_CHECK_INTERVAL_MS = 5_000
export const CHAT_ASSIST_PUZZLE_TILES = 3
/** 與 DB `chat_assist_daily_limit()` 對齊 */
export const CHAT_ASSIST_DAILY_LIMIT = 3
/** 自己答完上一場後，須再隔這麼久才允許開下一場（與 DB `chat_assist_min_interval()` 對齊；起算＝答案公布） */
export const CHAT_ASSIST_POST_SESSION_COOLDOWN_MS = 60 * 60 * 1000

export type ChatAssistMessageLike = {
  from: 'me' | 'them'
  text: string
  createdAt?: string
}

export function countRecentChatMessages(
  messages: ChatAssistMessageLike[],
  windowMs: number,
  now = Date.now(),
): { total: number; mine: number; theirs: number; lastAt: number | null } {
  const cutoff = now - windowMs
  let mine = 0
  let theirs = 0
  let lastAt: number | null = null

  for (const m of messages) {
    const t = m.text?.trim()
    if (!t) continue
    const ts = m.createdAt ? Date.parse(m.createdAt) : NaN
    if (!Number.isFinite(ts)) continue
    if (ts >= cutoff) {
      if (m.from === 'me') mine += 1
      else theirs += 1
    }
    if (lastAt == null || ts > lastAt) lastAt = ts
  }

  return { total: mine + theirs, mine, theirs, lastAt }
}

export type ChatAssistTriggerInput = {
  messages: ChatAssistMessageLike[]
  enteredAtMs: number
  inputFocused: boolean
  sending: boolean
  documentVisible: boolean
  peerInChat: boolean
  /** 今日尚可開新場（無進行中 open 場且未達每日上限） */
  canStartNew: boolean
  /** 上一場答案公布時間（epoch ms）；公布後才起算場次間隔 */
  lastAssistRevealAtMs?: number | null
  now?: number
}

export function getChatAssistLastRevealAtMs(
  sessions: ChatAssistSessionRow[],
  localBumpMs = 0,
): number {
  let max = localBumpMs
  for (const s of sessions) {
    if (s.status !== 'revealed' || !s.my_submitted) continue
    const raw = s.revealed_at
    const ts = raw ? Date.parse(raw) : NaN
    if (Number.isFinite(ts) && ts > max) max = ts
  }
  return max
}

export function shouldTryStartChatAssist(input: ChatAssistTriggerInput): boolean {
  const now = input.now ?? Date.now()
  if (!input.documentVisible) return false
  if (!input.canStartNew) return false
  if (!input.peerInChat) return false
  if (now - input.enteredAtMs < CHAT_ASSIST_ENTER_GRACE_MS) return false
  if (input.inputFocused || input.sending) return false

  const lastRevealAt = input.lastAssistRevealAtMs ?? 0
  if (lastRevealAt > 0 && now - lastRevealAt < CHAT_ASSIST_POST_SESSION_COOLDOWN_MS) {
    return false
  }

  const hot = countRecentChatMessages(input.messages, CHAT_ASSIST_HOT_WINDOW_MS, now)
  if (hot.total < CHAT_ASSIST_MIN_TOTAL_MESSAGES) return false
  if (hot.mine < CHAT_ASSIST_MIN_EACH_SIDE || hot.theirs < CHAT_ASSIST_MIN_EACH_SIDE) return false
  if (hot.lastAt == null) return false

  const idleAnchor = Math.max(hot.lastAt, lastRevealAt)
  if (now - idleAnchor < CHAT_ASSIST_IDLE_MS) return false

  return true
}

export type ChatAssistRevealAnchor = {
  session: ChatAssistSessionRow
  sortAtMs: number
}

export type ChatTimelineMessage = {
  id: string
  from: 'me' | 'them'
  text: string
  time: string
  date: string
  createdAt?: string
  read?: boolean
}

export type ChatTimelineGroup = {
  from: 'me' | 'them'
  date: string
  items: ChatTimelineMessage[]
}

export type ChatTimelineBlock =
  | { type: 'date'; date: string }
  | { type: 'group'; group: ChatTimelineGroup }
  | { type: 'assist'; session: ChatAssistSessionRow }

export function buildChatAssistRevealAnchors(
  sessions: ChatAssistSessionRow[],
): ChatAssistRevealAnchor[] {
  return sessions
    .filter((s) => s.my_answer && s.peer_answer)
    .map((s) => {
      const raw = s.revealed_at ?? s.created_at
      const sortAtMs = raw ? Date.parse(raw) : NaN
      return { session: s, sortAtMs: Number.isFinite(sortAtMs) ? sortAtMs : 0 }
    })
    .sort((a, b) => a.sortAtMs - b.sortAtMs || a.session.id.localeCompare(b.session.id))
}

function chatMessageSortKey(m: ChatTimelineMessage, fallbackOrder: number): number {
  const ts = m.createdAt ? Date.parse(m.createdAt) : NaN
  return Number.isFinite(ts) ? ts : fallbackOrder
}

/** 依每則訊息時間戳插入小助手紀錄（群組層級插入會讓連續自己訊息把紀錄卡卡在底部）。 */
export function buildChatTimelineWithAssists(
  messages: ChatTimelineMessage[],
  sessions: ChatAssistSessionRow[],
): ChatTimelineBlock[] {
  const assists = buildChatAssistRevealAnchors(sessions)
  const sorted = [...messages].sort((a, b) => {
    if (a.createdAt && b.createdAt) {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    }
    return String(a.id).localeCompare(String(b.id))
  })

  type MergeEntry =
    | { kind: 'msg'; at: number; tie: number; msg: ChatTimelineMessage }
    | { kind: 'assist'; at: number; tie: number; session: ChatAssistSessionRow }

  const entries: MergeEntry[] = sorted.map((msg, i) => ({
    kind: 'msg',
    at: chatMessageSortKey(msg, i),
    tie: i,
    msg,
  }))
  assists.forEach((a, i) => {
    entries.push({ kind: 'assist', at: a.sortAtMs, tie: i, session: a.session })
  })

  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at
    if (a.kind !== b.kind) return a.kind === 'msg' ? -1 : 1
    return a.tie - b.tie
  })

  const blocks: ChatTimelineBlock[] = []
  let lastDate = ''
  let currentGroup: ChatTimelineGroup | null = null

  const flushGroup = () => {
    if (!currentGroup) return
    blocks.push({ type: 'group', group: currentGroup })
    currentGroup = null
  }

  for (const entry of entries) {
    if (entry.kind === 'assist') {
      flushGroup()
      blocks.push({ type: 'assist', session: entry.session })
      continue
    }

    const m = entry.msg
    if (m.date !== lastDate) {
      flushGroup()
      blocks.push({ type: 'date', date: m.date })
      lastDate = m.date
    }

    if (currentGroup && currentGroup.from === m.from && currentGroup.date === m.date) {
      currentGroup.items.push(m)
    } else {
      flushGroup()
      currentGroup = { from: m.from, date: m.date, items: [m] }
    }
  }

  flushGroup()
  return blocks
}
