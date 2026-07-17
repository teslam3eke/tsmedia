import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Check,
  ChevronRight,
  Crown,
  Lock,
  MessageSquare,
  Pencil,
  LogOut,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { completeMonthlyMembership, getProfile } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import {
  isMembershipActive,
  MEMBERSHIP_LIST_PRICE_NTD,
} from '@/lib/membershipProducts'
import {
  fetchPublicPaymentPricing,
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
import FeedbackScreen from '@/screens/FeedbackScreen'
import { deleteAccount } from '@/lib/auth'

const TAPPAY_FIELD_PREFIX = 'membership-paywall-card'
const SERIF = '"Noto Serif TC", "Songti TC", "STSong", "Georgia", serif'

const VALUE_CARDS = [
  {
    key: 'sincerity',
    image: '/assets/images/membership-paywall-sincerity.png',
    title: '每一位會員，都付出了一樣的誠意。',
    text: '當每個人都願意投入，\n推銷、詐騙與免洗帳號自然大幅降低。',
  },
  {
    key: 'filter',
    image: '/assets/images/membership-paywall-filter.png',
    title: '付費，其實是在替自己過濾。',
    text: '願意投資自己的人，\n通常也更認真對待每一次相遇。',
  },
  {
    key: 'quality',
    image: '/assets/images/membership-paywall-quality.png',
    title: '我們在乎的不是數量而是品質。',
    text: '我們控管會員品質及男女比例 1:1，\n更高的回覆率及配對成功率，\n才是我們希望看見的。',
  },
] as const

const BENEFITS = ['探索所有會員', '無限制聊天', '拼圖完整解鎖', '專屬會員標示'] as const

export default function MembershipPaywallScreen({
  userId,
  gender,
  userEmail,
  onMembershipActive,
  onEditProfile,
  onSignOut,
}: {
  userId: string
  gender: 'male' | 'female'
  userEmail: string
  onMembershipActive: () => void
  onEditProfile: () => void
  onSignOut: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<string | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const [pricing, setPricing] = useState<PublicPaymentPricing | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()

  const { mode: paymentMode, loading: paymentLoading } = usePaymentProvider()

  const [tapReady, setTapReady] = useState(false)
  const [tapInitError, setTapInitError] = useState<string | null>(null)
  const [tpRef, setTpRef] = useState<TPDirectAPI | null>(null)

  const [holderName, setHolderName] = useState('')
  const [holderPhone, setHolderPhone] = useState('')
  const [holderEmail, setHolderEmail] = useState(userEmail)

  const monthlyListPrice = MEMBERSHIP_LIST_PRICE_NTD[gender]
  const monthlyPrice = pricing?.membership[gender].priceNtd ?? monthlyListPrice

  const reloadProfile = useCallback(async () => {
    if (paymentMode === 'ecpay') {
      const synced = await syncPendingEcpayOrders()
      if (synced.ok && synced.synced && synced.productType === 'membership') {
        setSubscriptionExpiresAt(synced.subscriptionExpiresAt ?? null)
        if (isMembershipActive(synced.subscriptionExpiresAt)) {
          onMembershipActive()
          return
        }
      }
    }
    const profile = await getProfile(userId)
    const expires = profile?.subscription_expires_at ?? null
    setSubscriptionExpiresAt(expires)
    if (isMembershipActive(expires)) {
      onMembershipActive()
    }
  }, [userId, paymentMode, onMembershipActive])

  useEffect(() => {
    void reloadProfile()
  }, [reloadProfile])

  useEffect(() => {
    let cancelled = false
    void fetchPublicPaymentPricing().then((next) => {
      if (!cancelled) setPricing(next)
    })
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

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = menuRef.current
      if (el && !el.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
    }
  }, [menuOpen])

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
    : '立即開始探索'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f8f2e9] text-[#302b27]"
    >
      <div
        className="relative z-10 flex-1 min-h-0 overflow-y-auto"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="relative mx-auto w-full max-w-[430px] pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
          {/* 意見反映：相對置中內容欄右上，桌機不會跑到視窗最右 */}
          <header className="absolute right-3 top-[calc(env(safe-area-inset-top,0px)+10px)] z-30 flex items-start">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium tracking-[0.08em] text-[#c9bba8] transition active:text-[#9a8b78]"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                意見反映
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.16 }}
                    role="menu"
                    className="absolute right-0 top-full z-20 mt-1.5 w-[188px] overflow-hidden rounded-2xl bg-white ring-1 ring-[#e8dfd3]"
                  >
                    {(
                      [
                        {
                          key: 'feedback',
                          label: '意見反映',
                          icon: MessageSquare,
                          danger: false,
                          onClick: () => {
                            setMenuOpen(false)
                            setShowFeedback(true)
                          },
                        },
                        {
                          key: 'edit',
                          label: '編輯個人資料',
                          icon: Pencil,
                          danger: false,
                          onClick: () => {
                            setMenuOpen(false)
                            onEditProfile()
                          },
                        },
                        {
                          key: 'logout',
                          label: '登出',
                          icon: LogOut,
                          danger: false,
                          onClick: () => {
                            setMenuOpen(false)
                            onSignOut()
                          },
                        },
                        {
                          key: 'delete',
                          label: '刪除帳號',
                          icon: Trash2,
                          danger: true,
                          onClick: () => {
                            setMenuOpen(false)
                            setDeleteError(null)
                            setShowDeleteConfirm(true)
                          },
                        },
                      ] as const
                    ).map((item, idx) => (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        onClick={item.onClick}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-[13px] font-semibold transition active:bg-[#f7f2ec]',
                          item.danger ? 'text-red-600' : 'text-[#4c443b]',
                          idx > 0 && 'border-t border-[#f0ebe3]',
                        )}
                      >
                        <item.icon className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2.2} />
                        {item.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </header>

          {/* 整頁延伸的金色光點背景（卡片區已清掉，避免與 HTML 重疊模糊） */}
          <img
            src="/assets/images/membership-paywall-background.png"
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-top"
            draggable={false}
          />

          {/* 預留 Logo／愛心／標題區，讓背景上半完整露出 */}
          <div className="relative z-10 aspect-[473/288] w-full" aria-hidden />

          <div className="relative z-10 space-y-2.5 px-5">
            {VALUE_CARDS.map(({ key, image, title, text }) => (
              <div
                key={key}
                className="flex items-center gap-2.5 rounded-[18px] border border-white/80 bg-white/80 px-2 py-2.5 backdrop-blur-[2px]"
              >
                <img
                  src={image}
                  alt=""
                  className="h-[78px] w-[78px] shrink-0 object-contain"
                  draggable={false}
                />
                <div className="min-w-0 flex-1 pr-1">
                  <p className="text-[13px] font-bold leading-[1.5] tracking-[0.02em] text-[#302a24]">
                    {title}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-[11px] font-medium leading-[1.65] tracking-[0.01em] text-[#544c44]">
                    {text}
                  </p>
                </div>
              </div>
            ))}

            {pricing?.promo && (
              <p className="rounded-2xl bg-[#fff8f0] px-4 py-2.5 text-center text-sm font-bold leading-snug text-[#8b6914] ring-1 ring-[#e8d5b5]">
                {pricing.promo.label}
              </p>
            )}

            <motion.section
              className="relative mt-3 overflow-hidden rounded-[20px] border-2 border-[#c69245] bg-[radial-gradient(circle_at_78%_18%,rgba(255,236,188,0.55),transparent_36%),linear-gradient(145deg,rgba(255,254,251,0.92)_0%,rgba(255,247,232,0.9)_52%,rgba(255,253,248,0.94)_100%)] px-5 pb-4 pt-6 backdrop-blur-[2px]"
              animate={
                prefersReducedMotion
                  ? { borderColor: '#c69245' }
                  : {
                      borderColor: ['#b77c2f', '#efd18e', '#a96d24', '#efd18e', '#b77c2f'],
                    }
              }
              transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <div className="pointer-events-none absolute inset-[3px] rounded-[15px] border border-[#e4bd72]/90" />
              <div className="pointer-events-none absolute left-3 top-3 h-6 w-6 border-l border-t border-[#bc8538]" />
              <div className="pointer-events-none absolute right-3 top-3 h-6 w-6 border-r border-t border-[#bc8538]" />
              <div className="pointer-events-none absolute bottom-3 left-3 h-6 w-6 border-b border-l border-[#bc8538]" />
              <div className="pointer-events-none absolute bottom-3 right-3 h-6 w-6 border-b border-r border-[#bc8538]" />
              <div className="pointer-events-none absolute left-1/2 top-1.5 flex -translate-x-1/2 items-center gap-1.5 text-[#bd873b]">
                <span className="h-px w-7 bg-gradient-to-r from-transparent to-[#c9974e]" />
                <span className="text-[8px]">✦</span>
                <span className="h-px w-7 bg-gradient-to-l from-transparent to-[#c9974e]" />
              </div>
              {!prefersReducedMotion && (
                <motion.div
                  className="pointer-events-none absolute -inset-y-10 w-16 -skew-x-[18deg] bg-gradient-to-r from-transparent via-white/50 to-transparent"
                  initial={{ x: -120 }}
                  animate={{ x: 480 }}
                  transition={{ duration: 1.7, repeat: Infinity, repeatDelay: 2.6, ease: 'easeInOut' }}
                />
              )}

              <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full border border-[#e7c98e] bg-gradient-to-b from-[#fffdf5] to-[#f6e3b8] px-2.5 py-1 text-[10px] font-bold text-[#8b5d20]">
                <motion.span
                  animate={prefersReducedMotion ? undefined : { y: [0, -2, 0], rotate: [0, -4, 4, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Crown className="h-3.5 w-3.5" fill="#b98f4e" />
                </motion.span>
                超值方案
              </div>

              <div className="relative z-10 flex items-end gap-3 pt-1">
                <div className="min-w-0 flex-1">
                  <h2
                    className="text-[30px] font-semibold leading-none text-[#24211d]"
                    style={{ fontFamily: SERIF }}
                  >
                    30 <span className="text-[17px]">天會員</span>
                  </h2>
                  <p className="mt-2 text-[13px] font-semibold tracking-[0.12em] text-[#b3833f]">
                    立即開啟探索
                  </p>
                  <ul className="mt-3 space-y-2">
                    {BENEFITS.map((text) => (
                      <li key={text} className="flex items-center gap-2">
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-b from-[#c9a05a] to-[#a67d42]">
                          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
                        </span>
                        <span className="text-[12px] font-medium text-[#453e36]">{text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex w-[158px] shrink-0 flex-col items-end pb-0.5">
                  <p className="whitespace-nowrap text-right leading-none">
                    {isPromoPriceActive(monthlyListPrice, monthlyPrice) && (
                      <span className="mr-1 text-[9px] text-[#a3968a] line-through">
                        NT$ {monthlyListPrice}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-[#5b5045]">NT$ </span>
                    <span
                      className="bg-gradient-to-b from-[#d5aa58] via-[#9f6827] to-[#714217] bg-clip-text text-[38px] text-transparent"
                      style={{ fontFamily: SERIF }}
                    >
                      {monthlyPrice}
                    </span>
                    <span className="ml-0.5 text-[10px] font-semibold text-[#4c443b]">/ 30天</span>
                  </p>
                  <motion.button
                    type="button"
                    disabled={subscribeDisabled}
                    onClick={handleSubscribe}
                    animate={
                      prefersReducedMotion || subscribeDisabled
                        ? undefined
                        : {
                            scale: [1, 1.03, 1],
                            filter: ['brightness(1)', 'brightness(1.12)', 'brightness(1)'],
                          }
                    }
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    className={cn(
                      'relative mt-3.5 flex w-full items-center justify-center gap-1 overflow-hidden rounded-full py-3.5 text-[14px] font-bold tracking-[0.08em] text-white',
                      subscribeDisabled
                        ? 'bg-[#c4b8a8]'
                        : 'border border-[#f1d89f] bg-gradient-to-b from-[#dfbd78] via-[#bd873d] to-[#8f5b23] ring-1 ring-[#9d6829]',
                    )}
                  >
                    {!prefersReducedMotion && !subscribeDisabled && (
                      <motion.span
                        className="pointer-events-none absolute inset-y-0 w-12 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent"
                        initial={{ x: -110 }}
                        animate={{ x: 210 }}
                        transition={{
                          duration: 1.15,
                          repeat: Infinity,
                          repeatDelay: 1.8,
                          ease: 'easeInOut',
                        }}
                      />
                    )}
                    <span className="relative z-10">{subscribeLabel}</span>
                    {!busy && <ChevronRight className="relative z-10 h-4 w-4" />}
                  </motion.button>
                  <p className="mt-2 w-full text-center text-[9px] text-[#8d8277]">
                    隨時取消，無綁約限制
                  </p>
                </div>
              </div>
            </motion.section>

            {paymentMode === 'tappay' && (
              <div className="mt-3 space-y-3 rounded-[20px] bg-white p-4 ring-1 ring-[#ede4d8]">
                <p className="text-[11px] font-bold tracking-wider text-[#9a8b7a]">信用卡安全付款</p>
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
                  className="w-full rounded-xl bg-[#faf7f3] px-3 py-3 text-sm font-semibold text-[#4a4035] outline-none ring-1 ring-[#e8dfd3]"
                />
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="手機（例：0912345678）"
                  value={holderPhone}
                  onChange={(e) => setHolderPhone(e.target.value)}
                  className="w-full rounded-xl bg-[#faf7f3] px-3 py-3 text-sm font-semibold text-[#4a4035] outline-none ring-1 ring-[#e8dfd3]"
                />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={holderEmail}
                  onChange={(e) => setHolderEmail(e.target.value)}
                  className="w-full rounded-xl bg-[#faf7f3] px-3 py-3 text-sm font-semibold text-[#4a4035] outline-none ring-1 ring-[#e8dfd3]"
                />
              </div>
            )}

            {error && (
              <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-center text-sm font-semibold text-red-700 ring-1 ring-red-200">
                {error}
              </p>
            )}
            {subscriptionExpiresAt && !isMembershipActive(subscriptionExpiresAt) && (
              <p className="text-center text-[11px] font-medium text-[#9a8b7a]">
                你的會員已到期，續購後即可繼續探索
              </p>
            )}

            <div className="flex items-center justify-center gap-1.5 pt-4">
              <Lock className="h-3 w-3 shrink-0 text-[#a89c8f]" strokeWidth={2} />
              <button
                type="button"
                onClick={() => setTermsOpen(true)}
                className="text-[10px] tracking-[0.04em] text-[#9c9185]"
              >
                付款即表示同意《服務條款》與《隱私政策》
              </button>
            </div>
          </div>
        </div>
      </div>

      <TermsOfServiceModal open={termsOpen} onClose={() => setTermsOpen(false)} />
      {showFeedback && <FeedbackScreen onClose={() => setShowFeedback(false)} />}

      {showDeleteConfirm &&
        createPortal(
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/50 px-5"
            onClick={() => {
              if (deleteBusy) return
              setShowDeleteConfirm(false)
              setDeleteError(null)
            }}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="w-full max-w-sm rounded-3xl bg-white p-5 ring-1 ring-slate-100"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="paywall-delete-account-title"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50">
                <Trash2 className="h-6 w-6 text-red-600" aria-hidden />
              </div>
              <h2 id="paywall-delete-account-title" className="text-lg font-black text-slate-900">
                確定刪除帳號？
              </h2>
              <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
                <p>刪除後將無法復原，包含個人資料、配對、聊天紀錄與認證資料都會一併移除。</p>
                <p className="font-semibold text-red-600">此操作無法撤銷。</p>
              </div>
              {deleteError ? (
                <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                  {deleteError}
                </p>
              ) : null}
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteError(null)
                  }}
                  className="flex-1 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-600 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={async () => {
                    setDeleteBusy(true)
                    setDeleteError(null)
                    const result = await deleteAccount()
                    setDeleteBusy(false)
                    if (!result.ok) {
                      setDeleteError(result.error)
                      return
                    }
                    setShowDeleteConfirm(false)
                    onSignOut()
                  }}
                  className="flex-1 rounded-2xl bg-red-600 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {deleteBusy ? '刪除中…' : '確定刪除'}
                </button>
              </div>
            </motion.div>
          </motion.div>,
          document.body,
        )}
    </motion.div>
  )
}
