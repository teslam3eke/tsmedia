import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { getProfile, resolvePhotoUrls } from '@/lib/db'

const AUTO_ENTER_MS = 2800
const PREVIEW_PHOTO_SLOTS = 3

type Props = {
  open: boolean
  peerUserId: string | null
  /** 父層已解析的第一張照片（可選，加快顯示） */
  prefetchedPhotoUrl?: string | null
  prefetchedDisplayName?: string
  onComplete: () => void
}

export default function InstantMatchIntroSplash({
  open,
  peerUserId,
  prefetchedPhotoUrl,
  prefetchedDisplayName,
  onComplete,
}: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(prefetchedPhotoUrl ?? null)
  const [displayName, setDisplayName] = useState(prefetchedDisplayName ?? '')
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const finish = () => {
    if (completedRef.current) return
    completedRef.current = true
    onCompleteRef.current()
  }

  useEffect(() => {
    if (!open) {
      completedRef.current = false
      return
    }
    const timer = window.setTimeout(finish, AUTO_ENTER_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) {
      setPhotoUrl(null)
      setDisplayName('')
      return
    }
    if (prefetchedPhotoUrl) setPhotoUrl(prefetchedPhotoUrl)
    if (prefetchedDisplayName) setDisplayName(prefetchedDisplayName)
    if (!peerUserId) return
    if (prefetchedPhotoUrl) return

    let cancelled = false
    ;(async () => {
      const p = await getProfile(peerUserId)
      if (cancelled) return
      const name = p?.nickname?.trim() || p?.name?.trim() || ''
      if (name) setDisplayName(name)
      if (prefetchedPhotoUrl) return
      const raw = (p?.photo_urls ?? []).filter(Boolean).slice(0, PREVIEW_PHOTO_SLOTS)
      if (raw.length === 0) return
      const urls = await resolvePhotoUrls(raw)
      const first = urls.filter(Boolean)[0]
      if (!cancelled && first) setPhotoUrl(first)
    })()
    return () => {
      cancelled = true
    }
  }, [open, peerUserId, prefetchedPhotoUrl, prefetchedDisplayName])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && peerUserId ? (
        <motion.button
          key="instant-match-intro"
          type="button"
          aria-label="配對成功，即將進入聊天室"
          className="fixed inset-0 z-[420] flex flex-col items-center justify-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          onClick={finish}
        >
          <motion.div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950/95 to-slate-950"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          />
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-[0.2]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 25% 35%, rgba(56,189,248,0.4), transparent 45%), radial-gradient(circle at 75% 65%, rgba(99,102,241,0.35), transparent 48%)',
            }}
          />

          <motion.div
            initial={{ scale: 0.88, y: 32, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="relative z-10 flex w-full max-w-[19rem] flex-col items-center"
          >
            <motion.div
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              className="relative mb-6"
            >
              {[0, 1].map((i) => (
                <motion.div
                  key={i}
                  className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20"
                  initial={{ opacity: 0.35, scale: 1 }}
                  animate={{ opacity: [0.35, 0], scale: [1, 1.45] }}
                  transition={{ duration: 2.2, repeat: Infinity, delay: i * 1.1, ease: 'easeOut' }}
                />
              ))}
              <div className="relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-slate-900 p-[3px] shadow-2xl shadow-black/40 ring-2 ring-white/15">
                <div className="h-full w-full overflow-hidden rounded-full bg-slate-800">
                  {photoUrl ? (
                    <motion.img
                      src={photoUrl}
                      alt=""
                      className="h-full w-full scale-[1.2] object-cover blur-2xl"
                      initial={{ opacity: 0.6 }}
                      animate={{ opacity: [0.6, 0.85, 0.7] }}
                      transition={{ duration: 2.8, ease: 'easeInOut' }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Sparkles className="h-11 w-11 text-sky-200/80" aria-hidden />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-sky-200/85">
              配對成功
            </p>
            <h2 className="mt-2 text-center text-[24px] font-black tracking-tight text-white">
              {displayName || '神秘對象'}
            </h2>
            <p className="mt-3 text-center text-xs leading-relaxed text-white/55">
              即將進入七分鐘匿名聊天
            </p>

            <div className="relative mt-8 h-1 w-full max-w-[12rem] overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-400 to-indigo-400"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: AUTO_ENTER_MS / 1000, ease: 'linear' }}
              />
            </div>
            <p className="mt-3 text-[11px] font-medium text-white/40">輕觸可略過</p>
          </motion.div>
        </motion.button>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
