/**
 * 「即時配對」七分鐘隨機房：佇列、倒數時間以 DB `chat_ends_at` 為準；
 * 決策為雙向 friend 後由 RPC 寫入 matches。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { motion } from 'framer-motion'
import { Heart, Send, Timer, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProfileRow } from '@/lib/types'
import { PUZZLE_MAX_PHOTO_SLOTS } from '@/lib/types'
import {
  instantMatchPoll,
  instantMatchLeaveQueue,
  getInstantSessionMessages,
  sendInstantSessionMessage,
  instantSessionDecide,
  subscribeToInstantSessionMessages,
  getProfile,
  resolvePhotoUrls,
  type InstantMatchPollResult,
  type InstantSessionMessageRow,
} from '@/lib/db'

type Props = {
  userId: string
  foregroundReloadNonce: number
  onMutualFriendMatchCreated?: () => void
  /** 通知主殼是否在「排隊中」，以便切 tab 時跳出離開確認 */
  onWaitingStateChange?: (waiting: boolean) => void
}

type UiMsg = { id: string; text: string; fromMe: boolean; ts: number }

/** 與探索／配對列表一致：白底、灰框、輕陰影 */
function InstantCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-gray-200 bg-white p-6 text-center shadow-sm ring-1 ring-black/[0.03]',
        className,
      )}
    >
      {children}
    </div>
  )
}

function InstantHeading({ subtitle }: { subtitle: string }) {
  return (
    <header className="px-5 pb-2 pt-2">
      <h1 className="text-[22px] font-black tracking-tight text-slate-900">即時配對</h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{subtitle}</p>
    </header>
  )
}

/** 排隊中：高對比動態（雷達環 + 掃描條 + 跳字點）— 配色仍維持 slate 主軸 */
function MatchingPulseVisual() {
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex h-[7.5rem] w-[7.5rem] items-center justify-center">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-800/40"
            style={{ width: 56, height: 56 }}
            initial={{ opacity: 0.5 }}
            animate={{ scale: [1, 2.85], opacity: [0.5, 0] }}
            transition={{ duration: 4.6, repeat: Infinity, delay: i * 1.45, ease: 'easeOut' }}
          />
        ))}
        <motion.div
          className="relative z-[1] flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        >
          <Users className="h-8 w-8" strokeWidth={2} />
        </motion.div>
      </div>
      <p className="mt-4 flex items-center justify-center gap-0.5 text-sm font-bold text-slate-800">
        尋找另一位使用者
        <WaitingDots />
      </p>
      <div className="relative mt-5 h-2 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-200">
        <motion.div
          className="absolute inset-y-0 w-[42%] rounded-full bg-slate-800"
          initial={{ left: '-42%' }}
          animate={{ left: '100%' }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    </div>
  )
}

function WaitingDots() {
  return (
    <span className="inline-flex gap-0.5 pl-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-slate-800"
          animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }}
          transition={{ duration: 1.55, repeat: Infinity, delay: i * 0.35 }}
        />
      ))}
    </span>
  )
}

/** 離開本分頁：一律 leave_queue（僅清空 session_id 為 null 的列）。App 進入背景時若尚在排隊也退出。 */
function useInstantQueueExitOnLeave(
  snapshot: InstantMatchPollResult | null,
  setSnapshot: Dispatch<SetStateAction<InstantMatchPollResult | null>>,
) {
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  useEffect(() => {
    const flushQueueIfWaiting = async () => {
      if (snapshotRef.current?.status !== 'waiting') return
      await instantMatchLeaveQueue()
      const res = await instantMatchPoll({ enqueue: false })
      if (res.ok && res.data.status !== 'done') setSnapshot(res.data)
    }

    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flushQueueIfWaiting()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      void instantMatchLeaveQueue()
    }
  }, [setSnapshot])
}

export default function InstantMatchTab({
  userId,
  foregroundReloadNonce,
  onMutualFriendMatchCreated,
  onWaitingStateChange,
}: Props) {
  const onMutualFriendMatchCreatedRef = useRef(onMutualFriendMatchCreated)
  onMutualFriendMatchCreatedRef.current = onMutualFriendMatchCreated

  const [busy, setBusy] = useState(false)
  const [pollError, setPollError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<InstantMatchPollResult | null>(null)
  const [peer, setPeer] = useState<ProfileRow | null>(null)
  const [messages, setMessages] = useState<UiMsg[]>([])
  const [input, setInput] = useState('')
  /** 試玩局部拼圖（本房內）：不寫進 photo_unlock_states */
  const [teaserTiles, setTeaserTiles] = useState<number[]>([])
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [pollReady, setPollReady] = useState(false)

  useEffect(() => {
    const waiting = !!(pollReady && snapshot?.status === 'waiting')
    onWaitingStateChange?.(waiting)
  }, [pollReady, snapshot, onWaitingStateChange])

  useEffect(() => {
    return () => {
      onWaitingStateChange?.(false)
    }
  }, [onWaitingStateChange])

  useInstantQueueExitOnLeave(snapshot, setSnapshot)

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const doneHoldRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function poke() {
      if (doneHoldRef.current) return
      const res = await instantMatchPoll({ enqueue: false })
      if (cancelled) return
      setPollReady(true)
      if (!res.ok) {
        setPollError(res.error)
        return
      }
      setPollError(null)
      const r = res.data
      setSnapshot((prev) => {
        if (prev?.status === 'done') return prev
        if (r.status === 'done' && r.mutual_friend) onMutualFriendMatchCreatedRef.current?.()
        if (r.status === 'done') doneHoldRef.current = true
        return r
      })
    }
    void poke()
    const id = window.setInterval(poke, 3200)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [userId, foregroundReloadNonce])

  useEffect(() => {
    setSnapshot(null)
    setPeer(null)
    setMessages([])
    setTeaserTiles([])
    setPollError(null)
    setPollReady(false)
    doneHoldRef.current = false
  }, [userId])

  const inSession = snapshot?.status === 'in_session' ? snapshot : null
  const sessionId = inSession?.session_id

  useEffect(() => {
    const peerId = inSession?.peer_user_id
    if (!peerId) {
      setPeer(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const row = await getProfile(peerId)
      if (!cancelled) setPeer(row ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [inSession?.peer_user_id])

  const loadMsgs = useCallback(
    async (sid: string) => {
      const rows = await getInstantSessionMessages(sid)
      if (!rows) return
      const mapped: UiMsg[] = rows.map((m: InstantSessionMessageRow) => ({
        id: m.id,
        text: m.body,
        fromMe: m.sender_id === userId,
        ts: new Date(m.created_at).getTime(),
      }))
      mapped.sort((a, b) => a.ts - b.ts)
      setMessages(mapped)
    },
    [userId],
  )

  useEffect(() => {
    if (!sessionId) return
    void loadMsgs(sessionId)
    return subscribeToInstantSessionMessages(sessionId, (row) => {
      setMessages((prev) => {
        if (prev.some((x) => x.id === row.id)) return prev
        const next = [
          ...prev,
          {
            id: row.id,
            text: row.body,
            fromMe: row.sender_id === userId,
            ts: new Date(row.created_at).getTime(),
          },
        ].sort((a, b) => a.ts - b.ts)
        return next
      })
    })
  }, [sessionId, loadMsgs, userId])

  const chatEndsAtMs = useMemo(() => {
    if (!inSession) return null
    return new Date(inSession.chat_ends_at).getTime()
  }, [inSession])

  const secsLeftChat =
    chatEndsAtMs == null ? 0 : Math.max(0, Math.floor((chatEndsAtMs - nowTick) / 1000))
  const mm = String(Math.floor(secsLeftChat / 60)).padStart(2, '0')
  const ss = String(secsLeftChat % 60).padStart(2, '0')

  const startQueue = async () => {
    setBusy(true)
    setPollError(null)
    try {
      const res = await instantMatchPoll({ enqueue: true })
      if (res.ok) setSnapshot(res.data)
      else setPollError(res.error)
    } finally {
      setBusy(false)
    }
  }

  const leaveQueueClick = async () => {
    setBusy(true)
    await instantMatchLeaveQueue()
    const res = await instantMatchPoll({ enqueue: false })
    if (res.ok) {
      setPollError(null)
      setSnapshot(res.data)
    } else {
      setPollError(res.error)
    }
    setBusy(false)
  }

  const handleSend = async () => {
    const t = input.trim()
    if (!t || !sessionId || !inSession || inSession.phase !== 'chat') return
    setInput('')
    const res = await sendInstantSessionMessage(sessionId, t)
    if (!res.ok) {
      setPollError(res.error ?? '送出失敗')
      return
    }
    await loadMsgs(sessionId)
    setTeaserTiles((prev) => {
      const pool = Array.from({ length: 16 }, (_, i) => i).filter((i) => !prev.includes(i))
      if (!pool.length) return prev
      return [...prev, pool[Math.floor(Math.random() * pool.length)]!]
    })
  }

  const peerDisplay = peer?.nickname?.trim() || peer?.name?.trim() || '神秘對象'

  /** hooks 順序：`pollReady` 早期 return 前須宣告 */
  const teaserPhotoUrls = useMemo(
    () =>
      peer?.photo_urls?.filter(Boolean).slice(0, PUZZLE_MAX_PHOTO_SLOTS) ?? [],
    [peer?.photo_urls],
  )
  const [resolvedTeaserUrls, setResolvedTeaserUrls] = useState<string[]>([])
  useEffect(() => {
    if (!teaserPhotoUrls.length) {
      setResolvedTeaserUrls([])
      return
    }
    let cancelled = false
    void resolvePhotoUrls(teaserPhotoUrls).then((u) => {
      if (!cancelled) setResolvedTeaserUrls(u.filter(Boolean))
    })
    return () => {
      cancelled = true
    }
  }, [teaserPhotoUrls])
  const mainTeaserUrl = resolvedTeaserUrls[0]

  const pageShellClass = cn('flex min-h-0 flex-1 flex-col', snapshot?.status === 'waiting' && 'bg-slate-50')

  if (!pollReady) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-10">
          <div className="h-11 w-11 rounded-full border-2 border-slate-200 border-t-slate-800 animate-spin" />
          <p className="text-center text-xs font-medium text-slate-500">連線並鎖定即時場次…</p>
        </div>
      </div>
    )
  }

  if (!snapshot || snapshot.status === 'idle') {
    return (
      <div className={pageShellClass}>
        <InstantHeading subtitle="七分鐘隨機匿名聊天——時間到後雙方都按「加為好友」才會開通一般聊聊與完整拼圖。" />
        <div className="flex flex-1 flex-col justify-center gap-4 px-5 pb-6">
          <InstantCard>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Users className="h-8 w-8" strokeWidth={2} aria-hidden />
            </div>
            <p className="text-sm font-semibold leading-relaxed text-slate-800">
              {snapshot?.hint ??
                '請按下方「開始配對」加入等候（不會自動幫你排隊）；需另一位使用者同時在等待才會進房。'}
            </p>
          </InstantCard>
          {pollError && <p className="text-center text-xs font-medium text-red-600">{pollError}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void startQueue()}
            className="w-full rounded-2xl bg-slate-900 py-3.5 font-bold text-white disabled:opacity-50"
          >
            {busy ? '處理中…' : '開始配對'}
          </button>
        </div>
      </div>
    )
  }

  if (snapshot.status === 'waiting') {
    return (
      <div className={pageShellClass}>
        <InstantHeading subtitle="你已加入等候——離開本分頁或切到別的 App 會自動退出排隊（聊天進行中不受影响）。" />
        <div className="flex flex-1 flex-col justify-center gap-4 px-5 pb-6">
          <InstantCard className="overflow-hidden py-8">
            <MatchingPulseVisual />
            <p className="mt-6 text-xs font-medium leading-relaxed text-slate-600">
              {snapshot.hint ?? '佇列中，配對成功後會自動進入聊天室。'}
            </p>
          </InstantCard>
          {pollError && <p className="text-center text-xs font-medium text-red-600">{pollError}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void startQueue()}
            className="w-full rounded-2xl bg-slate-900 py-3.5 font-bold text-white disabled:opacity-50"
          >
            {busy ? '同步中…' : '手動同步狀態'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void leaveQueueClick()}
            className="w-full rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"
          >
            取消等待
          </button>
        </div>
      </div>
    )
  }

  if (snapshot.status === 'done') {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
          <div
            className={cn(
              'mb-5 flex h-20 w-20 items-center justify-center rounded-2xl text-white shadow-md',
              snapshot.mutual_friend ? 'bg-emerald-500' : 'bg-slate-600',
            )}
            aria-hidden
          >
            <Heart className={cn('h-10 w-10', snapshot.mutual_friend ? 'fill-current' : '')} />
          </div>
          <h2 className="mb-2 text-xl font-black tracking-tight text-slate-900">配對回合結束</h2>
          <p className="mb-8 max-w-[18rem] text-sm leading-relaxed text-slate-600">
            {snapshot.mutual_friend
              ? '對方也想當好友——已為你們建立正式配對，快到「配對」分頁開始聊天吧。'
              : '此一回合已結束。仍可隨時再次加入即時等候。'}
          </p>
          <button
            type="button"
            className="rounded-2xl bg-slate-900 px-10 py-3.5 text-sm font-bold text-white"
            onClick={() => {
              doneHoldRef.current = false
              setSnapshot(null)
              void instantMatchPoll({ enqueue: false }).then((res) => {
                if (res.ok) {
                  setPollError(null)
                  setSnapshot(res.data)
                } else {
                  setPollError(res.error)
                }
              })
            }}
          >
            我知道了
          </button>
        </div>
      </div>
    )
  }

  const sess = snapshot
  const showDecide = sess.phase === 'decide'
  const liveChat = sess.phase === 'chat'

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-3 pb-3 pt-2">
          <div className="mb-2 flex justify-center">
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200/80">
              即時聊天
            </span>
          </div>
          <div className="mb-3">
            <p className="truncate text-base font-bold text-slate-900">{peerDisplay}</p>
            <motion.div
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-100"
              animate={liveChat ? { opacity: [1, 0.72, 1] } : {}}
              transition={{ duration: 1.2, repeat: liveChat ? Infinity : 0 }}
            >
              <Timer className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
              {sess.phase === 'chat'
                ? `剩餘 ${mm}:${ss}（伺服器對時）`
                : sess.phase === 'decide'
                  ? '時間到——是否加為好友？'
                  : '本場已告一段落'}
            </motion.div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-slate-100 ring-1 ring-black/[0.04]">
            <div className="relative aspect-[16/10] w-full bg-slate-200">
              {mainTeaserUrl ? (
                <div
                  className="absolute inset-0 bg-cover bg-center transition-all duration-500"
                  style={{
                    backgroundImage: `url(${mainTeaserUrl})`,
                    filter: `blur(${Math.max(4, 20 - teaserTiles.length * 1.1)}px)`,
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-200 px-6 text-center text-[11px] font-medium leading-relaxed text-slate-600">
                  對方若尚未公開生活照，就以文字破冰；互相加好友後可到「配對」玩完整拼圖。
                </div>
              )}
              <div className="pointer-events-none absolute inset-4 grid grid-cols-4 grid-rows-4 gap-0.5 opacity-85">
                {Array.from({ length: 16 }, (_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded-sm border border-white/30',
                      teaserTiles.includes(i) ? 'bg-transparent' : 'bg-black/48',
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
          <p className="mt-2 px-1 text-[10px] leading-snug text-slate-500">
            試玩拼圖：每傳一則揭一格；正式進度在一般配對聊天使用。
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-gray-100">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50/90 px-3 py-3">
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('flex', m.fromMe ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3 py-2 text-[14px] leading-snug',
                    m.fromMe ? 'bg-emerald-500 text-white' : 'border border-gray-200 bg-white text-slate-900',
                  )}
                >
                  {m.text}
                </div>
              </motion.div>
            ))}
          </div>

          {pollError && (
            <p className="shrink-0 px-3 pb-1 text-center text-[11px] font-medium text-red-600">{pollError}</p>
          )}

          <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-2 py-2">
            <input
              value={input}
              disabled={sess.phase !== 'chat'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder={sess.phase === 'chat' ? '說點什麼…' : '聊天視窗已關閉'}
              style={{ fontSize: '16px' }}
              className="min-h-[40px] flex-1 rounded-full border border-gray-200 bg-slate-100 px-4 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-45"
            />
            <button
              type="button"
              disabled={sess.phase !== 'chat'}
              onClick={() => void handleSend()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white disabled:opacity-35"
            >
              <Send className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {showDecide && sessionId && (
          <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/55 px-4 pb-safe backdrop-blur-[3px]">
            <motion.div
              initial={{ y: 28, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="mx-auto mb-10 w-full max-w-md rounded-3xl border border-gray-200 bg-white p-6 shadow-xl ring-1 ring-black/[0.06]"
            >
              <p className="mb-1 text-center text-base font-black text-slate-900">這場七分鐘到了</p>
              <p className="mb-6 text-center text-xs leading-relaxed text-slate-500">
                只有你們兩個都選「加為好友」，才會出現在彼此的配對名單裡繼續聊。
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="w-full rounded-2xl bg-emerald-500 py-3.5 text-sm font-bold text-white"
                  onClick={() =>
                    void (async () => {
                      const res = await instantSessionDecide(sessionId, 'friend')
                      if (!res.ok) setPollError(res.error ?? '')
                      else onMutualFriendMatchCreatedRef.current?.()
                      const resPoll = await instantMatchPoll({ enqueue: false })
                      if (resPoll.ok) setSnapshot(resPoll.data)
                      else setPollError(resPoll.error)
                    })()
                  }
                >
                  加為好友
                </button>
                <button
                  type="button"
                  className="w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-bold text-slate-800"
                  onClick={() =>
                    void (async () => {
                      const res = await instantSessionDecide(sessionId, 'pass')
                      if (!res.ok) setPollError(res.error ?? '')
                      const resPoll = await instantMatchPoll({ enqueue: false })
                      if (resPoll.ok) setSnapshot(resPoll.data)
                      else setPollError(resPoll.error)
                    })()
                  }
                >
                  江湖再見
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  )
}
