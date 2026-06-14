import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, Crown, Heart, Sparkles, Eye, LayoutGrid } from 'lucide-react'
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

function ProductPriceLine({
  listPriceNtd,
  priceNtd,
  promoLabel,
  discountTenths,
}: {
  listPriceNtd: number
  priceNtd: number
  promoLabel?: string | null
  discountTenths?: number | null
}) {
  const showDiscount = isPromoPriceActive(listPriceNtd, priceNtd)
  return (
    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {showDiscount && (
        <span className="text-xs font-semibold text-slate-500 line-through">NT$ {listPriceNtd}</span>
      )}
      <span className="text-sm font-black text-amber-400">NT$ {priceNtd}</span>
      {showDiscount && discountTenths != null && (
        <span className="text-[10px] font-bold text-fuchsia-300">
          {promoLabel ? `${promoLabel} · ` : ''}
          特價 {formatDiscountTenthsZh(discountTenths)}
        </span>
      )}
    </p>
  )
}

function CreditPackIcon({ packKey }: { packKey: CreditPackKey }) {
  if (packKey === 'heart_5') {
    return <Heart className="h-5 w-5 text-rose-400" />
  }
  if (packKey === 'super_like_5') {
    return <Sparkles className="h-5 w-5 text-fuchsia-400" />
  }
  return <LayoutGrid className="h-5 w-5 text-sky-400" />
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
  const promoLabel = pricing?.promo?.label ?? null
  const promoDiscountTenths = pricing?.promo?.discountTenths ?? null
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
              {memberActive ? 'VIP 權益使用中' : '購買 30 天 VIP 月卡後可領每月贈禮與每日愛心'}
            </p>
          </div>

          <section>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">購買道具</p>
            {pricing?.promo && (
              <p className="mb-3 rounded-xl bg-fuchsia-500/10 px-3 py-2 text-[11px] font-semibold leading-snug text-fuchsia-200 ring-1 ring-fuchsia-400/20">
                {pricing.promo.label} · 全站 {formatDiscountTenthsZh(pricing.promo.discountTenths)}
              </p>
            )}
            <div className="space-y-3">
              {CREDIT_PACK_PRODUCTS.map((pack) => {
                const packPricing = pricing?.packs[pack.key]
                const listPriceNtd = packPricing?.listPriceNtd ?? pack.listPriceNtd
                const priceNtd = packPricing?.priceNtd ?? pack.listPriceNtd
                return (
                <div
                  key={pack.key}
                  className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                    <CreditPackIcon packKey={pack.key} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-slate-100">{pack.title}</p>
                    <p className="text-[11px] font-semibold text-slate-400">{pack.subtitle}</p>
                    <ProductPriceLine
                      listPriceNtd={listPriceNtd}
                      priceNtd={priceNtd}
                      promoLabel={promoLabel}
                      discountTenths={promoDiscountTenths}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      paymentLoading ||
                      (paymentMode === 'tappay' && (!tapReady || Boolean(tapInitError)))
                    }
                    onClick={() => void buyPack(pack.key, pack.creditLabel)}
                    className={cn(
                      'shrink-0 rounded-xl px-3 py-2 text-xs font-black transition active:scale-[0.98]',
                      busy ? 'bg-slate-700 text-slate-400' : 'bg-amber-500 text-slate-950',
                    )}
                  >
                    購買
                  </button>
                </div>
              )})}

              {gender === 'male' && (
                <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/30 to-orange-600/30">
                    <Crown className="h-5 w-5 text-amber-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-slate-100">{CROWN_EFFECT_PRODUCT.title}</p>
                    <p className="text-[11px] font-semibold text-slate-400">{CROWN_EFFECT_PRODUCT.subtitle}</p>
                    <p className="mt-1 text-[11px] font-semibold leading-snug text-amber-200/80">
                      {CROWN_EFFECT_PRODUCT.usageNote}
                    </p>
                    <ProductPriceLine
                      listPriceNtd={pricing?.packs.crown_effect?.listPriceNtd ?? CROWN_EFFECT_PRODUCT.listPriceNtd}
                      priceNtd={pricing?.packs.crown_effect?.priceNtd ?? CROWN_EFFECT_PRODUCT.listPriceNtd}
                      promoLabel={promoLabel}
                      discountTenths={promoDiscountTenths}
                    />
                  </div>
                  {crownEffectOwned ? (
                    <span className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-slate-300 ring-1 ring-white/15">
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
                        'shrink-0 rounded-xl px-3 py-2 text-xs font-black transition active:scale-[0.98]',
                        busy ? 'bg-slate-700 text-slate-400' : 'bg-amber-500 text-slate-950',
                      )}
                    >
                      購買
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          <section>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">30 天 VIP 月卡</p>
            <div className="flex justify-center">
              <div className="rounded-full bg-gradient-to-br from-amber-400 to-orange-600 p-3 shadow-lg shadow-amber-900/40">
                <Crown className="h-8 w-8 text-white" />
              </div>
            </div>
            <p className="mt-3 text-center text-xl font-black tracking-tight text-amber-400">
              {isPromoPriceActive(monthlyListPrice, monthlyPrice) && (
                <span className="mr-2 text-sm font-semibold text-slate-500 line-through">
                  NT$ {monthlyListPrice}
                </span>
              )}
              NT$ {monthlyPrice}／30 天
            </p>
            {isPromoPriceActive(monthlyListPrice, monthlyPrice) && promoDiscountTenths != null && (
              <p className="mt-1 text-center text-[11px] font-bold text-fuchsia-300">
                {promoLabel ? `${promoLabel} · ` : ''}
                特價 {formatDiscountTenthsZh(promoDiscountTenths)}
              </p>
            )}
            <p className="mt-1 text-center text-xs font-semibold text-slate-400">
              {gender === 'male' ? '男性 VIP' : '女性 VIP'} · 單次購買，到期需再購買（非自動續扣）
            </p>

            <ul className="mt-5 space-y-2.5">
              {[
                { icon: Heart, text: '每次購買即贈 5 顆愛心 + 3 次超級喜歡' },
                { icon: Eye, text: '每次購買即贈 20 次解除拼圖模糊' },
                { icon: Sparkles, text: 'VIP 會員每日額外增加 2 顆愛心（每晚 10 點換日）' },
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

          {paymentMode === 'tappay' && (
            <div className="space-y-3 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
              <p className="text-[11px] font-bold tracking-wider text-slate-500">信用卡（TapPay）</p>
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
        {paymentMode === 'ecpay' ? (
          <button
            type="button"
            disabled={busy || paymentLoading}
            onClick={() => void subscribeEcpay()}
            className={cn(
              'w-full rounded-2xl py-4 text-base font-black shadow-lg transition active:scale-[0.99]',
              busy || paymentLoading
                ? 'bg-slate-700 text-slate-400'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-900/30',
            )}
          >
            {busy ? '前往付款頁⋯' : `前往綠界付款 ${monthlyPrice} 元／30 天`}
          </button>
        ) : paymentMode === 'tappay' ? (
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
            {busy ? '付款處理中⋯' : `購買 30 天 VIP 月卡 ${monthlyPrice} 元`}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || paymentLoading}
            onClick={() => void subscribeMock()}
            className={cn(
              'w-full rounded-2xl py-4 text-base font-black shadow-lg transition active:scale-[0.99]',
              busy || paymentLoading
                ? 'bg-slate-700 text-slate-400'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-900/30',
            )}
          >
            {busy ? '處理中⋯' : `購買 30 天 VIP 月卡 ${monthlyPrice} 元（模擬）`}
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
        <p className="mt-4 text-center text-[11px] font-semibold text-slate-500">
          客服信箱：{' '}
          <a
            href="mailto:letmesaveyou@livemail.tw"
            className="text-amber-400/95 underline decoration-amber-400/50 underline-offset-2"
          >
            letmesaveyou@livemail.tw
          </a>
        </p>
      </div>

      <TermsOfServiceModal open={termsOpen} onClose={() => setTermsOpen(false)} />
    </motion.div>
  )
}
