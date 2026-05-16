import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Sparkles } from 'lucide-react'
import { getProfile, resolvePhotoUrls } from '@/lib/db'

const PREVIEW_PHOTO_SLOTS = 3

type Props = {
  open: boolean
  matchId: string | null
  peerUserId: string | null
  onClose: () => void
  /** Conversation id = matches.id */
  onStartChat: (matchId: string) => void
}

export default function MatchSuccessSplash({
  open,
  matchId,
  peerUserId,
  onClose,
  onStartChat,
}: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const resumeDismissRef = useRef(false)

  /** 回前景／BFCache：`open` 時全螢幕擋操作；使用者先前若遇觸控失效會永遠卡死。 */
  useEffect(() => {
    const onVis = () => {
      if (!open) return
      const v = document.visibilityState
      if (v === 'hidden') resumeDismissRef.current = true
      if (v === 'visible' && resumeDismissRef.current) {
        resumeDismissRef.current = false
        onClose()
      }
    }
    const onShow = (ev: Event) => {
      if (!open) return
      if ((ev as PageTransitionEvent).persisted) onClose()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onShow)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) resumeDismissRef.current = false
  }, [open])

  useEffect(() => {
    if (!open || !peerUserId) {
      setPhotoUrl(null)
      setDisplayName('')
      return
    }
    let cancelled = false
    ;(async () => {
      const p = await getProfile(peerUserId)
      if (cancelled) return
      const name = p?.nickname?.trim() || p?.name?.trim() || ''
      setDisplayName(name)
      const raw = (p?.photo_urls ?? []).filter(Boolean).slice(0, PREVIEW_PHOTO_SLOTS)
      if (raw.length === 0) {
        setPhotoUrl(null)
        return
      }
      const urls = await resolvePhotoUrls(raw)
      const first = urls.filter(Boolean)[0]
      if (!cancelled) setPhotoUrl(first ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [open, peerUserId])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && peerUserId && matchId ? (
        <motion.div
          key="match-splash"
          className="fixed inset-0 z-[420] flex flex-col items-center justify-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-slate-950 via-violet-950/95 to-slate-950"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          />
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 30%, rgba(251,191,36,0.45), transparent 42%), radial-gradient(circle at 80% 70%, rgba(99,102,241,0.4), transparent 45%)',
            }}
          />

          <motion.div
            initial={{ scale: 0.85, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="relative z-10 flex w-full max-w-[20rem] flex-col items-center rounded-[2rem] bg-white/[0.07] px-6 pb-8 pt-10 shadow-2xl shadow-black/40 ring-1 ring-white/15 backdrop-blur-xl"
          >
            <motion.div
              animate={{ rotate: [0, -6, 6, -4, 4, 0] }}
              transition={{ duration: 1.2, ease: 'easeInOut' }}
              className="mb-4 inline-flex rounded-full bg-gradient-to-br from-amber-300 via-rose-400 to-indigo-400 p-[3px] shadow-lg shadow-amber-500/25"
            >
              <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-slate-900 ring-2 ring-white/20">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt=""
                    className="h-full w-full scale-[1.15] object-cover blur-xl"
                  />
                ) : (
                  <Sparkles className="h-12 w-12 text-amber-200/90" />
                )}
              </div>
            </motion.div>

            <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-amber-200/90">
              It&apos;s a Match
            </p>
            <h2 className="mt-2 text-center text-[26px] font-black tracking-tight text-white">
              配對成功
            </h2>
            {displayName ? (
              <p className="mt-2 text-center text-sm font-semibold text-white/85">{displayName}</p>
            ) : (
              <p className="mt-2 h-5 w-32 animate-pulse rounded-lg bg-white/10" aria-hidden />
            )}

            <p className="mt-3 text-center text-xs leading-relaxed text-white/55">
              雙方互相喜歡 · 現在可以開始聊天認識彼此
            </p>

            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-[15px] font-bold text-slate-900 shadow-xl shadow-black/25 ring-1 ring-white/40 transition hover:bg-slate-50"
              onClick={() => onStartChat(matchId)}
            >
              <MessageCircle className="h-5 w-5" />
              開始聊天
            </motion.button>

            <button
              type="button"
              className="mt-4 text-xs font-semibold text-white/45 underline-offset-4 hover:text-white/75 hover:underline"
              onClick={onClose}
            >
              稍後再說
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
