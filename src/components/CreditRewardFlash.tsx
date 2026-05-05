import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, Sparkles, Star, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CreditRewardVariant = 'daily' | 'grant' | 'heart_sent' | 'super_sent' | 'blur_unlock'

const VARIANT_ICON: Record<CreditRewardVariant, typeof Heart> = {
  daily: Heart,
  grant: Sparkles,
  heart_sent: Heart,
  super_sent: Star,
  blur_unlock: LayoutGrid,
}

const VARIANT_RING: Record<CreditRewardVariant, string> = {
  daily: 'from-rose-400 via-pink-500 to-fuchsia-500',
  grant: 'from-amber-400 via-orange-400 to-rose-400',
  heart_sent: 'from-rose-400 via-red-400 to-pink-500',
  super_sent: 'from-violet-400 via-indigo-500 to-sky-500',
  blur_unlock: 'from-sky-400 via-cyan-500 to-emerald-400',
}

/**
 * 全螢幕短暫獎勵提示（愛心／超喜／拼圖／每日／付費入帳）。
 * 約 2.4 秒自動關閉，點背景可略過。
 */
export function CreditRewardFlash({
  open,
  variant,
  title,
  subtitle,
  onDismiss,
}: {
  open: boolean
  variant: CreditRewardVariant
  title: string
  subtitle?: string
  onDismiss: () => void
}) {
  /** iOS／PWA：`setTimeout` 在背景凍結，auto-dismiss 永不跑 → 全螢幕 overlay 卡住所有觸控。 */
  const resumeDismissRef = useRef(false)

  useEffect(() => {
    const onVisibility = () => {
      const v = document.visibilityState
      if (open && v === 'hidden') resumeDismissRef.current = true
      if (open && v === 'visible' && resumeDismissRef.current) {
        resumeDismissRef.current = false
        onDismiss()
      }
    }
    const onPageshow = (ev: Event) => {
      if (!open) return
      const e = ev as PageTransitionEvent
      if (e.persisted) onDismiss()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageshow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageshow)
    }
  }, [open, onDismiss])

  useEffect(() => {
    if (!open) {
      resumeDismissRef.current = false
      return
    }
    const t = window.setTimeout(onDismiss, 2400)
    return () => window.clearTimeout(t)
  }, [open, onDismiss])

  const Icon = VARIANT_ICON[variant]

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="credit-reward-flash"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[420] flex items-center justify-center bg-black/45 px-5 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onDismiss}
        >
          <motion.div
            className="relative w-full max-w-[280px] overflow-hidden rounded-[1.35rem] bg-white px-5 py-7 shadow-2xl shadow-slate-900/25 ring-2 ring-white/80"
            initial={{ scale: 0.82, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              className={cn(
                'mx-auto mb-4 flex h-[76px] w-[76px] items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg ring-2 ring-white/60',
                VARIANT_RING[variant],
              )}
              initial={{ rotate: -18, scale: 0.6 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            >
              <Icon className="h-10 w-10 text-white drop-shadow-md" strokeWidth={2.2} aria-hidden />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="text-center"
            >
              <p className="text-[17px] font-black tracking-tight text-slate-900">{title}</p>
              {subtitle ? (
                <p className="mt-2 text-[13px] font-semibold leading-snug text-slate-500">{subtitle}</p>
              ) : null}
            </motion.div>
            <motion.div
              className="pointer-events-none absolute inset-0 rounded-[1.35rem] bg-gradient-to-t from-amber-400/10 via-transparent to-sky-400/10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12 }}
            />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
