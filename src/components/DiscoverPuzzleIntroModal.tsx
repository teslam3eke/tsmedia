import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import DiscoverPuzzleIntroDemo from '@/components/DiscoverPuzzleIntroDemo'

type Props = {
  open: boolean
  viewerGender: 'male' | 'female'
  /** 使用者按下底部確認後結束示意 */
  onComplete: () => void
}

/**
 * 首次進入探索：全屏 modal 包裝 {@link DiscoverPuzzleIntroDemo}。
 */
export default function DiscoverPuzzleIntroModal({ open, viewerGender, onComplete }: Props) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="discover-puzzle-intro-shell"
          className="fixed inset-0 z-[380] flex justify-center bg-white"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discover-puzzle-intro-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-white"
            initial={{ opacity: 0.96, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            <DiscoverPuzzleIntroDemo
              active={open}
              viewerGender={viewerGender}
              onComplete={onComplete}
            />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
