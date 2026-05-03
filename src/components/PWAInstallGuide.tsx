import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Share, Plus, Download, X, Smartphone, MoreVertical } from 'lucide-react'

type Platform = 'ios' | 'android' | 'desktop' | 'standalone'

function detectPlatform(): Platform {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true

  if (isStandalone) return 'standalone'

  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

interface Props {
  onDismiss?: () => void
  forceShow?: boolean
}

function StepRow({
  num,
  title,
  hint,
  icon,
}: {
  num: string
  title: string
  hint: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 bg-slate-50 rounded-2xl p-4">
      <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-white text-xs font-bold">{num}</span>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <div className="flex items-center gap-1.5 mt-1">
          {icon}
          <span className="text-xs text-slate-500">{hint}</span>
        </div>
      </div>
    </div>
  )
}

export default function PWAInstallGuide({ onDismiss, forceShow = false }: Props) {
  const [platform, setPlatform] = useState<Platform>('standalone')
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const p = detectPlatform()
    setPlatform(p)
    if (p !== 'standalone' || forceShow) {
      setTimeout(() => setVisible(true), 600)
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [forceShow])

  const handleNativeInstall = async () => {
    if (deferredPrompt) {
      const prompt = (deferredPrompt as unknown) as {
        prompt: () => void
        userChoice: Promise<{ outcome: string }>
      }
      prompt.prompt()
      await prompt.userChoice
      setDeferredPrompt(null)
    }
    dismiss()
  }

  const dismiss = () => {
    setVisible(false)
    setTimeout(() => onDismiss?.(), 400)
  }

  if (platform === 'standalone' && !forceShow) return null

  // When forceShow is used from SecurityCheckScreen, still respect real platform
  const effectivePlatform = platform === 'standalone' ? 'ios' : platform

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismiss}
          />

          {/* Bottom sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            <div className="bg-white rounded-t-3xl px-6 pt-5 pb-10 shadow-2xl">
              {/* Handle */}
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />

              {/* Close */}
              <button
                onClick={dismiss}
                className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>

              {/* Icon */}
              <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center mb-4">
                <Smartphone className="w-7 h-7 text-white" />
              </div>

              <h2 className="text-xl font-bold text-slate-900 mb-1">封裝至主畫面</h2>
              <p className="text-sm text-slate-500 mb-3 leading-relaxed">
                為啟用截圖防護與端對端加密隔離，請將 TsMedia 安裝至主畫面後再繼續。
              </p>
              {effectivePlatform === 'ios' && (
                <p className="text-xs text-slate-600 mb-4 leading-relaxed rounded-xl bg-slate-100 px-3 py-2.5">
                  iPhone 的 Safari 底部會因版本長得不一樣，照下面順序做即可。
                </p>
              )}

              {/* ── iOS ─────────────────────────────────────────── */}
              {effectivePlatform === 'ios' && (
                <div className="space-y-3">
                  <StepRow
                    num="1"
                    title="先看 Safari 最底那一列"
                    hint={
                      <>
                        看<strong>右側</strong>有沒有「⋯」三個直點：有就先點開，再在出現的那一列裡找「分享」（方形加往上箭頭）。
                        <span className="text-slate-400">
                          {' '}
                          若底部<strong>已經直接看得到「分享」</strong>、沒有 ⋯，這步跳過沒關係。
                        </span>
                      </>
                    }
                    icon={<MoreVertical className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                  />
                  <StepRow
                    num="2"
                    title="點「分享」"
                    hint="開啟分享面板後才能加入主畫面"
                    icon={<Share className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                  />
                  <StepRow
                    num="3"
                    title="往下滑，點「加入主畫面」"
                    hint="在分享面板裡往下找，有加號或主畫面字樣"
                    icon={<Plus className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                  />
                  <StepRow
                    num="4"
                    title="點「新增」完成"
                    hint="主畫面會出現 TsMedia 圖示，之後請從那個圖示開啟"
                    icon={<Smartphone className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                  />

                  <button
                    onClick={dismiss}
                    className="w-full py-3.5 text-sm font-semibold text-slate-400 mt-1"
                  >
                    我已完成安裝，繼續
                  </button>
                </div>
              )}

              {/* ── Android / Desktop ────────────────────────────── */}
              {(effectivePlatform === 'android' || effectivePlatform === 'desktop') && (
                <div className="space-y-3">
                  {/* Native install button — show if browser supports it */}
                  {deferredPrompt && (
                    <button
                      onClick={handleNativeInstall}
                      className="w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold text-base flex items-center justify-center gap-2 mb-1"
                    >
                      <Download className="w-5 h-5" />
                      一鍵安裝至主畫面
                    </button>
                  )}

                  {/* Divider when both options available */}
                  {deferredPrompt && (
                    <div className="flex items-center gap-3 px-1">
                      <div className="flex-1 h-px bg-slate-100" />
                      <span className="text-xs text-slate-400">或手動安裝</span>
                      <div className="flex-1 h-px bg-slate-100" />
                    </div>
                  )}

                  <StepRow
                    num="1"
                    title="點擊網址列右側的 ⋮ 按鈕"
                    hint="Chrome 右上角三個點的選單圖示"
                    icon={<MoreVertical className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                  />
                  <StepRow
                    num="2"
                    title='選擇「加入主畫面」'
                    hint="或選擇「安裝應用程式」（依 Chrome 版本而異）"
                    icon={<Plus className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                  />
                  <StepRow
                    num="3"
                    title="點擊「安裝」確認"
                    hint="TsMedia 圖示將出現在你的主畫面"
                    icon={<Smartphone className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                  />

                  <button
                    onClick={dismiss}
                    className="w-full py-3.5 text-sm font-semibold text-slate-400 mt-1"
                  >
                    我已完成安裝，繼續
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
