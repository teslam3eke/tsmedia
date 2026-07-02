import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion, type TargetAndTransition } from 'framer-motion'
import type { User } from '@supabase/supabase-js'

import LandingScreen from '@/screens/LandingScreen'
import AuthScreen from '@/screens/AuthScreen'
import SecurityCheckScreen from '@/screens/SecurityCheckScreen'
import ProfileSetupScreen, { type ProfileSetupData } from '@/screens/ProfileSetupScreen'
import QuestionnaireScreen from '@/screens/QuestionnaireScreen'
import IdentityVerifyScreen from '@/screens/IdentityVerifyScreen'
import MainScreen, { type MainScreenTab } from '@/screens/MainScreen'
import TermsConsentScreen from '@/screens/TermsConsentScreen'
import IosSafariRequiredScreen from '@/screens/IosSafariRequiredScreen'
import ResetPasswordScreen from '@/screens/ResetPasswordScreen'
import MembershipPaymentDisclosureScreen from '@/screens/MembershipPaymentDisclosureScreen'
import MaintenanceScreen from '@/screens/MaintenanceScreen'
import StagingEnvBanner from '@/components/StagingEnvBanner'
import { isStagingAppEnv } from '@/lib/appEnv'
import { needsIosSafariBrowserGate } from '@/lib/authBrowser'
import { useAppPresenceHeartbeat } from '@/lib/appPresence'
import { useSiteMaintenance } from '@/hooks/useSiteMaintenance'

import { supabase, ensureConnectionWithBudget, repairAuthAfterResume, CONNECTION_REPAIR_EVENT, type ConnectionRepairDetail } from '@/lib/supabase'
import {
  resumeHardReloadDisabledGlobally,
  resumeHardReloadEnabled,
  resumeDesktopWindowBlurRepairLikely,
  RESUME_DESKTOP_WINDOW_BLUR_MIN_MS,
  RESUME_MIN_VISIBILITY_HIDDEN_MS,
  touchMediaPickerGraceSession,
  isWithinMediaPickerGracePeriod,
  windowBlurWakeLikelyForResumeReload,
  triggerResumeStylePageReload,
} from '@/lib/resumeHardReload'
import { acceptLatestTerms, hasAcceptedLatestTerms, upsertProfile, saveQuestionnaire, getProfile } from '@/lib/db'
import {
  signOut,
  consumeSupabaseAuthCallbackFromUrl,
  restorePersistedAuthSession,
  readSessionUserWithBudget,
  shouldShowIosSafariAuthGuide,
  markPasswordRecoveryPending,
  readPasswordRecoveryPending,
  readPasswordResetFlowStarted,
  clearPasswordResetFlowStarted,
  isOnPasswordRecoveryRoute,
} from '@/lib/auth'
import {
  hasPendingPaymentReturn,
  tryAlternateOriginForPaymentReturn,
} from '@/lib/ecpayCheckout'
import { needsPwaEncapsulationGate, readPwaStandaloneMode } from '@/lib/pwaEncapsulationGate'
import { PROFILE_PHOTO_MIN } from '@/lib/types'
import { isOnboardingFlowScreen, setOnboardingResumeProtect } from '@/lib/onboardingDraft'
import type { QuestionnaireEntry } from '@/lib/types'
import type { Question } from '@/utils/questions'
// profileSetupData is collected but used for future profile enrichment


type Screen =
  | 'splash'
  | 'landing'
  | 'membership-payment-info'
  | 'auth'
  | 'reset-password'
  | 'security-check'
  | 'terms-consent'
  | 'profile-setup'
  | 'questionnaire'
  | 'identity-verify'
  | 'main'

const SCREEN_ORDER: Screen[] = [
  'splash',
  'landing',
  'membership-payment-info',
  'auth',
  'reset-password',
  'security-check',
  'terms-consent',
  'profile-setup',
  'questionnaire',
  'identity-verify',
  'main',
]

const SLIDE: Record<'forward' | 'back', { initial: TargetAndTransition; exit: TargetAndTransition }> = {
  forward: { initial: { opacity: 0, x: 40 }, exit: { opacity: 0, x: -40 } },
  back:    { initial: { opacity: 0, x: -40 }, exit: { opacity: 0, x: 40 } },
}

const SESSION_LAST_MAIN_TAB_KEY = 'tm_last_main_tab_v1'

/** 網址 `?tab=` 優先；否則用 sessionStorage（整頁重載／桌機自動 refresh 後還原分頁）。 */
function readPreferredMainShellTab(): MainScreenTab | null {
  if (typeof window === 'undefined') return null
  try {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'messages') return 'matches'
    if (t === 'discover' || t === 'matches' || t === 'instant' || t === 'profile') return t
  } catch {
    /* ignore */
  }
  try {
    const t = sessionStorage.getItem(SESSION_LAST_MAIN_TAB_KEY)
    if (t === 'messages') return 'matches'
    if (t === 'discover' || t === 'matches' || t === 'instant' || t === 'profile') return t
  } catch {
    /* ignore */
  }
  return null
}

/** 曾進入主殼（`?tab=` 或 sessionStorage）；PWA 重載時可直進 main，避免 splash→landing 閃屏。 */
function hasMainShellSessionHint(): boolean {
  return readPreferredMainShellTab() != null
}

// ── Splash loader ─────────────────────────────────────────────────────────────
function SplashScreen({ subtitle }: { subtitle?: string }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-[#0f172a] px-6 text-center">
      <motion.div
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        className="text-white font-bold text-2xl tracking-tight"
        style={{ letterSpacing: '-0.04em' }}
      >
        tsMedia
      </motion.div>
      {subtitle ? (
        <p className="max-w-xs text-sm font-medium text-white/70">{subtitle}</p>
      ) : null}
    </div>
  )
}

export default function App() {
  const [screen, setScreen]     = useState<Screen>('splash')
  const [prevScreen, setPrev]   = useState<Screen>('splash')
  const [user, setUser]         = useState<User | null>(null)
  const [authReady, setReady]   = useState(false)

  const [, setQuestionnaireEntries] = useState<QuestionnaireEntry[]>([])
  const [, setProfileSetupData] = useState<ProfileSetupData | null>(null)
  const [userGender, setUserGender] = useState<'male' | 'female'>('male')
  const [currentProfileName, setCurrentProfileName] = useState<string | null>(null)
  const [termsBusy, setTermsBusy] = useState(false)
  const [termsError, setTermsError] = useState<string | undefined>()
  /** Supabase／iOS 連線自助修復訊息（見 `ensureConnection`） */
  const [connectionBannerMsg, setConnectionBannerMsg] = useState<string | null>(null)
  /** 進入主畫面時預設分頁：生活照未達標時強制「我的」以便上傳 */
  const [mainInitialTab, setMainInitialTab] = useState<MainScreenTab>('discover')
  /** 職業 submitted 等待時從驗證頁返回編輯資料／問卷 */
  const [verifyWaitRevisit, setVerifyWaitRevisit] = useState(false)
  /** iOS 非 Safari 開啟 PKCE 確認連結，或換券失敗 */
  const [authSafariExchangeFailed, setAuthSafariExchangeFailed] = useState(false)
  /** 信箱連結換券失敗時顯示於 landing */
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null)
  const screenRef = useRef(screen)
  screenRef.current = screen
  const userRef = useRef(user)
  userRef.current = user
  const paymentReturnGraceUntilRef = useRef(
    typeof window !== 'undefined' && hasPendingPaymentReturn() ? Date.now() + 15_000 : 0,
  )
  const [paymentReturnRecoveryExhausted, setPaymentReturnRecoveryExhausted] = useState(false)
  const routeSignedInUserFlightRef = useRef<Promise<void> | null>(null)

  const siteMaintenance = useSiteMaintenance()

  /** 登入後心跳：認證通過推播略過前景 PWA（見 migration 117） */
  useAppPresenceHeartbeat(siteMaintenance.maintenance ? undefined : user?.id)

  /** 全站維護：清 session，避免舊登入狀態繞過閘門 */
  useEffect(() => {
    if (!siteMaintenance.maintenance) return
    void signOut()
    setUser(null)
  }, [siteMaintenance.maintenance])

  const getActiveUser = async () => {
    if (user) return user
    const { data } = await supabase.auth.getUser()
    return data.user ?? null
  }

  /** 男性須生活照齊全且職業驗證 approved 才可進探索；submitted／rejected／pending 皆須留 onboarding。 */
  const maleNeedsIdentityVerify = (profile: import('@/lib/types').ProfileRow | null) =>
    Boolean(
      profile?.gender === 'male'
      && (!profileHasMinPhotos(profile) || profile.verification_status !== 'approved'),
    )

  const profileHasMinPhotos = (profile: import('@/lib/types').ProfileRow | null) =>
    (profile?.photo_urls ?? []).filter(Boolean).length >= PROFILE_PHOTO_MIN

  /** 女生須先完成生活照（使用 Identity 流程中的「生活照上傳」步驟） */
  const femaleNeedsLifePhotoOnboarding = (profile: import('@/lib/types').ProfileRow | null) =>
    Boolean(profile?.gender === 'female' && !profileHasMinPhotos(profile))

  const securityOkStorageKey = (userId: string) => `tm_security_ok_v1_${userId}`
  const readSecurityOnboardingDone = (userId: string) => {
    try {
      return localStorage.getItem(securityOkStorageKey(userId)) === '1'
    } catch {
      return false
    }
  }
  const writeSecurityOnboardingDone = (userId: string) => {
    try {
      localStorage.setItem(securityOkStorageKey(userId), '1')
    } catch {
      /* private mode */
    }
  }

  const canEnterMainShell = (
    profile: import('@/lib/types').ProfileRow | null,
    opts?: { devBypassMaleVerify?: boolean },
  ) => {
    if (
      profile &&
      maleNeedsIdentityVerify(profile) &&
      !(import.meta.env.DEV && opts?.devBypassMaleVerify)
    ) {
      return false
    }
    if (profile && femaleNeedsLifePhotoOnboarding(profile)) return false
    return true
  }

  const launchMainFromProfile = (
    profile: import('@/lib/types').ProfileRow | null,
    opts?: { devBypassMaleVerify?: boolean },
  ) => {
    if (needsIosSafariBrowserGate()) return
    if (!canEnterMainShell(profile, opts)) {
      go('identity-verify')
      return
    }
    const tabHint = readPreferredMainShellTab()
    if (!profile) {
      setMainInitialTab(tabHint ?? 'discover')
      go('main')
      return
    }
    if (!profileHasMinPhotos(profile)) {
      setMainInitialTab('profile')
      go('main')
      return
    }
    setMainInitialTab(tabHint ?? 'discover')
    go('main')
  }

  // After security check, decide where to go based on profile completeness.
  const routeAfterSecurityCheck = (
    profile: import('@/lib/types').ProfileRow | null,
    userId: string,
  ) => {
    if (needsIosSafariBrowserGate()) return
    if (!hasAcceptedLatestTerms(profile)) {
      /** 付費返回／主殼已開：getProfile 暫時 null 勿誤判成未同意條款 */
      if (
        !profile &&
        (readSecurityOnboardingDone(userId) ||
          screenRef.current === 'main' ||
          hasPendingPaymentReturn())
      ) {
        launchMainFromProfile(null)
        return
      }
      return go('terms-consent')
    }
    if (!profile?.name) return go('profile-setup')
    setCurrentProfileName(profile.name)
    if (profile.gender) setUserGender(profile.gender)
    if (!profile.questionnaire || (profile.questionnaire as unknown[]).length === 0) return go('questionnaire')
    if (femaleNeedsLifePhotoOnboarding(profile)) return go('identity-verify')
    if (maleNeedsIdentityVerify(profile)) return go('identity-verify')
    launchMainFromProfile(profile)
  }

  // 首次登入仍走安全頁；iOS Safari 分頁每次皆須封裝引導；其餘裝置看過一次後略過。
  const routeByProfile = (profile: import('@/lib/types').ProfileRow | null, userId: string) => {
    if (needsIosSafariBrowserGate()) return
    if (profile?.gender) setUserGender(profile.gender)
    if (profile?.name) setCurrentProfileName(profile.name)
    if (needsPwaEncapsulationGate()) {
      go('security-check')
      return
    }
    if (readSecurityOnboardingDone(userId)) {
      routeAfterSecurityCheck(profile, userId)
      return
    }
    go('security-check')
  }

  const routeAfterTermsConsent = (profile: import('@/lib/types').ProfileRow | null) => {
    if (!profile?.name) return go('profile-setup')
    setCurrentProfileName(profile.name)
    if (profile.gender) setUserGender(profile.gender)
    if (!profile.questionnaire || (profile.questionnaire as unknown[]).length === 0) return go('questionnaire')
    if (femaleNeedsLifePhotoOnboarding(profile)) return go('identity-verify')
    if (maleNeedsIdentityVerify(profile)) return go('identity-verify')
    launchMainFromProfile(profile)
  }

  useEffect(() => {
    const listener: EventListener = (e: Event) => {
      const d = (e as CustomEvent<ConnectionRepairDetail>).detail
      if (d.phase === 'start') {
        if (screen === 'splash' || screen === 'landing') return
        setConnectionBannerMsg(d.message)
      } else if (d.phase === 'success') setConnectionBannerMsg(null)
      else setConnectionBannerMsg(d.message)
    }
    window.addEventListener(CONNECTION_REPAIR_EVENT, listener)
    return () => window.removeEventListener(CONNECTION_REPAIR_EVENT, listener)
  }, [screen])

  /** 註冊／填資料流程：回前景只做連線修復，禁止整頁 reload 清掉草稿。 */
  useEffect(() => {
    setOnboardingResumeProtect(isOnboardingFlowScreen(screen))
    return () => setOnboardingResumeProtect(false)
  }, [screen])

  // ── iOS PWA layout recalc hack ────────────────────────────────────
  // On cold-start, iOS PWA occasionally renders with a stale viewport
  // (phantom URL-bar reservation). Forcing a 1px scroll after mount
  // makes WebKit re-layout and reclaim that space.
  useEffect(() => {
    const isIosPwa =
      window.matchMedia('(display-mode: standalone)').matches &&
      /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase())
    if (isIosPwa) {
      const t = setTimeout(() => window.scrollTo(0, 1), 100)
      return () => clearTimeout(t)
    }
  }, [])

  // ── visualViewport → --app-height (main screen only) ──────────────
  // This fix is specifically for the logged-in app shell. If we keep it
  // enabled on landing/auth flows, their normal page scrolling gets mistaken
  // for iOS keyboard-avoidance and we end up snapping the document back to 0,
  // which feels like the landing page "jumps" while scrolling.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    if (screen !== 'main') {
      document.documentElement.style.removeProperty('--app-height')
      return
    }

    const update = () => {
      // 切回前景瞬間 vv.height 偶為 0／極小，會把主殼壓扁且觸控區錯位。
      const raw = vv.height
      const fallback = window.innerHeight || document.documentElement.clientHeight || 600
      const h = raw > 96 ? raw : fallback
      document.documentElement.style.setProperty('--app-height', `${h}px`)
      // Additionally, forcibly un-scroll the document. While typing, iOS
      // likes to scroll html/body to keep the caret on-screen — since our
      // container already matches the visible viewport, any such scroll
      // is pure garbage and visually "flies" the content up.
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0)
      }
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)

    // iOS PWA：切到其他 App 再回來時，visualViewport / 捲動偶爾卡住，主螢幕高度與觸控區會錯位。
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      update()
      requestAnimationFrame(() => {
        update()
        window.dispatchEvent(new Event('resize'))
      })
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('pageshow', onResume)

    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('pageshow', onResume)
      document.documentElement.style.removeProperty('--app-height')
    }
  }, [screen])

  /**
   * 主殼：回前景若 transport 僵死 → 整頁重載。
   * - 手機／PWA：document.visibility + pagehide 等（短閾值），另 iOS／standalone 加 blur／focus。
   * - 一般桌機「瀏覽器分頁」：不註冊 visibility（避免切分頁狂重整），改視窗 blur→focus 長閾值（切到其他 App 再回來）。
   * 已通過安全頁者有 localStorage，`reload` 不會再卡住安全動畫。`?tab=` 或由 MainScreen 寫入的 session 可還原分頁。
   * `?noHardResume=1` 停用（sessionStorage）。
   */
  const resumeHardReloadMainRef = useRef(false)
  useEffect(() => {
    resumeHardReloadMainRef.current = screen === 'main' && Boolean(user?.id)
  }, [screen, user?.id])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const useVisibilityResume = resumeHardReloadEnabled()
    const useDesktopBlurRepair = resumeDesktopWindowBlurRepairLikely()
    if (!useVisibilityResume && !useDesktopBlurRepair) return

    const MIN_VISIBILITY_HIDDEN_MS = RESUME_MIN_VISIBILITY_HIDDEN_MS
    const dbg =
      new URLSearchParams(window.location.search).get('debugHardResume') === '1'
    const log = (...a: unknown[]) => {
      if (dbg) console.info('[hardResume]', ...a)
    }

    let hiddenAt: number | null = null
    let desktopBlurAt: number | null = null
    let reloading = false

    const reload = () => {
      if (reloading) return
      if (resumeHardReloadDisabledGlobally()) {
        log('reload skipped: disabled (noHardResume / sessionStorage)')
        return
      }
      if (!resumeHardReloadMainRef.current) {
        log('reload skipped: not main or no user id')
        return
      }
      if (isWithinMediaPickerGracePeriod()) {
        log('reload skipped: media picker grace')
        return
      }
      log('reload()')
      reloading = true
      if (!triggerResumeStylePageReload()) reloading = false
    }

    const markHiddenVisibility = () => {
      hiddenAt = Date.now()
      log('markHidden (mobile/PWA)', document.visibilityState)
    }

    const tryReloadAfterWakeVisibility = () => {
      if (!useVisibilityResume || !resumeHardReloadMainRef.current) {
        log('tryWake vis: skip')
        return
      }
      if (document.visibilityState !== 'visible') {
        log('tryWake vis: skip — not visible', document.visibilityState)
        return
      }
      if (hiddenAt == null) {
        log('tryWake vis: skip — never marked')
        return
      }
      const elapsed = Date.now() - hiddenAt
      hiddenAt = null
      log('tryWake vis', { elapsed, min: MIN_VISIBILITY_HIDDEN_MS })
      if (elapsed < MIN_VISIBILITY_HIDDEN_MS) return
      reload()
    }

    const onPageShow = (ev: Event) => {
      if (!useVisibilityResume || !resumeHardReloadMainRef.current) return
      const e = ev as PageTransitionEvent
      if (e.persisted) {
        log('pageshow persisted → reload')
        reload()
        return
      }
      tryReloadAfterWakeVisibility()
    }

    const onVisibility = () => {
      if (!useVisibilityResume) return
      if (document.visibilityState === 'hidden') markHiddenVisibility()
      else tryReloadAfterWakeVisibility()
    }

    const winWakeBlur = windowBlurWakeLikelyForResumeReload()

    const finalizeDesktopBlurReload = () => {
      if (!useDesktopBlurRepair || winWakeBlur) return
      if (!resumeHardReloadMainRef.current) {
        desktopBlurAt = null
        return
      }
      if (resumeHardReloadDisabledGlobally()) {
        desktopBlurAt = null
        return
      }
      if (isWithinMediaPickerGracePeriod()) {
        desktopBlurAt = null
        return
      }
      if (document.visibilityState !== 'visible') {
        desktopBlurAt = null
        return
      }
      if (desktopBlurAt == null) return
      const elapsed = Date.now() - desktopBlurAt
      desktopBlurAt = null
      log('desktop window blur→focus', { elapsed, min: RESUME_DESKTOP_WINDOW_BLUR_MIN_MS })
      if (elapsed < RESUME_DESKTOP_WINDOW_BLUR_MIN_MS) return
      reload()
    }

    const onWinBlur = () => {
      if (winWakeBlur) markHiddenVisibility()
      else if (useDesktopBlurRepair) {
        desktopBlurAt = Date.now()
        log('desktop markBlur')
      }
    }
    const onWinFocus = () => {
      if (winWakeBlur) tryReloadAfterWakeVisibility()
      finalizeDesktopBlurReload()
    }

    if (useVisibilityResume) {
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pageshow', onPageShow)
      window.addEventListener('pagehide', markHiddenVisibility)
      document.addEventListener('freeze', markHiddenVisibility)
      document.addEventListener('resume', tryReloadAfterWakeVisibility)
    }

    if (winWakeBlur || useDesktopBlurRepair) {
      window.addEventListener('blur', onWinBlur)
      window.addEventListener('focus', onWinFocus)
    }

    return () => {
      if (useVisibilityResume) {
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('pageshow', onPageShow)
        window.removeEventListener('pagehide', markHiddenVisibility)
        document.removeEventListener('freeze', markHiddenVisibility)
        document.removeEventListener('resume', tryReloadAfterWakeVisibility)
      }
      if (winWakeBlur || useDesktopBlurRepair) {
        window.removeEventListener('blur', onWinBlur)
        window.removeEventListener('focus', onWinFocus)
      }
    }
  }, [])

  /** 選相簿／拍照會長 blur，touch 先進 sessionStorage grace，避免 resume hard reload 截斷上傳。 */
  useEffect(() => {
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target
      if (!(t instanceof Element)) return
      if (t.matches('input[type=file]')) {
        touchMediaPickerGraceSession()
        return
      }
      const lab = t.closest('label')
      const inner = lab?.querySelector('input[type=file]')
      if (inner instanceof HTMLInputElement) touchMediaPickerGraceSession()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  // ── Lock document scroll while on the main (logged-in) screen ─────
  // Chat inputs trigger iOS keyboard-avoidance which scrolls <html>/<body>
  // even though our container is already sized to visualViewport. Locking
  // scroll at the document level guarantees nothing flies up mid-typing.
  useEffect(() => {
    if (screen !== 'main') return
    const body = document.body
    const html = document.documentElement
    const prevBody = body.style.overflow
    const prevHtml = html.style.overflow
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'

    // Belt-and-braces: if iOS still manages to scroll the document (e.g.
    // during IME composition), snap it back instantly.
    const snapBack = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0)
      }
    }
    window.addEventListener('scroll', snapBack, { passive: true })
    return () => {
      body.style.overflow = prevBody
      html.style.overflow = prevHtml
      window.removeEventListener('scroll', snapBack)
    }
  }, [screen])

  const go = useCallback((next: Screen) => {
    if (needsIosSafariBrowserGate()) return
    setPrev((prev) => prev)
    setScreen((prev) => { setPrev(prev); return next })
  }, [])

  const routeSignedInUser = useCallback(async (u: User) => {
    if (routeSignedInUserFlightRef.current) {
      await routeSignedInUserFlightRef.current
      return
    }

    const flight = (async () => {
      const paymentReturn = hasPendingPaymentReturn()
      const onboarded =
        !needsPwaEncapsulationGate() &&
        readSecurityOnboardingDone(u.id) &&
        !readPasswordRecoveryPending()

      if (onboarded && (paymentReturn || hasMainShellSessionHint())) {
        launchMainFromProfile(null)
        return
      }

      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        await Promise.race([
          (async () => {
            await repairAuthAfterResume()
            await ensureConnectionWithBudget(paymentReturn ? 4_000 : 5_500)
          })(),
          new Promise<void>((resolve) =>
            globalThis.setTimeout(resolve, paymentReturn ? 5_000 : 6_000),
          ),
        ])
      }

      const profile = await Promise.race([
        getProfile(u.id),
        new Promise<Awaited<ReturnType<typeof getProfile>>>((resolve) =>
          globalThis.setTimeout(() => resolve(null), paymentReturn ? 6_000 : 10_000),
        ),
      ])

      routeByProfile(profile, u.id)
    })()

    routeSignedInUserFlightRef.current = flight
    try {
      await flight
    } finally {
      if (routeSignedInUserFlightRef.current === flight) {
        routeSignedInUserFlightRef.current = null
      }
    }
  }, [go]) // eslint-disable-line react-hooks/exhaustive-deps

  const routeToPasswordRecovery = useCallback(() => {
    markPasswordRecoveryPending()
    clearPasswordResetFlowStarted()
    go('reset-password')
  }, [go])

  // ── Auth init: read existing session first, then listen for changes ─────────
  useEffect(() => {
    let cancelled = false
    const pendingPaymentReturn = hasPendingPaymentReturn()

    const routeSignedInUserScoped = async (u: User) => {
      await routeSignedInUser(u)
    }

    const maybeRoutePaymentReturnSession = async (u: User | null, event: string) => {
      if (!pendingPaymentReturn || !u) return
      if (event === 'SIGNED_OUT') return
      if (needsRecoveryScreen()) return
      const onGuestScreen =
        screenRef.current === 'splash' ||
        screenRef.current === 'landing' ||
        screenRef.current === 'auth'
      if (
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        (event === 'INITIAL_SESSION' && onGuestScreen)
      ) {
        await routeSignedInUserScoped(u)
      }
    }

    const needsRecoveryScreen = () =>
      readPasswordRecoveryPending() ||
      readPasswordResetFlowStarted() ||
      isOnPasswordRecoveryRoute()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return
      const nextUser = session?.user ?? null
      if (
        !(event === 'INITIAL_SESSION' && pendingPaymentReturn && !nextUser && userRef.current)
      ) {
        setUser(nextUser)
      }
      if (needsIosSafariBrowserGate()) return
      if (event === 'PASSWORD_RECOVERY') {
        routeToPasswordRecovery()
        return
      }
      if (event === 'SIGNED_OUT') {
        if (Date.now() < paymentReturnGraceUntilRef.current) return
        go('landing')
        return
      }
      await maybeRoutePaymentReturnSession(nextUser ?? userRef.current, event)
      /** 首屏路由由下方 init 負責；勿在此處 SIGNED_IN → main，會搶在 recovery 判斷之前。 */
    })

    void (async () => {
      /** main.tsx 已先換券；此處再 await 一次作 idempotent 保險 */
      const authConsume = await consumeSupabaseAuthCallbackFromUrl()
      if (cancelled) return

      if (
        authConsume.outcome === 'deferred_ios_non_safari' ||
        authConsume.outcome === 'failed' ||
        shouldShowIosSafariAuthGuide()
      ) {
        setAuthSafariExchangeFailed(authConsume.outcome === 'failed')
        if (authConsume.outcome === 'failed' && !needsIosSafariBrowserGate()) {
          setAuthCallbackError('連結已失效或無法完成驗證，請重新申請重設密碼，或改用 Safari 開啟信件連結。')
          go('landing')
        }
        setReady(true)
        return
      }

      if (authConsume.outcome === 'session' && authConsume.passwordRecovery) {
        markPasswordRecoveryPending()
        clearPasswordResetFlowStarted()
      }

      let u = await readSessionUserWithBudget(2_500)
      if (cancelled) return

      /** 綠界全頁跳轉回站：main.tsx boot 已試過 restore */
      if (!u && pendingPaymentReturn) {
        u = await restorePersistedAuthSession(2_500)
      }

      if (cancelled) return
      setUser(u)

      if (needsRecoveryScreen()) {
        if (u) markPasswordRecoveryPending()
        routeToPasswordRecovery()
        setReady(true)
        return
      }

      /** 先解除 splash 鎖，避免 getProfile／ensure 卡住時整頁像當機 */
      setReady(true)

      if (u) {
        void routeSignedInUserScoped(u)
      } else if (pendingPaymentReturn) {
        if (tryAlternateOriginForPaymentReturn()) return
      } else {
        go('landing')
      }
    })()

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [go, routeToPasswordRecovery, routeSignedInUser]) // eslint-disable-line react-hooks/exhaustive-deps

  /** authReady 後若仍停在 splash（早期 return 漏設 screen）→ 避免空白頁；已登入勿誤跳 landing。 */
  useEffect(() => {
    if (!authReady || screen !== 'splash') return
    if (readPasswordRecoveryPending() || readPasswordResetFlowStarted() || isOnPasswordRecoveryRoute()) {
      routeToPasswordRecovery()
      return
    }
    if (hasPendingPaymentReturn() && !paymentReturnRecoveryExhausted && !user?.id) return
    if (user?.id) {
      void routeSignedInUser(user)
      return
    }
    go('landing')
  }, [authReady, screen, go, routeToPasswordRecovery, user?.id, paymentReturnRecoveryExhausted, routeSignedInUser]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 付款返回：僅在尚未登入的 guest 畫面還原 session（勿干擾 security-check／onboarding） */
  useEffect(() => {
    if (!authReady || !hasPendingPaymentReturn()) return
    if (paymentReturnRecoveryExhausted) return
    if (screen === 'main') return
    const guestOnly =
      screen === 'splash' || screen === 'landing' || screen === 'auth'
    if (!guestOnly) return
    if (user?.id) return

    let cancelled = false
    let attempts = 0
    const maxAttempts = 4
    let ticking = false

    const finishExhausted = () => {
      if (cancelled) return
      setPaymentReturnRecoveryExhausted(true)
      go('landing')
    }

    const tryRoute = async (u: User) => {
      setUser(u)
      const profile = await getProfile(u.id)
      if (cancelled) return
      routeByProfile(profile, u.id)
    }

    const tick = async () => {
      if (cancelled || ticking || screenRef.current === 'main') return
      ticking = true
      try {
        if (userRef.current?.id) {
          await tryRoute(userRef.current)
          return
        }

        const u = await restorePersistedAuthSession(2_500)
        if (cancelled) return
        if (u) {
          await tryRoute(u)
          return
        }

        attempts += 1
        if (attempts === 2 && tryAlternateOriginForPaymentReturn()) return

        if (attempts >= maxAttempts) finishExhausted()
      } finally {
        ticking = false
      }
    }

    void tick()
    const intervalId = window.setInterval(() => void tick(), 2_000)
    const hardCapId = window.setTimeout(finishExhausted, 12_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.clearTimeout(hardCapId)
    }
  }, [authReady, screen, go, paymentReturnRecoveryExhausted]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 付款返回且 user 已還原：勿卡在 splash 等 getProfile */
  useEffect(() => {
    if (!authReady || !user?.id || !hasPendingPaymentReturn()) return
    if (screen === 'main') return
    void routeSignedInUser(user)
  }, [authReady, user?.id, screen, routeSignedInUser])

  /** 付費返回 splash 逾時保底：仍進主殼，探索／個資由 MainScreen 前景 reload 補 */
  useEffect(() => {
    if (!authReady || screen !== 'splash' || !hasPendingPaymentReturn()) return
    const uid = user?.id
    if (!uid) return
    if (!readSecurityOnboardingDone(uid) || readPasswordRecoveryPending()) return

    const t = window.setTimeout(() => {
      if (screenRef.current !== 'splash') return
      go('main')
    }, 10_000)

    return () => window.clearTimeout(t)
  }, [authReady, screen, user?.id, go])

  /** auth init 異常時勿永遠停在藍底 splash */
  useEffect(() => {
    if (authReady) return
    const t = window.setTimeout(() => setReady(true), 9_000)
    return () => window.clearTimeout(t)
  }, [authReady])

  const handleSignOut = async () => {
    setVerifyWaitRevisit(false)
    await signOut()
    setUser(null)
    go('landing')
  }

  const direction = SCREEN_ORDER.indexOf(screen) >= SCREEN_ORDER.indexOf(prevScreen) ? 'forward' : 'back'
  const anim = SLIDE[direction]
  const isMainScreen = screen === 'main'
  const motionInitial: TargetAndTransition = isMainScreen ? { opacity: 0 } : anim.initial
  const motionAnimate: TargetAndTransition = isMainScreen ? { opacity: 1 } : { opacity: 1, x: 0 }
  const motionExit: TargetAndTransition = isMainScreen ? { opacity: 0 } : anim.exit

  // ── ProfileSetup complete → save basic profile ───────────────
  const handleProfileSetupComplete = async (data: ProfileSetupData) => {
    setProfileSetupData(data)
    setCurrentProfileName(data.name)
    setUserGender(data.gender)
    const activeUser = await getActiveUser()
    if (activeUser) {
      await upsertProfile({
        userId: activeUser.id,
        name: data.name,
        nickname: data.nickname,
        gender: data.gender,
        interests: data.interests,
        bio: data.bio,
        workRegion: data.workRegion || null,
        homeRegion: data.homeRegion || null,
        preferredRegion: data.preferredRegion || null,
      })
    }
    go('questionnaire')
  }

  // ── Questionnaire complete → save answers ─────────────────────
  const handleQuestionnaireComplete = async (
    answers: Record<number, string>,
    questions: Question[],
  ) => {
    const entries: QuestionnaireEntry[] = questions.map((q) => ({
      id: q.id,
      category: q.category,
      text: q.text,
      answer: answers[q.id] ?? '',
    }))
    setQuestionnaireEntries(entries)
    const activeUser = await getActiveUser()
    if (activeUser) {
      await saveQuestionnaire(activeUser.id, entries)
    }
    // 女生：僅生活照（無 onboarding 收入頁）；男生：職業驗證等（皆走 Identity 流程）
    go('identity-verify')
  }

  const handleTermsAccept = async () => {
    setTermsBusy(true)
    setTermsError(undefined)
    try {
      const activeUser = await getActiveUser()
      if (!activeUser) {
        go('auth')
        return
      }
      const result = await acceptLatestTerms(activeUser.id)
      if (!result.ok) {
        setTermsError(result.error ?? '同意紀錄儲存失敗，請稍後再試。')
        return
      }
      const profile = await getProfile(activeUser.id)
      routeAfterTermsConsent(profile)
    } finally {
      setTermsBusy(false)
    }
  }

  const connectivityToast =
    connectionBannerMsg && screen !== 'landing' ? (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-[99990] flex justify-center px-4"
      >
        <span className="max-w-[min(100%-2rem,24rem)] rounded-2xl bg-slate-900/92 px-4 py-2.5 text-center text-xs font-semibold tracking-wide text-white shadow-xl ring-1 ring-white/10">
          {connectionBannerMsg}
        </span>
      </div>
    ) : null

  const stagingBanner = isStagingAppEnv() ? <StagingEnvBanner /> : null

  const paymentReturnRecovering =
    hasPendingPaymentReturn() &&
    !paymentReturnRecoveryExhausted &&
    !user?.id &&
    screen !== 'main'

  if (siteMaintenance.loading) {
    return (
      <>
        {stagingBanner}
        <div className="min-h-dvh bg-white flex flex-col items-center justify-center px-6 text-slate-900">
          <p className="text-sm font-semibold text-slate-500">載入中…</p>
        </div>
      </>
    )
  }

  if (siteMaintenance.maintenance) {
    return <MaintenanceScreen />
  }

  if (!authReady || paymentReturnRecovering) {
    return (
      <>
        {stagingBanner}
        <SplashScreen
        subtitle={
          paymentReturnRecovering
            ? '付款完成，正在恢復登入…'
            : hasPendingPaymentReturn()
              ? '付款完成，正在載入…'
              : undefined
        }
      />
      </>
    )
  }

  if (needsIosSafariBrowserGate()) {
    return (
      <>
        {stagingBanner}
        <IosSafariRequiredScreen exchangeFailed={authSafariExchangeFailed} />
      </>
    )
  }

  /** splash 無對應 AnimatePresence 分支；authReady 後勿留空白頁 */
  if (screen === 'splash') {
    return (
      <>
        {stagingBanner}
        <SplashScreen
        subtitle={
          hasPendingPaymentReturn()
            ? '付款完成，正在進入…'
            : '載入中…'
        }
      />
      </>
    )
  }

  // Main screen is rendered OUTSIDE AnimatePresence/motion.div so it is not
  // inside any transformed containing block. `position: fixed; inset: 0`
  // pins it to the visual viewport edges — guaranteed no bottom gap on iOS
  // PWA cold start (the dvh / fill-available bugs don't apply).
  if (screen === 'main') {
    return (
      <>
        {stagingBanner}
        {connectivityToast}
        <div
          className="app-container flex flex-col bg-white overflow-hidden"
          style={{ height: 'var(--app-height, 100dvh)' }}
        >
          <MainScreen
            user={user}
            initialDiscoverGender={userGender}
            initialTab={mainInitialTab}
            onSignOut={() => go('landing')}
          />
        </div>
      </>
    )
  }

  return (
    <>
      {stagingBanner}
      {connectivityToast}
      <AnimatePresence mode="wait">
      <motion.div
        key={screen}
        initial={motionInitial}
        animate={motionAnimate}
        exit={motionExit}
        transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        style={{ minHeight: '100dvh' }}
      >
        {screen === 'landing' && (
          <LandingScreen
            authNotice={
              paymentReturnRecoveryExhausted && hasPendingPaymentReturn()
                ? '付款已完成。若仍無法自動登入，請關閉此頁並從主畫面圖示重新開啟 tsMedia。'
                : authCallbackError
            }
            onStart={() => go('auth')}
            onOpenPaymentInfo={() => go('membership-payment-info')}
          />
        )}

        {screen === 'membership-payment-info' && (
          <MembershipPaymentDisclosureScreen onBack={() => go('landing')} />
        )}

        {screen === 'auth' && (
          <AuthScreen
            onSuccess={async (signedInUser) => {
              if (needsIosSafariBrowserGate()) return
              setUser(signedInUser)
              if (readPasswordRecoveryPending() || readPasswordResetFlowStarted()) {
                routeToPasswordRecovery()
                return
              }
              const profile = await getProfile(signedInUser.id)
              routeByProfile(profile, signedInUser.id)
            }}
            onBack={() => go('landing')}
          />
        )}

        {screen === 'reset-password' && (
          <ResetPasswordScreen
            user={user}
            onComplete={async () => {
              const activeUser = await getActiveUser()
              if (!activeUser) {
                go('auth')
                return
              }
              setUser(activeUser)
              const profile = await getProfile(activeUser.id)
              routeByProfile(profile, activeUser.id)
            }}
          />
        )}

        {screen === 'security-check' && (
          <SecurityCheckScreen
            userId={user?.id}
            onContinue={async () => {
              const activeUser = await getActiveUser()
              if (!activeUser) return go('profile-setup')
              if (readPwaStandaloneMode()) {
                writeSecurityOnboardingDone(activeUser.id)
              }
              const profile = await getProfile(activeUser.id)
              routeAfterSecurityCheck(profile, activeUser.id)
            }}
          />
        )}

        {screen === 'terms-consent' && (
          <TermsConsentScreen
            busy={termsBusy}
            error={termsError}
            onAccept={handleTermsAccept}
            onBack={() => go('security-check')}
          />
        )}

        {screen === 'profile-setup' && (
          <ProfileSetupScreen
            userId={user?.id}
            onComplete={handleProfileSetupComplete}
            onBack={verifyWaitRevisit ? undefined : () => go('terms-consent')}
            onBackToQuestionnaire={verifyWaitRevisit ? () => go('questionnaire') : undefined}
            onReturnToVerify={verifyWaitRevisit ? () => go('identity-verify') : undefined}
          />
        )}

        {screen === 'questionnaire' && (
          <QuestionnaireScreen
            onComplete={handleQuestionnaireComplete}
            gender={userGender}
            userId={user?.id}
            onBack={() => go('profile-setup')}
            onReturnToVerify={verifyWaitRevisit ? () => go('identity-verify') : undefined}
          />
        )}

        {screen === 'identity-verify' && (
          <IdentityVerifyScreen
            userId={user?.id}
            claimedName={currentProfileName}
            gender={userGender}
            onComplete={async () => {
              setVerifyWaitRevisit(false)
              const u = await getActiveUser()
              const profile = u ? await getProfile(u.id) : null
              launchMainFromProfile(profile)
            }}
            onEditProfile={() => {
              setVerifyWaitRevisit(true)
              go('profile-setup')
            }}
            onEditQuestionnaire={() => {
              setVerifyWaitRevisit(true)
              go('questionnaire')
            }}
            onSignOut={() => void handleSignOut()}
          />
        )}
      </motion.div>
    </AnimatePresence>
    </>
  )
}
