/**
 * 「即時配對」七分鐘隨機房：佇列、倒數時間以 DB `chat_ends_at` 為準；
 * 決策為雙向 friend 後由 RPC 寫入 matches。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Timer, Users } from 'lucide-react'
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
      <div className="flex flex-col items-center justify-center h-full px-8 pt-safe-bar">
        <div className="w-9 h-9 rounded-full border-2 border-slate-200 border-t-slate-600 animate-spin mb-3" />
        <p className="text-xs text-slate-500 font-medium">準備即時配對…</p>
      </div>
    )
  }

  if (!snapshot || snapshot.status === 'idle') {
    return (
      <div className="flex flex-col h-full px-5 pt-safe-bar pb-6">
        <div className="pt-4 pb-2">
          <h1 className="text-[22px] font-black text-slate-900 tracking-tight">即時配對</h1>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
            七分鐘隨機匿名聊天——拼圖慢慢解鎾、時間到後雙方都按「加為好友」才算正式開通聊聊。
          </p>
        </div>
        <div className="flex-1 flex flex-col justify-center gap-4">
          <div className="rounded-3xl bg-gradient-to-br from-violet-50 to-indigo-50 ring-1 ring-violet-100 p-6 text-center space-y-2">
            <Users className="w-11 h-11 mx-auto text-violet-500" aria-hidden />
            <p className="text-sm font-bold text-slate-800">
              {snapshot?.hint ??
                '請按下方「開始配對」加入等候列（不會自動幫你排隊）；需另一位使用者同時在等待才會進房。'}
            </p>
          </div>
          {pollError && <p className="text-center text-xs text-red-600 font-medium">{pollError}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void startQueue()}
            className="w-full rounded-2xl bg-slate-900 text-white font-black py-3.5 disabled:opacity-50"
          >
            {busy ? '處理中…' : '開始配對'}
          </button>
        </div>
      </div>
    )
  }

  if (snapshot.status === 'waiting') {
    return (
      <div className="flex flex-col h-full px-5 pt-safe-bar pb-6">
        <div className="pt-4 pb-2">
          <h1 className="text-[22px] font-black text-slate-900 tracking-tight">即時配對</h1>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
            你已加入等候——系統會約每 3 秒自動同步並嘗試與另一位在線使用者配對。
          </p>
        </div>
        <div className="flex-1 flex flex-col justify-center gap-4">
          <div className="rounded-3xl bg-gradient-to-br from-violet-50 to-indigo-50 ring-1 ring-violet-100 p-6 text-center space-y-2">
            <Users className="w-11 h-11 mx-auto text-violet-500" aria-hidden />
            <p className="text-sm font-bold text-slate-800">
              {snapshot.hint ?? '佇列中，配對成功後會自動進入聊天室。'}
            </p>
          </div>
          {pollError && <p className="text-center text-xs text-red-600 font-medium">{pollError}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void startQueue()}
            className="w-full rounded-2xl bg-slate-900 text-white font-black py-3.5 disabled:opacity-50"
          >
            {busy ? '同步中…' : '排隊中（手動同步）'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void leaveQueueClick()}
            className="w-full rounded-2xl bg-slate-100 text-slate-700 font-bold py-3 text-sm"
          >
            取消等待
          </button>
        </div>
      </div>
    )
  }

  if (snapshot.status === 'done') {
    return (
      <div className="flex flex-col h-full px-6 pt-safe-bar items-center justify-center text-center">
        <p className="text-lg font-black text-slate-900 mb-2">配對已完成</p>
        <p className="text-sm text-slate-500 mb-6">
          {snapshot.mutual_friend
            ? '對方也想當好友——已為你們建立正式配對，快到「配對」分頁開始聊天吧。'
            : '此一回合已結束。'}
        </p>
        <button
          type="button"
          className="rounded-2xl bg-slate-900 text-white px-8 py-3 font-bold text-sm"
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
    )
  }

  const sess = snapshot
  const showDecide = sess.phase === 'decide'

  return (
    <div className="relative flex flex-col h-full bg-white">
      <div className="flex-shrink-0 border-b border-slate-100 px-3 pt-safe-bar pb-3">
        <div className="flex items-start gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-black text-slate-900">{peerDisplay}</p>
            <div className="flex items-center gap-1 mt-1 text-[11px] font-semibold text-amber-700">
              <Timer className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {sess.phase === 'chat'
                ? `聊天剩餘 ${mm}:${ss}（與伺服器對時）`
                : sess.phase === 'decide'
                  ? '時間到——請選擇是否加為好友'
                  : '已結束'}
            </div>
          </div>
        </div>
        <div className="rounded-2xl overflow-hidden ring-1 ring-slate-100 bg-slate-100 aspect-[16/10] relative">
          {mainTeaserUrl ? (
            <div
              className="absolute inset-0 bg-cover bg-center transition-all duration-500"
              style={{
                backgroundImage: `url(${mainTeaserUrl})`,
                filter: `blur(${Math.max(4, 20 - teaserTiles.length * 1.1)}px)`,
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[11px] text-slate-600 font-semibold px-8 text-center">
              對方若尚未曝光生活照就以文字破冰——互相加好友後可到「配對」玩完整拼圖解鎾。
            </div>
          )}
          <div className="absolute inset-4 grid grid-cols-4 grid-rows-4 gap-0.5 pointer-events-none opacity-85">
            {Array.from({ length: 16 }, (_, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-sm border border-white/25',
                  teaserTiles.includes(i) ? 'bg-transparent' : 'bg-black/48',
                )}
              />
            ))}
          </div>
        </div>
        <p className="mt-2 text-[10px] text-slate-500 leading-snug">
          試玩拼圖：每傳一則揭一格；道具與正式進度請在永久配對聊天使用。
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2 bg-slate-50/80">
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn('flex', m.fromMe ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[78%] rounded-2xl px-3 py-2 text-[14px] leading-snug',
                m.fromMe ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900 ring-1 ring-slate-100',
              )}
            >
              {m.text}
            </div>
          </motion.div>
        ))}
      </div>

      {pollError && (
        <p className="px-3 py-1 text-[11px] text-red-600 text-center shrink-0">{pollError}</p>
      )}

      <div className="flex-shrink-0 flex gap-2 items-center px-2 py-2 border-t border-slate-100 bg-white">
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
          className="flex-1 min-h-[40px] rounded-full bg-slate-100 px-4 outline-none text-[15px] disabled:opacity-50"
        />
        <button
          type="button"
          disabled={sess.phase !== 'chat'}
          onClick={() => void handleSend()}
          className="h-11 w-11 rounded-full bg-slate-900 text-white flex items-center justify-center disabled:opacity-40"
        >
          <Send className="w-[18px] h-[18px]" />
        </button>
      </div>

      {showDecide && sessionId && (
        <div className="fixed inset-0 z-40 bg-slate-950/55 flex flex-col justify-end px-4 pt-14 pb-safe">
          <div className="bg-white rounded-3xl p-6 shadow-xl max-w-md mx-auto w-full mb-10">
            <p className="text-center font-black text-slate-900 text-base mb-1">這場七分鐘到了</p>
            <p className="text-center text-xs text-slate-500 mb-6">
              只有你們兩個都選「加為好友」，才會出現在彼此的配對名單裡繼續聊。
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="w-full rounded-2xl bg-emerald-500 text-white font-black py-3.5 text-sm"
                onClick={() =>
                  void (async () => {
                    const res = await instantSessionDecide(sessionId, 'friend')
                    if (!res.ok) setPollError(res.error ?? '')
                    else onMutualFriendMatchCreated?.()
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
                className="w-full rounded-2xl bg-slate-100 text-slate-800 font-bold py-3 text-sm"
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
          </div>
        </div>
      )}
    </div>
  )
}
