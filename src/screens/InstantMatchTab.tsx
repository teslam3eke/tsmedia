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
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { Heart, Send, Timer, Users, DoorOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProfileRow } from '@/lib/types'
import {
  instantMatchPoll,
  instantMatchLeaveQueue,
  instantMatchLeaveQueueKeepalive,
  instantSessionAbandon,
  instantSessionAbandonKeepalive,
  getInstantSessionMessages,
  sendInstantSessionMessage,
  instantSessionDecide,
  subscribeToInstantSessionMessages,
  subscribeToInstantSessionSignals,
  getProfile,
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

/** 「我知道了」後 DB 仍會回傳同場次的 done——略過並顯示 idle，避免馬上跳出結束頁 */
function applyDismissedSessionFilter(
  data: InstantMatchPollResult,
  dismissedIds: ReadonlySet<string>,
): InstantMatchPollResult {
  if (data.status !== 'done') return data
  if (!data.session_id || !dismissedIds.has(data.session_id)) return data
  return {
    status: 'idle',
    hint: '尚未加入等候。點「開始配對」加入；需同時有另一位使用者也在等候才會開房。',
  }
}

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

/** 離開本分頁、切 App 或強制關閉：waiting → leave_queue；in_session → abandon（對方顯示對方已離開）。 */
function useInstantTabLifecycleExit(
  snapshot: InstantMatchPollResult | null,
  setSnapshot: Dispatch<SetStateAction<InstantMatchPollResult | null>>,
  doneHoldRef: MutableRefObject<boolean>,
) {
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  useEffect(() => {
    const flushQueueIfWaiting = async () => {
      if (snapshotRef.current?.status !== 'waiting') return
      instantMatchLeaveQueueKeepalive()
      await instantMatchLeaveQueue()
      const res = await instantMatchPoll({ enqueue: false })
      if (res.ok && res.data.status !== 'done') setSnapshot(res.data)
    }

    const abandonSessionIfActive = async () => {
      const s = snapshotRef.current
      if (s?.status !== 'in_session') return
      const sid = s.session_id
      instantSessionAbandonKeepalive(sid)
      await instantSessionAbandon(sid)
      const res = await instantMatchPoll({ enqueue: false })
      if (!res.ok) return
      const r = res.data
      setSnapshot((prev) => {
        if (prev?.status === 'done') return prev
        if (r.status === 'done') doneHoldRef.current = true
        return r
      })
    }

    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return
      void flushQueueIfWaiting()
      void abandonSessionIfActive()
    }

    const onPageHide = () => {
      void flushQueueIfWaiting()
      void abandonSessionIfActive()
    }

    const onBeforeUnload = () => {
      const st = snapshotRef.current
      if (st?.status === 'waiting') instantMatchLeaveQueueKeepalive()
      if (st?.status === 'in_session') instantSessionAbandonKeepalive(st.session_id)
    }

    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      const st = snapshotRef.current
      if (st?.status === 'waiting') {
        instantMatchLeaveQueueKeepalive()
        void instantMatchLeaveQueue()
      } else if (st?.status === 'in_session') {
        instantSessionAbandonKeepalive(st.session_id)
        void instantSessionAbandon(st.session_id)
      }
    }
  }, [doneHoldRef, setSnapshot])
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
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [pollReady, setPollReady] = useState(false)

  const doneHoldRef = useRef(false)
  /** 使用者已對該场次按「我知道了」——後續 poll 仍會帶舊 done，過濾成 idle */
  const dismissedInstantSessionIdsRef = useRef<Set<string>>(new Set())

  const ingestPollOk = useCallback((raw: InstantMatchPollResult) => {
    const data = applyDismissedSessionFilter(raw, dismissedInstantSessionIdsRef.current)
    setPollError(null)
    setSnapshot((prev) => {
      if (
        prev?.status === 'done' &&
        data.status === 'done' &&
        prev.session_id === data.session_id
      ) {
        return prev
      }
      if (data.status === 'done' && data.mutual_friend) onMutualFriendMatchCreatedRef.current?.()
      if (data.status === 'done') doneHoldRef.current = true
      else doneHoldRef.current = false
      return data
    })
  }, [])

  useEffect(() => {
    const waiting = !!(pollReady && snapshot?.status === 'waiting')
    onWaitingStateChange?.(waiting)
  }, [pollReady, snapshot, onWaitingStateChange])

  useEffect(() => {
    return () => {
      onWaitingStateChange?.(false)
    }
  }, [onWaitingStateChange])

  useInstantTabLifecycleExit(snapshot, setSnapshot, doneHoldRef)

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

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
      ingestPollOk(res.data)
    }
    void poke()
    const id = window.setInterval(poke, 3200)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [userId, foregroundReloadNonce, ingestPollOk])

  const pullInstantPoll = useCallback(async () => {
    if (doneHoldRef.current) return
    const res = await instantMatchPoll({ enqueue: false })
    setPollReady(true)
    if (!res.ok) {
      setPollError(res.error)
      return
    }
    ingestPollOk(res.data)
  }, [ingestPollOk])

  useEffect(() => {
    setSnapshot(null)
    setPeer(null)
    setMessages([])
    setPollError(null)
    setPollReady(false)
    doneHoldRef.current = false
    dismissedInstantSessionIdsRef.current.clear()
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

  useEffect(() => {
    if (!sessionId || snapshot?.status !== 'in_session') return
    return subscribeToInstantSessionSignals(sessionId, () => {
      void pullInstantPoll()
    })
  }, [sessionId, snapshot?.status, pullInstantPoll])

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
      if (res.ok)
        setSnapshot(applyDismissedSessionFilter(res.data, dismissedInstantSessionIdsRef.current))
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
      setSnapshot(applyDismissedSessionFilter(res.data, dismissedInstantSessionIdsRef.current))
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
  }

  const confirmLeaveInstantChat = async () => {
    const sid = sessionId
    if (!sid || snapshot?.status !== 'in_session') return
    if (
      !window.confirm(
        '確定離開聊天室？離開後此場會結束，對方將看到「對方已離開聊天室」。',
      )
    ) {
      return
    }
    setBusy(true)
    instantSessionAbandonKeepalive(sid)
    const ab = await instantSessionAbandon(sid)
    if (!ab.ok) setPollError(ab.error ?? '離開失敗')
    const res = await instantMatchPoll({ enqueue: false })
    if (res.ok) ingestPollOk(res.data)
    else setPollError(res.error)
    setBusy(false)
  }

  const peerDisplay = peer?.nickname?.trim() || peer?.name?.trim() || '神秘對象'

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
        <InstantHeading subtitle="你已加入等候；離開本分頁、切換 App 或關閉程式會自動退出排隊並取消等候。" />
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
    const peerEnd = snapshot.instant_end_reason === 'peer_left'
    const selfEnd = snapshot.instant_end_reason === 'self_left'
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
          <div
            className={cn(
              'mb-5 flex h-20 w-20 items-center justify-center rounded-2xl text-white shadow-md',
              snapshot.mutual_friend ? 'bg-emerald-500' : peerEnd ? 'bg-amber-600' : 'bg-slate-600',
            )}
            aria-hidden
          >
            <Heart className={cn('h-10 w-10', snapshot.mutual_friend ? 'fill-current' : '')} />
          </div>
          <h2 className="mb-2 text-xl font-black tracking-tight text-slate-900">
            {snapshot.mutual_friend
              ? '配對成功'
              : peerEnd
                ? '對方已離開聊天室'
                : selfEnd
                  ? '你已離開聊天室'
                  : '配對回合結束'}
          </h2>
          <p className="mb-8 max-w-[18rem] text-sm leading-relaxed text-slate-600">
            {snapshot.mutual_friend
              ? '對方也想當好友——已為你們建立正式配對，快到「配對」分頁開始聊天吧。'
              : peerEnd
                ? '對方已關閉或離開聊天。此場即時對話已結束，你仍可隨時再次加入等候。'
                : selfEnd
                  ? '你已離開此場對話。仍可隨時再次加入即時配對等候。'
                  : '此一回合已結束。仍可隨時再次加入即時等候。'}
          </p>
          <button
            type="button"
            className="rounded-2xl bg-slate-900 px-10 py-3.5 text-sm font-bold text-white"
            onClick={() => {
              dismissedInstantSessionIdsRef.current.add(snapshot.session_id)
              doneHoldRef.current = false
              setSnapshot(null)
              void instantMatchPoll({ enqueue: false }).then((res) => {
                if (res.ok) {
                  setPollError(null)
                  const next = applyDismissedSessionFilter(
                    res.data,
                    dismissedInstantSessionIdsRef.current,
                  )
                  setSnapshot(next)
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
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-3 pb-2.5 pt-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200/80">
                  即時聊天
                </span>
                <motion.div
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-100"
                  animate={liveChat ? { opacity: [1, 0.75, 1] } : {}}
                  transition={{ duration: 1.2, repeat: liveChat ? Infinity : 0 }}
                >
                  <Timer className="h-3 w-3 shrink-0 text-amber-700" aria-hidden />
                  {sess.phase === 'chat'
                    ? `剩餘 ${mm}:${ss}`
                    : sess.phase === 'decide'
                      ? '選擇是否加好友'
                      : '已結束'}
                </motion.div>
              </div>
              <p className="mt-1 truncate text-base font-bold text-slate-900">{peerDisplay}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                七分鐘匿名文字聊天；時間到後可加好友，之後在「配對」繼續聊與完整拼圖。
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmLeaveInstantChat()}
              className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-800 shadow-sm disabled:opacity-50"
            >
              <DoorOpen className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
              離開
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {messages.length === 0 && liveChat && (
              <p className="rounded-2xl border border-dashed border-gray-200 bg-white/80 px-4 py-6 text-center text-xs leading-relaxed text-slate-500">
                還沒有訊息，打個招呼吧。雙方若以文字聊得來，時間到後可按「加為好友」到配對裡繼續。
              </p>
            )}
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('flex', m.fromMe ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[82%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug',
                    m.fromMe ? 'bg-emerald-500 text-white' : 'border border-gray-200 bg-white text-slate-900 shadow-sm',
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

          <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-2 py-2 pb-safe">
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
              placeholder={sess.phase === 'chat' ? '說點什麼…' : '聊天已關閉'}
              style={{ fontSize: '16px' }}
              className="min-h-[40px] flex-1 rounded-full border border-gray-200 bg-slate-50 px-4 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-45"
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

        {showDecide &&
          sessionId &&
          createPortal(
            <div
              className="fixed inset-0 z-[350] flex flex-col justify-end bg-black/55 px-4 backdrop-blur-[3px]"
              role="presentation"
              style={{
                /* 與 MainScreen 底欄 `h-[60px]` + `env(safe-area-inset-bottom)` 對齊，避免按鈕被蓋住 */
                paddingBottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + 14px)',
                paddingTop: 'max(1.5rem, env(safe-area-inset-top, 0px))',
              }}
            >
              <motion.div
                initial={{ y: 28, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                className="mx-auto w-full max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-xl ring-1 ring-black/[0.06]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="instant-decide-title"
              >
                <p id="instant-decide-title" className="mb-1 text-center text-base font-black text-slate-900">
                  時間結束，下一步？
                </p>
                <p className="mb-5 text-center text-xs leading-relaxed text-slate-500">
                  只有雙方都選「加為好友」，才會出現在彼此的配對名單裡繼續聊天。
                </p>
                <div className="flex flex-col gap-2.5">
                  <button
                    type="button"
                    className="w-full rounded-2xl bg-emerald-500 py-3.5 text-sm font-bold text-white"
                    onClick={() =>
                      void (async () => {
                        const res = await instantSessionDecide(sessionId, 'friend')
                        if (!res.ok) setPollError(res.error ?? '')
                        const resPoll = await instantMatchPoll({ enqueue: false })
                        if (resPoll.ok) ingestPollOk(resPoll.data)
                        else setPollError(resPoll.error)
                      })()
                    }
                  >
                    加為好友
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-2xl border border-gray-200 bg-white py-3.5 text-sm font-bold text-slate-800"
                    onClick={() =>
                      void (async () => {
                        const res = await instantSessionDecide(sessionId, 'pass')
                        if (!res.ok) setPollError(res.error ?? '')
                        const resPoll = await instantMatchPoll({ enqueue: false })
                        if (resPoll.ok) ingestPollOk(resPoll.data)
                        else setPollError(resPoll.error)
                      })()
                    }
                  >
                    不加好友
                  </button>
                </div>
              </motion.div>
            </div>,
            document.body,
          )}
      </div>
    </div>
  )
}
