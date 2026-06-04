import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { shouldWarnIosNonSafariBrowser } from '@/lib/authBrowser'
import IosOpenInSafariActions from '@/components/IosOpenInSafariActions'

/**
 * 每次載入（冷啟／重新整理）若為 iOS 非 Safari，顯示警示。
 * 關閉僅隱藏至下次整頁載入，不寫入 localStorage。
 */
export default function IosNonSafariLaunchWarning() {
  const [visible, setVisible] = useState(() => shouldWarnIosNonSafariBrowser())

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="ios-non-safari-warn"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99999] flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-950/45"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ios-non-safari-warn-title"
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl ring-1 ring-slate-200"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-100">
                <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="ios-non-safari-warn-title" className="text-base font-black text-slate-950">
                  請改用 Safari 或主畫面 App
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  你目前不是用 Safari 開啟 tsMedia。在 iPhone 上，Chrome 等瀏覽器可能無法完成信箱驗證、推播與部分功能。
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  建議：Safari 開啟 tsmedia.tw 並「加入主畫面」，之後從主畫面圖示進入；或在「設定 → App → 預設瀏覽器 App」改回 Safari。
                </p>
                <IosOpenInSafariActions
                  className="mt-4"
                  tryLabel="嘗試用 Safari 開啟 tsMedia"
                />
              </div>
              <button
                type="button"
                onClick={() => setVisible(false)}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
                aria-label="關閉"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="mt-4 w-full rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white"
            >
              我知道了
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
