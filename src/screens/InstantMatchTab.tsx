/**
 * 「即時配對」七分鐘隨機房：佇列、倒數時間以 DB `chat_ends_at` 為準；
 * 決策為雙向 friend 後由 RPC 寫入 matches。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Heart, Send, Sparkles, Timer, Users } from 'lucide-react'
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
}

type UiMsg = { id: string; text: string; fromMe: boolean; ts: number }

type AmbientVibe = 'idle' | 'waiting' | 'live' | 'done'

/** 動態氛圍背景（限本元件內）；不對 document／全域 scroll 做任何手腳（iOS 規則） */
function InstantAmbientBackdrop({ vibe }: { vibe: AmbientVibe }) {
  const fast = vibe === 'waiting' || vibe === 'live'
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-b from-indigo-50/90 via-white to-fuchsia-50/50" />
      <motion.div
        className="absolute -left-[22%] -top-[16%] h-[52%] w-[52%] rounded-full bg-violet-500/30 blur-[64px]"
        animate={{ x: [0, 32, -6, 0], y: [0, 22, -8, 0], scale: [1, 1.14, 1.06, 1], opacity: [0.52, 0.78, 0.62, 0.52] }}
        transition={{ duration: fast ? 5.8 : 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-[24%] -right-[12%] h-[58%] w-[58%] rounded-full bg-fuchsia-500/25 blur-[68px]"
        animate={{ x: [0, -26, 8, 0], y: [0, -30, 6, 0], scale: [1, 1.1, 1.07, 1], opacity: [0.45, 0.72, 0.52, 0.45] }}
        transition={{ duration: fast ? 6.8 : 12, repeat: Infinity, ease: 'easeInOut', delay: 0.45 }}
      />
      <motion.div
        className="absolute left-1/2 top-[30%] h-[42%] w-[42%] -translate-x-1/2 rounded-full bg-indigo-400/18 blur-[56px]"
        animate={{ rotate: [0, 360], scale: [1, 1.06, 1] }}
        transition={{ rotate: { duration: fast ? 70 : 120, repeat: Infinity, ease: 'linear' }, scale: { duration: 8, repeat: Infinity } }}
      />
      {vibe === 'live' && (
        <motion.div
          className="absolute right-[4%] top-[6%] h-[34%] w-[34%] rounded-full bg-amber-300/28 blur-[48px]"
          animate={{ opacity: [0.15, 0.52, 0.2], scale: [1, 1.25, 1] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {vibe === 'done' && (
        <motion.div
          className="absolute left-[10%] top-[52%] h-[40%] w-[46%] rounded-full bg-emerald-400/20 blur-[56px]"
          animate={{ opacity: [0.2, 0.45, 0.22], scale: [1, 1.12, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <div
        className="absolute inset-0 opacity-[0.065]"
        style={{
          backgroundImage: `radial-gradient(circle at 1.5px 1.5px, rgb(100 116 139) 1px, transparent 0)`,
          backgroundSize: '22px 22px',
        }}
      />
    </div>
  )
}

function InstantGlamSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className={cn(
        'relative overflow-hidden rounded-[1.35rem] border border-white/70 bg-white/75 shadow-[0_20px_50px_-20px_rgba(109,40,217,0.35)] backdrop-blur-md',
        className,
      )}
    >
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_0%,rgba(255,255,255,0.52)_48%,transparent_92%)]"
        initial={{ x: '-130%' }}
        animate={{ x: '130%' }}
        transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 4.2, ease: 'easeInOut' }}
      />
      <div className="relative z-[1]">{children}</div>
    </motion.div>
  )
}

function InstantBadge({ pulse }: { pulse?: boolean }) {
  return (
    <motion.div
      className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-3 py-1 text-[10px] font-bold tracking-wide text-white shadow-lg shadow-violet-600/35"
      animate={pulse ? { scale: [1, 1.035, 1], boxShadow: ['0 8px 24px rgb(139 92 246 / .35)', '0 10px 32px rgb(217 70 239 / .45)', '0 8px 24px rgb(139 92 246 / .35)'] } : {}}
      transition={{ duration: 2, repeat: pulse ? Infinity : 0 }}
    >
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
      即時
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
    </motion.div>
  )
}

function InstantPageShell({ vibe, children }: { vibe: AmbientVibe; children: ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <InstantAmbientBackdrop vibe={vibe} />
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

function InstantHeading({
  eyebrow,
  title = '即時配對',
  subtitle,
}: {
  eyebrow?: string
  title?: string
  subtitle: string
}) {
  return (
    <header className="px-5 pb-2 pt-2">
      {eyebrow ? (
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-500/90">{eyebrow}</p>
      ) : null}
      <motion.h1
        className="bg-gradient-to-r from-violet-700 via-fuchsia-600 to-indigo-700 bg-clip-text text-[1.375rem] font-black tracking-tight text-transparent sm:text-[1.55rem]"
        animate={{ opacity: [0.9, 1, 0.9] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        {title}
      </motion.h1>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{subtitle}</p>
    </header>
  )
}

export default function InstantMatchTab({
  userId,
  foregroundReloadNonce,
  onMutualFriendMatchCreated,
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

  /** 必須在 `pollReady` 早期 return 之前宣告：否則 poll 完成後 hooks 數量變化會違反 Rules of Hooks（畫面空白／崩潰）。 */
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

  if (!pollReady) {
    return (
      <InstantPageShell vibe="idle">
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-10">
          <motion.div
            className="h-14 w-14 rounded-full border-[3px] border-violet-200 border-t-violet-600 shadow-lg shadow-violet-500/25"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-center text-xs font-semibold text-slate-600">連線並鎖定即時場次…</p>
        </div>
      </InstantPageShell>
    )
  }

  if (!snapshot || snapshot.status === 'idle') {
    return (
      <InstantPageShell vibe="idle">
        <InstantHeading
          eyebrow="Seven-minute room"
          subtitle="七分鐘隨機匿名聊天——時間到後雙方都按「加為好友」才會開通一般聊聊與完整拼圖。"
        />
        <div className="flex flex-1 flex-col justify-center gap-4 px-5 pb-6">
          <InstantGlamSurface className="p-7 text-center">
            <motion.div
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-500 text-white shadow-lg shadow-violet-600/40"
              animate={{ y: [0, -6, 0], rotate: [0, -4, 4, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              aria-hidden
            >
              <Users className="h-8 w-8 text-white/95" strokeWidth={2.25} />
            </motion.div>
            <p className="text-sm font-bold leading-relaxed text-slate-800">
              {snapshot?.hint ??
                '請按下方「開始配對」加入等候（不會自動幫你排隊）；需另一位使用者同時在等待才會進房。'}
            </p>
          </InstantGlamSurface>
          {pollError && <p className="text-center text-xs font-medium text-red-600">{pollError}</p>}
          <motion.button
            type="button"
            disabled={busy}
            onClick={() => void startQueue()}
            whileTap={{ scale: busy ? 1 : 0.98 }}
            className="w-full rounded-2xl bg-gradient-to-r from-violet-700 via-violet-600 to-fuchsia-600 py-3.5 font-black text-white shadow-lg shadow-violet-700/35 disabled:opacity-50"
          >
            {busy ? '處理中…' : '開始配對'}
          </motion.button>
        </div>
      </InstantPageShell>
    )
  }

  if (snapshot.status === 'waiting') {
    return (
      <InstantPageShell vibe="waiting">
        <InstantHeading
          eyebrow="Matching"
          subtitle="你已加入等候——系統會約每 3 秒自動同步，並撮合另一位在線使用者。"
        />
        <div className="flex flex-1 flex-col justify-center gap-4 px-5 pb-6">
          <InstantGlamSurface className="p-7 text-center">
            <motion.div
              className="relative mx-auto mb-5 h-[4.75rem] w-[4.75rem]"
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              aria-hidden
            >
              <motion.span
                className="absolute inset-0 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 opacity-40 blur-md"
                animate={{ scale: [0.94, 1.12, 0.94], opacity: [0.35, 0.62, 0.35] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <div className="relative flex h-full w-full items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-xl shadow-fuchsia-500/35">
                <Users className="h-9 w-9" strokeWidth={2.25} />
              </div>
            </motion.div>
            <p className="text-sm font-bold leading-relaxed text-slate-800">
              {snapshot.hint ?? '佇列中，配對成功後會自動進入聊天室。'}
            </p>
          </InstantGlamSurface>
          {pollError && <p className="text-center text-xs font-medium text-red-600">{pollError}</p>}
          <motion.button
            type="button"
            disabled={busy}
            onClick={() => void startQueue()}
            whileTap={{ scale: busy ? 1 : 0.98 }}
            className="w-full rounded-2xl bg-gradient-to-r from-violet-700 via-fuchsia-600 to-indigo-600 py-3.5 font-black text-white shadow-lg shadow-indigo-600/35 disabled:opacity-50"
          >
            {busy ? '同步中…' : '排隊中（手動同步）'}
          </motion.button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void leaveQueueClick()}
            className="w-full rounded-2xl border border-white/80 bg-white/70 py-3 text-sm font-bold text-slate-700 backdrop-blur-sm shadow-inner shadow-white/80 disabled:opacity-50"
          >
            取消等待
          </button>
        </div>
      </InstantPageShell>
    )
  }

  if (snapshot.status === 'done') {
    return (
      <InstantPageShell vibe="done">
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
          <motion.div
            initial={{ scale: 0.55, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 280, damping: 20 }}
            className={cn(
              'mb-5 flex h-24 w-24 items-center justify-center rounded-[1.85rem] text-white shadow-2xl',
              snapshot.mutual_friend
                ? 'bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-500 shadow-emerald-500/35'
                : 'bg-gradient-to-br from-slate-500 to-slate-700 shadow-slate-600/35',
            )}
            aria-hidden
          >
            <Heart className={cn('h-12 w-12', snapshot.mutual_friend ? 'fill-current' : '')} />
          </motion.div>
          <h2 className="mb-2 text-xl font-black tracking-tight text-slate-900">配對回合結束</h2>
          <p className="mb-8 max-w-[18rem] text-sm leading-relaxed text-slate-600">
            {snapshot.mutual_friend
              ? '對方也想當好友——已為你們建立正式配對，快到「配對」分頁開始聊天吧。'
              : '此一回合已結束。仍可隨時再次加入即時等候。'}
          </p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            className="rounded-2xl bg-gradient-to-r from-slate-900 to-violet-900 px-10 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-900/30"
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
          </motion.button>
        </div>
      </InstantPageShell>
    )
  }

  const sess = snapshot
  const showDecide = sess.phase === 'decide'
  const glamChat = sess.phase === 'chat'

  return (
    <InstantPageShell vibe="live">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex-shrink-0 border-b border-violet-200/40 bg-white/55 px-3 pb-3 pt-1 backdrop-blur-md">
          <div className="mb-2 flex justify-center">
            <InstantBadge pulse={glamChat} />
          </div>
          <div className="mb-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <motion.p
                className="truncate bg-gradient-to-r from-violet-900 via-fuchsia-800 to-indigo-900 bg-clip-text text-base font-black text-transparent"
                animate={glamChat ? { opacity: [0.92, 1, 0.92] } : {}}
                transition={{ duration: 3.2, repeat: glamChat ? Infinity : 0 }}
              >
                {peerDisplay}
              </motion.p>
              <motion.div
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-100 via-orange-50 to-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-950 ring-1 ring-amber-200/80"
                animate={
                  glamChat ? { scale: [1, 1.035, 1], boxShadow: ['0 0 0 0 rgba(251,146,60,0)', '0 0 18px 2px rgba(251,146,60,0.18)', '0 0 0 0 rgba(251,146,60,0)'] } : {}
                }
                transition={{ duration: 2.4, repeat: glamChat ? Infinity : 0, ease: 'easeInOut' }}
              >
                <Timer className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
                {sess.phase === 'chat'
                  ? `剩餘 ${mm}:${ss}（伺服器對時）`
                  : sess.phase === 'decide'
                    ? '時間到——是否加為好友？'
                    : '本場已告一段落'}
              </motion.div>
            </div>
          </div>

          <InstantGlamSurface className="overflow-hidden rounded-2xl p-0 shadow-2xl shadow-violet-600/25">
            <div className="relative aspect-[16/10] w-full bg-slate-900/90">
              <motion.div
                className="absolute inset-0 bg-[conic-gradient(from_180deg_at_50%_50%,rgba(139,92,246,0.35),transparent,rgba(236,72,153,0.28),transparent)]"
                animate={{ rotate: [0, 360] }}
                transition={{
                  duration: glamChat ? 16 : 22,
                  repeat: Infinity,
                  ease: 'linear',
                }}
              />
              {mainTeaserUrl ? (
                <motion.div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${mainTeaserUrl})`,
                    filter: `blur(${Math.max(4, 22 - teaserTiles.length * 1.15)}px)`,
                  }}
                  animate={glamChat ? { scale: [1, 1.048, 1] } : { scale: [1, 1.025, 1] }}
                  transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
                />
              ) : (
                <motion.div
                  className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-violet-900/85 via-indigo-900/80 to-fuchsia-900/75 px-6 text-center text-[11px] font-semibold leading-relaxed text-violet-100"
                  animate={{ opacity: [0.88, 1, 0.92] }}
                  transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  對方若尚未公開生活照，就用文字破冰吧——互相加好友後可到「配對」解完整拼圖。
                </motion.div>
              )}
              <div className="absolute inset-4 grid grid-cols-4 grid-rows-4 gap-0.5 pointer-events-none opacity-90">
                {Array.from({ length: 16 }, (_, i) => (
                  <motion.div
                    key={i}
                    className={cn(
                      'rounded-sm border border-white/35',
                      teaserTiles.includes(i) ? 'bg-transparent' : 'bg-black/52',
                    )}
                    animate={
                      teaserTiles.includes(i)
                        ? { opacity: 0.06 }
                        : { opacity: [0.74, 0.92, 0.74] }
                    }
                    transition={
                      teaserTiles.includes(i)
                        ? { duration: 0.35 }
                        : { duration: 2.25 + i * 0.04, repeat: Infinity, ease: 'easeInOut' }
                    }
                  />
                ))}
              </div>
            </div>
          </InstantGlamSurface>
          <p className="mt-2 px-1 text-[10px] font-medium leading-snug text-slate-600/90">
            試玩拼圖：每傳一則揭一格；正式道具與永久進度在一般配對聊天裡。
          </p>
        </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-white/30">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 backdrop-blur-[2px]">
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn('flex', m.fromMe ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[82%] rounded-2xl px-3 py-2.5 text-[14px] leading-snug shadow-md',
                  m.fromMe
                    ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-600/25'
                    : 'border border-violet-100/90 bg-white/95 text-slate-900 shadow-violet-500/15 ring-1 ring-violet-200/70',
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

        <div className="flex shrink-0 items-center gap-2 border-t border-violet-200/35 bg-white/70 px-2 py-2.5 backdrop-blur-md supports-[backdrop-filter]:bg-white/55">
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
          className="min-h-[40px] flex-1 rounded-full border border-violet-100/90 bg-white/90 px-4 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-45"
        />
        <motion.button
          type="button"
          disabled={sess.phase !== 'chat'}
          onClick={() => void handleSend()}
          whileTap={{ scale: sess.phase === 'chat' ? 0.92 : 1 }}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-700 to-fuchsia-600 text-white shadow-lg shadow-violet-600/35 disabled:opacity-35"
        >
          <Send className="h-[18px] w-[18px]" />
        </motion.button>
      </div>
      </div>

      {showDecide && sessionId && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-gradient-to-t from-slate-950/80 via-violet-950/45 to-fuchsia-900/35 px-4 pb-safe backdrop-blur-sm">
          <motion.div
            initial={{ y: 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="mx-auto mb-10 w-full max-w-md rounded-3xl border border-white/55 bg-white/95 p-6 shadow-[0_28px_80px_-28px_rgba(91,33,182,0.55)] backdrop-blur-md"
          >
            <p className="mb-1 text-center text-base font-black text-transparent bg-gradient-to-r from-violet-800 to-fuchsia-700 bg-clip-text">
              這場七分鐘到了
            </p>
            <p className="mb-7 text-center text-xs leading-relaxed text-slate-600">
              只有你們兩個都選「加為好友」，才會出現在彼此的配對名單裡繼續聊。
            </p>
            <div className="flex flex-col gap-2.5">
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5 text-sm font-black text-white shadow-lg shadow-emerald-600/35"
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
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                className="w-full rounded-2xl border border-slate-200/95 bg-white py-3 text-sm font-bold text-slate-800 shadow-inner shadow-slate-100"
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
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
    </InstantPageShell>
  )
}
