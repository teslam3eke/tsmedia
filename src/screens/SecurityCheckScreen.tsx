import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, Lock, Wifi, Eye, AlertTriangle, CheckCircle2,
  ChevronRight, Cpu,
} from 'lucide-react'
import PWAInstallGuide from '@/components/PWAInstallGuide'

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

export default function SecurityCheckScreen({ onContinue }: Props) {
  const [checks, setChecks] = useState<Check[]>(
    CHECKS.map((c) => ({ ...c, status: 'pending' })),
  )
  const [showPWA, setShowPWA] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const [pwaSkipped, setPwaSkipped] = useState(false)

  useEffect(() => {
    CHECKS.forEach(({ id, delay }) => {
      // Set to 'checking'
      setTimeout(() => {
        setChecks((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: 'checking' } : c)),
        )
      }, delay)

      // Set to result
      setTimeout(() => {
        const isStandalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          (window.navigator as { standalone?: boolean }).standalone === true

        const resultStatus = id === 'screenshot' && !isStandalone ? 'warn' : 'ok'
        setChecks((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: resultStatus } : c)),
        )

        if (id === 'screenshot') {
          setTimeout(() => {
            setAllDone(true)
            if (!isStandalone) {
              setShowPWA(true)
            }
          }, 600)
        }
      }, delay + 380)
    })
  }, [])

  const isStandaloneMode =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true

  const canContinue = allDone && (isStandaloneMode || pwaSkipped)

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
          {allDone && (
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
          {allDone && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-3"
            >
              {!isStandaloneMode && !pwaSkipped && (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowPWA(true)}
                  className="w-full bg-slate-900 text-white rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 shadow-xl shadow-slate-900/20"
                >
                  <Shield className="w-5 h-5" />
                  立即封裝至主畫面
                </motion.button>
              )}

              {(isStandaloneMode || pwaSkipped) && (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={onContinue}
                  disabled={!canContinue}
                  className="w-full bg-slate-900 text-white rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 shadow-xl shadow-slate-900/20 disabled:opacity-40"
                >
                  環境驗證完成，繼續
                  <ChevronRight className="w-5 h-5" />
                </motion.button>
              )}

              {!isStandaloneMode && !pwaSkipped && (
                <button
                  onClick={() => { setPwaSkipped(true); setShowPWA(false) }}
                  className="w-full text-slate-400 text-sm py-2"
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
