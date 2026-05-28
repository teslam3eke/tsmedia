import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, Crown, Heart, Sparkles, Eye, Check, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  cancelMembershipSubscription,
  completeMonthlyMembership,
  getProfile,
  purchaseCreditPackMock,
} from '@/lib/db'
import { supabase } from '@/lib/supabase'
import {
  CREDIT_PACK_PRODUCTS,
  formatMembershipExpiryZhTw,
  isMembershipActive,
  membershipMonthlyPriceNtd,
  type CreditPackKey,
} from '@/lib/membershipProducts'
import {
  loadTapPaySdk,
  initTapPayCardFields,
  getCardPrime,
  type TPDirectAPI,
} from '@/lib/tappayClient'
import TermsOfServiceModal from '@/components/TermsOfServiceModal'

export type MembershipUpdateEvent =
  | { type: 'membership' }
  | { type: 'pack'; subtitle: string }
  | { type: 'cancel' }

const TAPPAY_FIELD_PREFIX = 'membership-mgmt-card'

export default function MembershipManagementScreen({
  userId,
  gender,
  userEmail,
  onBack,
  onUpdated,
}: {
  userId: string
  gender: 'male' | 'female'
  userEmail: string
  onBack: () => void
  onUpdated: (event: MembershipUpdateEvent) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<string | null>(null)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)

  const tapConfigured =
    Boolean(import.meta.env.VITE_TAPPAY_APP_ID) &&
    Boolean(import.meta.env.VITE_TAPPAY_APP_KEY) &&
    Boolean(import.meta.env.VITE_TAPPAY_SERVER_TYPE)

  const [tapReady, setTapReady] = useState(false)
  const [tapInitError, setTapInitError] = useState<string | null>(null)
  const [tpRef, setTpRef] = useState<TPDirectAPI | null>(null)

  const [holderName, setHolderName] = useState('')
  const [holderPhone, setHolderPhone] = useState('')
  const [holderEmail, setHolderEmail] = useState(userEmail)

  const monthlyPrice = membershipMonthlyPriceNtd(gender)
  const memberActive = isMembershipActive(subscriptionExpiresAt)

  const reloadProfile = useCallback(async () => {
    const profile = await getProfile(userId)
    setSubscriptionExpiresAt(profile?.subscription_expires_at ?? null)
  }, [userId])

  useEffect(() => {
    void reloadProfile()
  }, [reloadProfile])

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
        initTapPayCardFields(tp, appId, appKey, serverType, TAPPAY_FIELD_PREFIX)
        setTpRef(tp)
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

  const cardholderPayload = () => ({
    phone_number: holderPhone.trim(),
    name: holderName.trim(),
    email: holderEmail.trim(),
    zip_code: '100',
    address: '台灣',
  })

  const ensureCardholder = () => {
    if (!tapConfigured) return true
    if (!holderName.trim() || !holderPhone.trim() || !holderEmail.trim()) {
      setError('請填寫持卡人姓名、手機與 Email（TapPay 必填）。')
      return false
    }
    return true
  }

  const buyPack = async (packKey: CreditPackKey, creditLabel: string) => {
    setBusy(true)
    setError(null)
    try {
      if (!tapConfigured) {
        const res = await purchaseCreditPackMock(packKey)
        if (!res.ok) {
          setError(res.error ?? '購買失敗')
          return
        }
        onUpdated({ type: 'pack', subtitle: creditLabel })
        return
      }
      if (!ensureCardholder() || !tpRef || !tapReady) return
      const prime = await getCardPrime(tpRef)
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setError('登入已過期，請重新登入。')
        return
      }
      const res = await fetch('/api/tappay-credit-pack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          packKey,
          prime,
          cardholder: cardholderPayload(),
        }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error ?? `付款失敗（${res.status}）`)
        return
      }
      onUpdated({ type: 'pack', subtitle: creditLabel })
    } catch (e) {
      setError(e instanceof Error ? e.message : '購買失敗')
    } finally {
      setBusy(false)
    }
  }

  const subscribeMock = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await completeMonthlyMembership()
      if (!res.ok) {
        setError(res.error ?? '開通失敗')
        return
      }
      await reloadProfile()
      onUpdated({ type: 'membership' })
    } finally {
      setBusy(false)
    }
  }

  const subscribeTapPay = async () => {
    if (!tpRef || !tapReady) return
    if (!ensureCardholder()) return
    setBusy(true)
    setError(null)
    try {
      const prime = await getCardPrime(tpRef)
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
          cardholder: cardholderPayload(),
        }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error ?? `付款失敗（${res.status}）`)
        return
      }
      await reloadProfile()
      onUpdated({ type: 'membership' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '付款失敗')
    } finally {
      setBusy(false)
    }
  }

  const confirmCancel = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await cancelMembershipSubscription()
      if (!res.ok) {
        setError(res.reason === 'not_subscribed' ? '目前沒有有效會員訂閱' : res.error ?? '取消失敗')
        return
      }
      setCancelConfirmOpen(false)
      await reloadProfile()
      onUpdated({ type: 'cancel' })
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
        <h1 className="text-lg font-black tracking-tight">會員管理</h1>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="mx-auto max-w-sm space-y-6 pt-2">
          <div className="rounded-2xl bg-white/5 px-4 py-4 ring-1 ring-white/10">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">會員到期日</p>
            <p className="mt-2 text-lg font-black text-amber-400">
              {formatMembershipExpiryZhTw(subscriptionExpiresAt)}
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              {memberActive ? '會員權益使用中' : '訂閱後可領每日愛心與開通禮'}
            </p>
          </div>

          <section>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">購買道具</p>
            <div className="space-y-3">
              {CREDIT_PACK_PRODUCTS.map((pack) => (
                <div
                  key={pack.key}
                  className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                    {pack.key === 'super_like_5' ? (
                      <Sparkles className="h-5 w-5 text-fuchsia-400" />
                    ) : (
                      <LayoutGrid className="h-5 w-5 text-sky-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-slate-100">{pack.title}</p>
                    <p className="text-[11px] font-semibold text-slate-400">{pack.subtitle}</p>
                    <p className="mt-0.5 text-sm font-black text-amber-400">NT$ {pack.priceNtd}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || (tapConfigured && (!tapReady || Boolean(tapInitError)))}
                    onClick={() => void buyPack(pack.key, pack.creditLabel)}
                    className={cn(
                      'shrink-0 rounded-xl px-3 py-2 text-xs font-black transition active:scale-[0.98]',
                      busy ? 'bg-slate-700 text-slate-400' : 'bg-amber-500 text-slate-950',
                    )}
                  >
                    購買
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">月費會員</p>
            <div className="flex justify-center">
              <div className="rounded-full bg-gradient-to-br from-amber-400 to-orange-600 p-3 shadow-lg shadow-amber-900/40">
                <Crown className="h-8 w-8 text-white" />
              </div>
            </div>
            <p className="mt-3 text-center text-xl font-black tracking-tight">
              每月 <span className="text-amber-400">{monthlyPrice}</span> 元
            </p>
            <p className="mt-1 text-center text-xs font-semibold text-slate-400">
              {gender === 'male' ? '男性會員' : '女性會員'} ·{' '}
              {tapConfigured ? '信用卡付款（TapPay）' : '尚未設定 TapPay，現為模擬開通'}
            </p>

            <ul className="mt-5 space-y-2.5">
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
          </section>

          {tapConfigured && (
            <div className="space-y-3 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">信用卡（TapPay）</p>
              {tapInitError && <p className="text-xs font-semibold text-red-300">{tapInitError}</p>}
              <div
                id={`${TAPPAY_FIELD_PREFIX}-number`}
                className="h-12 rounded-xl bg-white px-3 ring-1 ring-slate-200"
              />
              <div className="flex gap-2">
                <div
                  id={`${TAPPAY_FIELD_PREFIX}-expiration`}
                  className="h-12 flex-1 rounded-xl bg-white px-3 ring-1 ring-slate-200"
                />
                <div
                  id={`${TAPPAY_FIELD_PREFIX}-ccv`}
                  className="h-12 w-[38%] shrink-0 rounded-xl bg-white px-3 ring-1 ring-slate-200"
                />
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
              {!tapReady && !tapInitError && <p className="text-xs text-slate-400">正在載入安全輸入框</p>}
            </div>
          )}

          {memberActive && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setCancelConfirmOpen(true)}
              className="w-full rounded-2xl border border-red-400/40 bg-red-500/10 py-3.5 text-sm font-black text-red-300 ring-1 ring-red-400/20 transition active:scale-[0.99] disabled:opacity-60"
            >
              取消會員訂閱
            </button>
          )}

          {error && (
            <p className="rounded-2xl bg-red-500/15 px-4 py-2 text-center text-sm font-semibold text-red-300 ring-1 ring-red-400/30">
              {error}
            </p>
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
            disabled={busy || !tapReady || Boolean(tapInitError)}
            onClick={() => void subscribeTapPay()}
            className={cn(
              'w-full rounded-2xl py-4 text-base font-black shadow-lg transition active:scale-[0.99]',
              busy || !tapReady || tapInitError
                ? 'bg-slate-700 text-slate-400'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-900/30',
            )}
          >
            {busy ? '付款處理中⋯' : `訂閱會員 ${monthlyPrice} 元／月`}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void subscribeMock()}
            className={cn(
              'w-full rounded-2xl py-4 text-base font-black shadow-lg transition active:scale-[0.99]',
              busy
                ? 'bg-slate-700 text-slate-400'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-900/30',
            )}
          >
            {busy ? '處理中⋯' : `訂閱會員 ${monthlyPrice} 元／月（模擬付款）`}
          </button>
        )}
        <p className="mt-3 mx-auto max-w-sm text-center text-[11px] leading-relaxed text-slate-500">
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

      {cancelConfirmOpen && (
        <div className="fixed inset-0 z-[420] flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-5 ring-1 ring-white/10">
            <p className="text-base font-black text-white">確定取消會員訂閱？</p>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-400">
              取消後將立即失去會員資格（含每日登入愛心）。已購買的道具次數仍可使用。
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setCancelConfirmOpen(false)}
                className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-bold text-slate-200"
              >
                保留會員
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmCancel()}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-black text-white"
              >
                確認取消
              </button>
            </div>
          </div>
        </div>
      )}

      <TermsOfServiceModal open={termsOpen} onClose={() => setTermsOpen(false)} />
    </motion.div>
  )
}
