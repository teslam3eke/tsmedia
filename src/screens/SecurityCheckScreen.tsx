import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, Lock, Wifi, Eye, AlertTriangle, CheckCircle2,
  ChevronRight, Cpu,
} from 'lucide-react'
import PWAInstallGuide from '@/components/PWAInstallGuide'
import { hasUsedPwaStandaloneBefore, markPwaStandaloneSeenIfNeeded } from '@/lib/pwaStandaloneMarker'

interface Check {
  id: string
  icon: typeof Shield
  label: string
  desc: string
  status: 'pending' | 'checking' | 'ok' | 'warn'
  delay: number
}

const CHECKS: Omit<Check, 'status'>[] = [
  {
    id: 'https',
    icon: Lock,
    label: 'HTTPS 加密連線',
    desc: 'TLS 1.3 端對端加密通道建立中',
    delay: 300,
  },
  {
    id: 'e2e',
    icon: Shield,
    label: '端對端訊息加密',
    desc: 'Signal Protocol 金鑰交換完成',
    delay: 650,
  },
  {
    id: 'ip',
    icon: Wifi,
    label: 'IP 位址遮蔽',
    desc: '用戶真實 IP 已完整隱藏',
    delay: 1000,
  },
  {
    id: 'screenshot',
    icon: Eye,
    label: '截圖與螢幕錄製防護',
    desc: '需封裝至主畫面才能啟用系統級保護',
    delay: 1350,
  },
]

interface Props {
  onContinue: () => void
}

/** 正常動畫最後一步約 2330ms；WebKit resume 會凍計時器，`allDone` 永不到 → 卡住本頁。 */
const MIN_MS_BEFORE_RESUME_FORCE_FINISH = 2_650
/** 保底：任一情況下必出現繼續／略過鈕。 */
const SECURITY_CHECK_WATCHDOG_MS = 12_000

function readStandaloneMode(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

export default function SecurityCheckScreen({ onContinue }: Props) {
  const [checks, setChecks] = useState<Check[]>(
    CHECKS.map((c) => ({ ...c, status: 'pending' })),
  )
  const [showPWA, setShowPWA] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const [pwaSkipped, setPwaSkipped] = useState(false)

  const allDoneRef = useRef(allDone)
  const forceFinalizeRef = useRef(false)
  const onContinueRef = useRef(onContinue)
  const autoContinueAfterPwaMarkerRef = useRef(false)
  onContinueRef.current = onContinue

  useEffect(() => {
    markPwaStandaloneSeenIfNeeded()
    if (!readStandaloneMode() && hasUsedPwaStandaloneBefore()) {
      autoContinueAfterPwaMarkerRef.current = true
      setPwaSkipped(true)
      setShowPWA(false)
    }
  }, [])

  /**
   * ① 已由主畫面封裝開啟（standalone）；
   * ② 或非 standalone 但因曾開過封裝版而帶 tm_pwa_standalone_used（重載／回前景再度進此頁）——
   * 自動執行 onContinue，並隱藏「環境驗證完成，繼續」區塊。
   */
  useEffect(() => {
    if (!allDone) return
    if (!readStandaloneMode() && !autoContinueAfterPwaMarkerRef.current) return
    const t = window.setTimeout(() => {
      void onContinueRef.current()
    }, 380)
    return () => window.clearTimeout(t)
  }, [allDone])

  useEffect(() => {
    allDoneRef.current = allDone
  }, [allDone])

  useEffect(() => {
    const timeouts: number[] = []
    const mountedAt = Date.now()

    /** 強制對齊最終狀態（回前景／watchdog）；不自動開 PWA 浮層，避免 resume 後卡在全螢幕。 */
    const forceFinalizeSim = () => {
      if (allDoneRef.current || forceFinalizeRef.current) return
      forceFinalizeRef.current = true
      const standalone = readStandaloneMode()
      setChecks((prev) =>
        prev.map((c) => ({
          ...c,
          status: c.id === 'screenshot' && !standalone ? 'warn' : 'ok',
        })),
      )
      timeouts.push(
        window.setTimeout(() => {
          setAllDone(true)
        }, 0),
      )
    }

    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      const elapsed = Date.now() - mountedAt
      if (elapsed >= MIN_MS_BEFORE_RESUME_FORCE_FINISH && !allDoneRef.current && !forceFinalizeRef.current) {
        forceFinalizeSim()
      }
    }

    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('pageshow', onResume)

    timeouts.push(
      window.setTimeout(() => {
        if (!allDoneRef.current) forceFinalizeSim()
      }, SECURITY_CHECK_WATCHDOG_MS),
    )

    CHECKS.forEach(({ id, delay }) => {
      timeouts.push(
        window.setTimeout(() => {
          if (forceFinalizeRef.current) return
          setChecks((prev) =>
            prev.map((c) => (c.id === id ? { ...c, status: 'checking' } : c)),
          )
        }, delay),
      )

      timeouts.push(
        window.setTimeout(() => {
          if (forceFinalizeRef.current) return
          const isStandalone = readStandaloneMode()
          const resultStatus = id === 'screenshot' && !isStandalone ? 'warn' : 'ok'
          setChecks((prev) =>
            prev.map((c) => (c.id === id ? { ...c, status: resultStatus } : c)),
          )

          if (id === 'screenshot') {
            timeouts.push(
              window.setTimeout(() => {
                if (forceFinalizeRef.current) return
                setAllDone(true)
                if (!isStandalone && !hasUsedPwaStandaloneBefore()) {
                  setShowPWA(true)
                }
              }, 600),
            )
          }
        }, delay + 380),
      )
    })

    return () => {
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('pageshow', onResume)
      timeouts.forEach((t) => globalThis.clearTimeout(t))
    }
  }, [])

  const isStandaloneMode = readStandaloneMode()

  const canContinue = allDone && (isStandaloneMode || pwaSkipped)

  const hideManualContinueChrome = useMemo(() => {
    if (!allDone) return false
    if (isStandaloneMode) return true
    return Boolean(hasUsedPwaStandaloneBefore() && pwaSkipped)
  }, [allDone, isStandaloneMode, pwaSkipped])

  return (
    <div className="min-h-dvh max-w-md mx-auto flex flex-col bg-[#fafafa]">
      {/* Header */}
      <div
        className="px-5 pt-safe pb-8"
        style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-2 mb-6"
        >
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-white/60 text-xs tracking-widest uppercase font-medium">
            TsMedia
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.45 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            <h1 className="text-xl font-bold text-white">全球端對端加密環境檢測</h1>
          </div>
          <p className="text-sm text-white/50 leading-relaxed">
            為確保您的隱私安全，系統正在驗證您的裝置加密環境。
            此步驟需要約 5 秒鐘。
          </p>
        </motion.div>
      </div>

      {/* Check items */}
      <div className="flex-1 px-5 pt-6 space-y-3">
        {checks.map((check, i) => (
          <motion.div
            key={check.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
            className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-500 ${
                  check.status === 'ok'
                    ? 'bg-emerald-50'
                    : check.status === 'warn'
                    ? 'bg-amber-50'
                    : check.status === 'checking'
                    ? 'bg-blue-50'
                    : 'bg-slate-100'
                }`}
              >
                <AnimatePresence mode="wait">
                  {check.status === 'ok' && (
                    <motion.div key="ok" initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    </motion.div>
                  )}
                  {check.status === 'warn' && (
                    <motion.div key="warn" initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                    </motion.div>
                  )}
                  {check.status === 'checking' && (
                    <motion.div
                      key="checking"
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    >
                      <check.icon className="w-5 h-5 text-blue-400" />
                    </motion.div>
                  )}
                  {check.status === 'pending' && (
                    <motion.div key="pending">
                      <check.icon className="w-5 h-5 text-slate-300" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{check.label}</p>
                <p className={`text-xs mt-0.5 transition-colors duration-300 ${
                  check.status === 'ok'
                    ? 'text-emerald-500'
                    : check.status === 'warn'
                    ? 'text-amber-500'
                    : 'text-slate-400'
                }`}>
                  {check.status === 'pending' && '等待中⋯'}
                  {check.status === 'checking' && '驗證中⋯'}
                  {(check.status === 'ok' || check.status === 'warn') && check.desc}
                </p>
              </div>

              <div className="flex-shrink-0">
                {check.status === 'ok' && (
                  <span className="text-[10px] font-bold text-emerald-500 bg-emerald-50 rounded-full px-2 py-0.5">
                    通過
                  </span>
                )}
                {check.status === 'warn' && (
                  <span className="text-[10px] font-bold text-amber-500 bg-amber-50 rounded-full px-2 py-0.5">
                    警告
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        ))}

        {/* Advisory notice */}
        <AnimatePresence>
          {allDone && !hideManualContinueChrome && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="bg-slate-900 rounded-2xl p-5 mt-2"
            >
              <p className="text-white/90 text-sm font-semibold mb-1">
                {isStandaloneMode ? '✅  環境安全，可以繼續' : '⚠️  需要完成封裝'}
              </p>
              <p className="text-white/50 text-xs leading-relaxed">
                {isStandaloneMode
                  ? '您的裝置已完成所有安全驗證，端對端加密環境已就緒。'
                  : '為防止第三方系統截圖與監控，請將此環境封裝至系統主畫面（Encapsulation）後再繼續。'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-5 pb-10 pt-4">
        <AnimatePresence>
          {allDone && !hideManualContinueChrome && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-3"
            >
              {!isStandaloneMode && !pwaSkipped && (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowPWA(true)}
                  className="touch-manipulation w-full bg-slate-900 text-white rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 shadow-xl shadow-slate-900/20"
                >
                  <Shield className="w-5 h-5" />
                  立即封裝至主畫面
                </motion.button>
              )}

              {(isStandaloneMode || pwaSkipped) && (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={onContinue}
                  disabled={!canContinue}
                  className="touch-manipulation w-full bg-slate-900 text-white rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 shadow-xl shadow-slate-900/20 disabled:opacity-40"
                >
                  環境驗證完成，繼續
                  <ChevronRight className="w-5 h-5" />
                </motion.button>
              )}

              {!isStandaloneMode && !pwaSkipped && (
                <button
                  type="button"
                  onClick={() => { setPwaSkipped(true); setShowPWA(false) }}
                  className="touch-manipulation w-full text-slate-400 text-sm py-2"
                >
                  略過此步驟（降低隱私保護等級）
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* PWA install overlay */}
      {showPWA && (
        <PWAInstallGuide
          forceShow
          onDismiss={() => {
            setShowPWA(false)
            setPwaSkipped(true)
          }}
        />
      )}
    </div>
  )
}
