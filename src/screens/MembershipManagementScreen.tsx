import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  ShieldCheck,
} from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/utils'
import {
  completeMonthlyMembership,
  getProfile,
  purchaseCreditPackMock,
  purchaseCrownEffectMock,
} from '@/lib/db'
import { supabase } from '@/lib/supabase'
import {
  CREDIT_PACK_PRODUCTS,
  CROWN_EFFECT_PRODUCT,
  formatMembershipExpiryZhTw,
  isCrownEffectPurchased,
  isMembershipActive,
  MEMBERSHIP_LIST_PRICE_NTD,
  type CreditPackKey,
} from '@/lib/membershipProducts'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/supportContact'
import {
  fetchPublicPaymentPricing,
  formatDiscountTenthsZh,
  isPromoPriceActive,
  type PublicPaymentPricing,
} from '@/lib/paymentPricing'
import {
  loadTapPaySdk,
  initTapPayCardFields,
  getCardPrime,
  type TPDirectAPI,
} from '@/lib/tappayClient'
import { usePaymentProvider } from '@/hooks/usePaymentProvider'
import { startEcpayCheckout, syncPendingEcpayOrders } from '@/lib/ecpayCheckout'
import TermsOfServiceModal from '@/components/TermsOfServiceModal'

export type MembershipUpdateEvent =
  | { type: 'membership' }
  | { type: 'pack'; subtitle: string }
  | { type: 'crown_effect' }

const TAPPAY_FIELD_PREFIX = 'membership-mgmt-card'
const SERIF = '"Noto Serif TC", "Songti TC", "STSong", "Georgia", serif'
const GOLD = '#aa8147'

function ProductPriceLine({
  listPriceNtd,
  priceNtd,
  suffix = '起',
}: {
  listPriceNtd: number
  priceNtd: number
  suffix?: string
}) {
  const showDiscount = isPromoPriceActive(listPriceNtd, priceNtd)
  return (
    <p className="flex flex-wrap items-baseline justify-end gap-x-1 gap-y-0.5 text-right">
      {showDiscount && (
        <span className="text-[10px] font-semibold text-[#a3968a] line-through">NT$ {listPriceNtd}</span>
      )}
      <span className="text-[10px] font-bold tracking-[0.04em] text-[#5b5045]">NT$</span>
      <span className="text-[21px] font-medium leading-none text-[#33291f]" style={{ fontFamily: SERIF }}>
        {priceNtd}
      </span>
      {suffix && <span className="text-[10px] font-semibold text-[#8a7d6f]">{suffix}</span>}
    </p>
  )
}

const CREDIT_PACK_ICON_SRC: Record<CreditPackKey, string> = {
  heart_5: '/assets/images/store/heart-gold.png',
  super_like_5: '/assets/images/store/star-gold.png',
  blur_unlock_16: '/assets/images/store/puzzle-glass.png',
}

function CreditPackIcon({ packKey }: { packKey: CreditPackKey }) {
  return (
    <img
      src={CREDIT_PACK_ICON_SRC[packKey]}
      alt=""
      draggable={false}
      // 素材為白底 3D 渲染圖：multiply 讓白底融入卡片背景
      className="h-full w-full object-contain mix-blend-multiply"
    />
  )
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-1">
      <div className="h-px w-16 bg-gradient-to-r from-transparent to-[#b3925e]" />
      <span className="h-1.5 w-1.5 rotate-45 bg-[#b3925e]" />
      <span
        className="text-[17px] font-semibold tracking-[0.2em] text-[#6b5636]"
        style={{ fontFamily: SERIF }}
      >
        {label}
      </span>
      <span className="h-1.5 w-1.5 rotate-45 bg-[#b3925e]" />
      <div className="h-px w-16 bg-gradient-to-l from-transparent to-[#b3925e]" />
    </div>
  )
}

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
  const [crownEffectPurchasedAt, setCrownEffectPurchasedAt] = useState<string | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const [pricing, setPricing] = useState<PublicPaymentPricing | null>(null)

  const { mode: paymentMode, loading: paymentLoading } = usePaymentProvider()

  const [tapReady, setTapReady] = useState(false)
  const [tapInitError, setTapInitError] = useState<string | null>(null)
  const [tpRef, setTpRef] = useState<TPDirectAPI | null>(null)

  const [holderName, setHolderName] = useState('')
  const [holderPhone, setHolderPhone] = useState('')
  const [holderEmail, setHolderEmail] = useState(userEmail)

  const monthlyListPrice = MEMBERSHIP_LIST_PRICE_NTD[gender]
  const monthlyPrice = pricing?.membership[gender].priceNtd ?? monthlyListPrice
  const memberActive = isMembershipActive(subscriptionExpiresAt)
  const crownEffectOwned = isCrownEffectPurchased(crownEffectPurchasedAt)

  const reloadProfile = useCallback(async () => {
    if (paymentMode === 'ecpay') {
      const synced = await syncPendingEcpayOrders()
      if (synced.ok && synced.synced && synced.productType === 'membership') {
        setSubscriptionExpiresAt(synced.subscriptionExpiresAt ?? null)
        onUpdated({ type: 'membership' })
      }
    }
    const profile = await getProfile(userId)
    setSubscriptionExpiresAt(profile?.subscription_expires_at ?? null)
    setCrownEffectPurchasedAt(profile?.crown_effect_purchased_at ?? null)
  }, [userId, paymentMode, onUpdated])

  useEffect(() => {
    void reloadProfile()
  }, [reloadProfile])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await fetchPublicPaymentPricing()
      if (!cancelled) setPricing(next)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void reloadProfile()
        void fetchPublicPaymentPricing().then(setPricing)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reloadProfile])

  useEffect(() => {
    if (paymentMode !== 'tappay') return
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
  }, [paymentMode])

  const cardholderPayload = () => ({
    phone_number: holderPhone.trim(),
    name: holderName.trim(),
    email: holderEmail.trim(),
    zip_code: '100',
    address: '台灣',
  })

  const ensureCardholder = () => {
    if (paymentMode !== 'tappay') return true
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
      if (paymentMode === 'mock') {
        const res = await purchaseCreditPackMock(packKey)
        if (!res.ok) {
          setError(res.error ?? '購買失敗')
          return
        }
        onUpdated({ type: 'pack', subtitle: creditLabel })
        return
      }
      if (paymentMode === 'ecpay') {
        await startEcpayCheckout({
          productType: 'credit_pack',
          packKey,
          email: userEmail,
        })
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

  const buyCrownEffect = async () => {
    if (crownEffectOwned) return
    setBusy(true)
    setError(null)
    try {
      if (paymentMode === 'mock') {
        const res = await purchaseCrownEffectMock()
        if (!res.ok) {
          setError(res.error ?? '購買失敗')
          return
        }
        await reloadProfile()
        onUpdated({ type: 'crown_effect' })
        return
      }
      if (paymentMode === 'ecpay') {
        await startEcpayCheckout({
          productType: 'credit_pack',
          packKey: CROWN_EFFECT_PRODUCT.key,
          email: userEmail,
        })
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
          packKey: CROWN_EFFECT_PRODUCT.key,
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
      onUpdated({ type: 'crown_effect' })
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

  const subscribeEcpay = async () => {
    setBusy(true)
    setError(null)
    try {
      await startEcpayCheckout({
        productType: 'membership',
        email: userEmail,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法前往付款')
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

  const handleSubscribe = () => {
    if (paymentMode === 'ecpay') void subscribeEcpay()
    else if (paymentMode === 'tappay') void subscribeTapPay()
    else void subscribeMock()
  }

  const subscribeDisabled =
    busy ||
    paymentLoading ||
    (paymentMode === 'tappay' && (!tapReady || Boolean(tapInitError)))

  const subscribeLabel = busy
    ? paymentMode === 'ecpay'
      ? '前往付款頁⋯'
      : '付款處理中⋯'
    : '立即開通'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f2ec] text-[#302b27]"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_18%_5%,rgba(255,255,255,0.96),transparent_42%),radial-gradient(ellipse_at_85%_28%,rgba(224,205,179,0.42),transparent_45%),linear-gradient(145deg,#eee8e1_0%,#fffdf9_42%,#eee4d8_100%)]" />
        <div className="absolute -right-28 top-14 h-72 w-72 rounded-full border-[3px] border-[#c8a66c]/25 shadow-[0_0_18px_rgba(194,153,88,0.16)]" />
        <div className="absolute -right-20 top-20 h-60 w-60 rounded-full border border-white/80" />
        <div className="absolute -left-24 top-0 h-52 w-80 -rotate-12 rounded-[50%] bg-white/50 blur-xl" />
        <div className="absolute inset-x-0 top-[360px] h-40 bg-gradient-to-b from-transparent via-[#f7f2ec]/90 to-[#f7f2ec]" />
      </div>

      <header className="relative z-10 flex-shrink-0 px-5 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/75 shadow-[0_3px_12px_rgba(80,64,46,0.12)] ring-1 ring-white active:bg-white"
          aria-label="返回"
        >
          <ChevronLeft className="h-5 w-5 text-[#4d443a]" />
        </button>
      </header>

      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-5 pb-8" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="mx-auto max-w-[420px] space-y-5">
          <div className="text-center">
            <BrandMark className="mx-auto h-[58px] w-[58px] drop-shadow-[0_3px_4px_rgba(153,101,44,0.18)]" />
            <p
              className="mt-1 text-[26px] font-normal leading-none tracking-[0.06em]"
              style={{ fontFamily: SERIF, color: GOLD }}
            >
              tsmedia
            </p>
            <p className="mt-1.5 text-[9px] font-medium tracking-[0.42em] text-[#7f7468]">高品質交友平台</p>
            <p
              className="mt-5 text-[25px] font-semibold leading-[1.55] tracking-[0.06em] text-[#342d27]"
              style={{ fontFamily: SERIF }}
            >
              為你的每一次相遇，
              <br />
              創造<span className="text-[#a67d42]">更多可能</span>
              <span className="ml-1 text-[18px] text-[#c9a86a]">✦</span>
            </p>
            <p className="mt-2 text-[11px] font-medium tracking-[0.08em] text-[#8c8176]">
              選擇適合你的方案，開啟高品質交友之旅
            </p>
          </div>

          {pricing?.promo && (
            <p className="rounded-2xl bg-[#fff8f0] px-4 py-3 text-center text-sm font-bold leading-snug text-[#8b6914] ring-1 ring-[#e8d5b5]">
              {pricing.promo.label} · 全站 {formatDiscountTenthsZh(pricing.promo.discountTenths)}
            </p>
          )}

          <section className="relative mt-9 overflow-visible rounded-[20px] border border-[#d9c8a8] bg-[#fffefb] px-5 pb-6 pt-8 shadow-[0_14px_30px_rgba(96,70,40,0.13)]">
            <div
              className="pointer-events-none absolute right-4 top-6 h-[74px] w-[74px] opacity-[0.13]"
              aria-hidden
            >
              <BrandMark className="h-full w-full" />
            </div>

            <div className="absolute left-4 -top-3.5 z-10">
              <div className="flex h-7 items-center gap-1.5 rounded-full bg-gradient-to-b from-[#f3e7cd] to-[#dfc9a0] px-4 shadow-[0_4px_10px_rgba(98,70,38,0.18)] ring-1 ring-white/70">
                <Crown className="h-3.5 w-3.5 text-[#8a6228]" fill="#b98f4e" />
                <span className="text-[11px] font-black tracking-[0.1em] text-[#6b4e26]">最多人選擇</span>
              </div>
            </div>

            <h2 className="text-[27px] font-semibold tracking-[0.04em] text-[#22201d]" style={{ fontFamily: SERIF }}>
              30 <span className="text-[19px]">天會員</span>
            </h2>
            <p className="mt-0.5 text-[10px] font-semibold text-[#93877a]">
              {memberActive
                ? `VIP 使用中 · ${formatMembershipExpiryZhTw(subscriptionExpiresAt)}`
                : gender === 'male'
                  ? '男性 VIP · 單次購買，到期需再購買'
                  : '女性 VIP · 單次購買，到期需再購買'}
            </p>

            <div className="mt-3.5 flex items-end gap-3">
              <ul className="min-w-0 flex-1 space-y-3">
                {[
                  '每次購買即贈 5 顆愛心 + 3 次超級喜歡',
                  '每次購買即贈 20 次解除拼圖模糊',
                  'VIP 每日登入：3 愛心 + 2 拼圖解鎖',
                ].map((text) => (
                  <li key={text} className="flex items-start gap-2">
                    <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#c1a066] to-[#9d7b42]">
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
                    </span>
                    <span className="text-[12px] font-medium leading-[1.45] tracking-[0.02em] text-[#4c443b]">
                      {text}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex w-[128px] shrink-0 flex-col items-end">
                <p className="whitespace-nowrap text-right leading-none">
                  {isPromoPriceActive(monthlyListPrice, monthlyPrice) && (
                    <span className="mr-1 text-[10px] font-semibold text-[#a3968a] line-through">
                      NT$ {monthlyListPrice}
                    </span>
                  )}
                  <span className="text-[11px] font-bold tracking-[0.02em] text-[#5b5045]">NT$ </span>
                  <span
                    className="text-[34px] font-medium tabular-nums"
                    style={{ color: GOLD, fontFamily: SERIF }}
                  >
                    {monthlyPrice}
                  </span>
                  <span className="ml-1 text-[12px] font-semibold text-[#4c443b]">/ 30 天</span>
                </p>

                <button
                  type="button"
                  disabled={subscribeDisabled}
                  onClick={handleSubscribe}
                  className={cn(
                    'mt-4 flex w-full items-center justify-center gap-1 rounded-full py-3 text-[14px] font-bold tracking-[0.14em] text-white transition active:scale-[0.98]',
                    subscribeDisabled
                      ? 'bg-[#c4b8a8]'
                      : 'bg-gradient-to-b from-[#d3b077] via-[#bd9257] to-[#a37b3f] shadow-[0_6px_14px_rgba(140,102,52,0.4),inset_0_1px_0_rgba(255,240,210,0.8)]',
                  )}
                >
                  {subscribeLabel}
                  {!busy && <ChevronRight className="h-4 w-4" strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          </section>

          {paymentMode === 'tappay' && (
            <div className="space-y-3 rounded-[20px] bg-white p-4 shadow-[0_4px_20px_rgba(170,129,71,0.08)] ring-1 ring-[#ede4d8]">
              <p className="text-[11px] font-bold tracking-wider text-[#9a8b7a]">信用卡（TapPay）</p>
              {tapInitError && <p className="text-xs font-semibold text-red-600">{tapInitError}</p>}
              <div
                id={`${TAPPAY_FIELD_PREFIX}-number`}
                className="h-12 rounded-xl bg-[#faf7f3] px-3 ring-1 ring-[#e8dfd3]"
              />
              <div className="flex gap-2">
                <div
                  id={`${TAPPAY_FIELD_PREFIX}-expiration`}
                  className="h-12 flex-1 rounded-xl bg-[#faf7f3] px-3 ring-1 ring-[#e8dfd3]"
                />
                <div
                  id={`${TAPPAY_FIELD_PREFIX}-ccv`}
                  className="h-12 w-[38%] shrink-0 rounded-xl bg-[#faf7f3] px-3 ring-1 ring-[#e8dfd3]"
                />
              </div>
              <input
                type="text"
                autoComplete="name"
                placeholder="持卡人姓名"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                className="w-full rounded-xl bg-[#faf7f3] px-3 py-3 text-sm font-semibold text-[#4a4035] outline-none ring-1 ring-[#e8dfd3] placeholder:text-[#b8a898]"
              />
              <input
                type="tel"
                autoComplete="tel"
                placeholder="手機（例：0912345678）"
                value={holderPhone}
                onChange={(e) => setHolderPhone(e.target.value)}
                className="w-full rounded-xl bg-[#faf7f3] px-3 py-3 text-sm font-semibold text-[#4a4035] outline-none ring-1 ring-[#e8dfd3] placeholder:text-[#b8a898]"
              />
              <input
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={holderEmail}
                onChange={(e) => setHolderEmail(e.target.value)}
                className="w-full rounded-xl bg-[#faf7f3] px-3 py-3 text-sm font-semibold text-[#4a4035] outline-none ring-1 ring-[#e8dfd3] placeholder:text-[#b8a898]"
              />
              {!tapReady && !tapInitError && (
                <p className="text-xs text-[#9a8b7a]">正在載入安全輸入框</p>
              )}
            </div>
          )}

          <SectionDivider label="加值道具" />

          <div className="space-y-2.5">
            {CREDIT_PACK_PRODUCTS.map((pack) => {
              const packPricing = pricing?.packs[pack.key]
              const listPriceNtd = packPricing?.listPriceNtd ?? pack.listPriceNtd
              const priceNtd = packPricing?.priceNtd ?? pack.listPriceNtd
              const packBusy =
                busy ||
                paymentLoading ||
                (paymentMode === 'tappay' && (!tapReady || Boolean(tapInitError)))
              return (
                <div
                  key={pack.key}
                  className="flex min-h-[96px] items-center gap-3.5 rounded-[16px] border border-[#ece1d0] bg-[#fffefb] px-4 py-3.5 shadow-[0_8px_20px_rgba(96,70,40,0.08)]"
                >
                  <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center">
                    <CreditPackIcon packKey={pack.key} />
                  </div>
                  <div className="min-w-0 flex-1 self-start pt-0.5">
                    <p className="text-[17px] font-bold tracking-[0.06em] text-[#2b2620]">{pack.title}</p>
                    <p className="mt-1.5 text-[11px] font-medium leading-[1.6] tracking-[0.02em] text-[#7c7165]">
                      {pack.subtitle}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end justify-between gap-3 self-stretch py-0.5">
                    <ProductPriceLine listPriceNtd={listPriceNtd} priceNtd={priceNtd} />
                    <button
                      type="button"
                      disabled={packBusy}
                      onClick={() => void buyPack(pack.key, pack.creditLabel)}
                      className={cn(
                        'flex min-w-[86px] items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold tracking-[0.16em] transition active:scale-[0.98]',
                        packBusy
                          ? 'bg-[#ede4d8] text-[#b8a898]'
                          : 'bg-[#fffdf8] text-[#8a6a35] ring-1 ring-[#bd9a63] shadow-[0_2px_6px_rgba(140,102,52,0.14)]',
                      )}
                    >
                      購買
                      <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              )
            })}

            {gender === 'male' && (
              <div className="flex min-h-[96px] items-center gap-3.5 rounded-[16px] border border-[#ece1d0] bg-[#fffefb] px-4 py-3.5 shadow-[0_8px_20px_rgba(96,70,40,0.08)]">
                <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center">
                  <img
                    src="/assets/images/gold-crown-badge-v3.png"
                    alt=""
                    draggable={false}
                    className="h-[66px] w-[66px] object-contain drop-shadow-[0_5px_4px_rgba(88,57,24,0.22)]"
                  />
                </div>
                <div className="min-w-0 flex-1 self-start pt-0.5">
                  <p className="text-[17px] font-bold tracking-[0.06em] text-[#2b2620]">{CROWN_EFFECT_PRODUCT.title}</p>
                  <p className="mt-1.5 text-[11px] font-medium leading-[1.6] tracking-[0.02em] text-[#7c7165]">
                    {CROWN_EFFECT_PRODUCT.subtitle}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold leading-snug text-[#a5804a]">
                    {CROWN_EFFECT_PRODUCT.usageNote}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end justify-between gap-3 self-stretch py-0.5">
                  <ProductPriceLine
                    listPriceNtd={
                      pricing?.packs.crown_effect?.listPriceNtd ?? CROWN_EFFECT_PRODUCT.listPriceNtd
                    }
                    priceNtd={pricing?.packs.crown_effect?.priceNtd ?? CROWN_EFFECT_PRODUCT.listPriceNtd}
                  />
                  {crownEffectOwned ? (
                    <span className="rounded-full bg-[#f0ebe3] px-3.5 py-1.5 text-[11px] font-black text-[#9a8b7a] ring-1 ring-[#e8dfd3]">
                      已購買
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        paymentLoading ||
                        (paymentMode === 'tappay' && (!tapReady || Boolean(tapInitError)))
                      }
                      onClick={() => void buyCrownEffect()}
                      className={cn(
                        'flex min-w-[86px] items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold tracking-[0.16em] transition active:scale-[0.98]',
                        busy
                          ? 'bg-[#ede4d8] text-[#b8a898]'
                          : 'bg-[#fffdf8] text-[#8a6a35] ring-1 ring-[#bd9a63] shadow-[0_2px_6px_rgba(140,102,52,0.14)]',
                      )}
                    >
                      購買
                      <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-1.5 px-2 pt-3 pb-1">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#8f8478]" strokeWidth={2} />
            <p className="text-center text-[11px] font-medium tracking-[0.1em] text-[#8f8478]">
              全會員人工審核・安全真實・高品質交友環境
            </p>
          </div>

          {error && (
            <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-center text-sm font-semibold text-red-700 ring-1 ring-red-200">
              {error}
            </p>
          )}

          <div className="pb-[calc(env(safe-area-inset-bottom,0px)+10px)] text-center">
            <p className="text-[10px] leading-relaxed text-[#a09488]">
              繼續付款即表示您已閱讀並同意{' '}
              <button
                type="button"
                className="font-semibold text-[#9a743e] underline decoration-[#d4c4a8] underline-offset-2"
                onClick={() => setTermsOpen(true)}
              >
                服務條款
              </button>
              。
            </p>
            <p className="mt-1.5 text-[10px] font-medium text-[#a09488]">
              客服信箱：<a href={SUPPORT_MAILTO} className="text-[#9a743e]">{SUPPORT_EMAIL}</a>
            </p>
          </div>
        </div>
      </div>

      <TermsOfServiceModal open={termsOpen} onClose={() => setTermsOpen(false)} />
    </motion.div>
  )
}
