import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, Crown, Heart, Sparkles, Eye, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { completeMonthlyMembership } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import {
  loadTapPaySdk,
  initTapPayCardFields,
  getCardPrime,
  type TPDirectAPI,
} from '@/lib/tappayClient'
import TermsOfServiceModal from '@/components/TermsOfServiceModal'

export default function SubscriptionScreen({
  gender,
  userEmail,
  onBack,
  onSubscribed,
}: {
  gender: 'male' | 'female'
  userEmail: string
  onBack: () => void
  onSubscribed: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const tapConfigured =
    Boolean(import.meta.env.VITE_TAPPAY_APP_ID) &&
    Boolean(import.meta.env.VITE_TAPPAY_APP_KEY) &&
    Boolean(import.meta.env.VITE_TAPPAY_SERVER_TYPE)

  const [tapReady, setTapReady] = useState(false)
  const [tapInitError, setTapInitError] = useState<string | null>(null)
  const tpRef = useRef<TPDirectAPI | null>(null)

  const [holderName, setHolderName] = useState('')
  const [holderPhone, setHolderPhone] = useState('')
  const [holderEmail, setHolderEmail] = useState(userEmail)
  const [termsOpen, setTermsOpen] = useState(false)

  useEffect(() => {
    if (!tapConfigured) return
    let cancelled = false
    ;(async () => {
      try {
        const tp = await loadTapPaySdk()
        if (cancelled) return
        const rawId = import.meta.env.VITE_TAPPAY_APP_ID
        const appKey = import.meta.env.VITE_TAPPAY_APP_KEY
        const appId = Number(rawId)
        const serverType =
          import.meta.env.VITE_TAPPAY_SERVER_TYPE === 'production' ? 'production' : 'sandbox'
        if (Number.isNaN(appId) || !appKey) {
          setTapInitError('前端環境變數 VITE_TAPPAY_APP_ID / APP_KEY 無效')
          return
        }
        initTapPayCardFields(tp, appId, appKey, serverType)
        tpRef.current = tp
        setTapReady(true)
      } catch (e) {
        if (!cancelled) {
          setTapInitError(e instanceof Error ? e.message : '金流元件載入失敗')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tapConfigured])

  const price = gender === 'male' ? 399 : 299

  const subscribeMock = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await completeMonthlyMembership()
      if (!res.ok) {
        setError(res.error ?? '開通失敗')
        return
      }
      setDone(true)
      window.setTimeout(() => {
        onSubscribed()
      }, 900)
    } finally {
      setBusy(false)
    }
  }

  const subscribeTapPay = async () => {
    const tp = tpRef.current
    if (!tp || !tapReady) return
    if (!holderName.trim() || !holderPhone.trim() || !holderEmail.trim()) {
      setError('請填寫持卡人姓名、手機與 Email（TapPay 必填）。')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const prime = await getCardPrime(tp)
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setError('登入已過期，請重新登入。')
        return
      }

      const res = await fetch('/api/tappay-membership', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prime,
          cardholder: {
            phone_number: holderPhone.trim(),
            name: holderName.trim(),
            email: holderEmail.trim(),
            zip_code: '100',
            address: '台灣',
          },
        }),
      })

      const json = (await res.json()) as { ok?: boolean; error?: string }

      if (!res.ok || !json.ok) {
        setError(json.error ?? `付款失敗（${res.status}）`)
        return
      }

      setDone(true)
      window.setTimeout(() => {
        onSubscribed()
      }, 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : '付款失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-full min-h-0 flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white"
    >
      <header className="flex-shrink-0 flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 active:bg-white/20"
          aria-label="返回"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-black tracking-tight">會員方案</h1>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="mx-auto max-w-sm pt-2">
          <div className="flex justify-center">
            <div className="rounded-full bg-gradient-to-br from-amber-400 to-orange-600 p-4 shadow-lg shadow-amber-900/40">
              <Crown className="h-10 w-10 text-white" />
            </div>
          </div>
          <p className="mt-4 text-center text-2xl font-black tracking-tight">
            每月 <span className="text-amber-400">{price}</span> 元
          </p>
          <p className="mt-1 text-center text-xs font-semibold text-slate-400">
            {gender === 'male' ? '男性會員' : '女性會員'} ·{' '}
            {tapConfigured
              ? '信用卡付款（TapPay）；自動續扣可後續接定期授權'
              : '尚未設定 TapPay，現為模擬開通'}
          </p>

          <ul className="mt-8 space-y-3">
            {[
              { icon: Heart, text: '開通即贈 3 顆愛心 + 1 次超級喜歡' },
              { icon: Eye, text: '開通即贈 10 次解除拼圖模糊' },
              { icon: Sparkles, text: '會員每日登入送 2 顆愛心（每晚 10 點換日）' },
              { icon: Check, text: '探索滑卡消耗愛心／超級喜歡（略過不扣）' },
            ].map(({ icon: Icon, text }) => (
              <li
                key={text}
                className="flex items-start gap-3 rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10"
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <span className="text-sm font-semibold leading-snug text-slate-100">{text}</span>
              </li>
            ))}
          </ul>

          {tapConfigured && (
            <div className="mt-6 space-y-3 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                信用卡（TapPay）
              </p>
              {tapInitError && (
                <p className="text-xs font-semibold text-red-300">{tapInitError}</p>
              )}
              <div id="tappay-card-number" className="h-12 rounded-xl bg-white px-3 ring-1 ring-slate-200" />
              <div className="flex gap-2">
                <div id="tappay-card-expiration" className="h-12 flex-1 rounded-xl bg-white px-3 ring-1 ring-slate-200" />
                <div id="tappay-card-ccv" className="h-12 w-[38%] shrink-0 rounded-xl bg-white px-3 ring-1 ring-slate-200" />
              </div>
              <input
                type="text"
                autoComplete="name"
                placeholder="持卡人姓名"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                className="w-full rounded-xl bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400"
              />
              <input
                type="tel"
                autoComplete="tel"
                placeholder="手機（例：0912345678）"
                value={holderPhone}
                onChange={(e) => setHolderPhone(e.target.value)}
                className="w-full rounded-xl bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400"
              />
              <input
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={holderEmail}
                onChange={(e) => setHolderEmail(e.target.value)}
                className="w-full rounded-xl bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-slate-200 placeholder:text-slate-400"
              />
              {!tapReady && !tapInitError && (
                <p className="text-xs text-slate-400">正在載入安全輸入框</p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-2xl bg-red-500/15 px-4 py-2 text-center text-sm font-semibold text-red-300 ring-1 ring-red-400/30">
              {error}
            </p>
          )}

          {done && (
            <p className="mt-4 text-center text-sm font-bold text-emerald-400">開通成功，正在返回⋯</p>
          )}
        </div>
      </div>

      <div
        className="flex-shrink-0 border-t border-white/10 bg-slate-950/90 px-5 pt-3 backdrop-blur-md"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        {tapConfigured ? (
          <button
            type="button"
            disabled={busy || done || !tapReady || Boolean(tapInitError)}
            onClick={() => void subscribeTapPay()}
            className={cn(
              'w-full rounded-2xl py-4 text-base font-black shadow-lg transition active:scale-[0.99]',
              busy || done || !tapReady || tapInitError
                ? 'bg-slate-700 text-slate-400'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-900/30',
            )}
          >
            {busy ? '付款處理中⋯' : done ? '已完成' : `信用卡付款 ${price} 元／月`}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || done}
            onClick={() => void subscribeMock()}
            className={cn(
              'w-full rounded-2xl py-4 text-base font-black shadow-lg transition active:scale-[0.99]',
              busy || done
                ? 'bg-slate-700 text-slate-400'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-900/30',
            )}
          >
            {busy ? '處理中⋯' : done ? '已完成' : `立即開通 ${price} 元／月（模擬付款）`}
          </button>
        )}
        <p className="mt-3 max-w-sm mx-auto text-center text-[11px] leading-relaxed text-slate-500">
          繼續付款即表示您已閱讀並同意{' '}
          <button
            type="button"
            className="font-semibold text-amber-400/95 underline decoration-amber-400/50 underline-offset-2"
            onClick={() => setTermsOpen(true)}
          >
            服務條款（Terms of Service）
          </button>
          。
        </p>
      </div>

      <TermsOfServiceModal open={termsOpen} onClose={() => setTermsOpen(false)} />
    </motion.div>
  )
}
