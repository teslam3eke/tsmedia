import { useState, useEffect, useRef } from 'react'
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

import { supabase, ensureConnectionWithBudget, CONNECTION_REPAIR_EVENT, type ConnectionRepairDetail } from '@/lib/supabase'
import {
  resumeHardReloadDisabledGlobally,
  resumeHardReloadEnabled,
  resumeDesktopWindowBlurRepairLikely,
  RESUME_DESKTOP_WINDOW_BLUR_MIN_MS,
  touchMediaPickerGraceSession,
  isWithinMediaPickerGracePeriod,
  windowBlurWakeLikelyForResumeReload,
} from '@/lib/resumeHardReload'
import { acceptLatestTerms, hasAcceptedLatestTerms, upsertProfile, saveQuestionnaire, getProfile } from '@/lib/db'
import { PROFILE_PHOTO_MIN } from '@/lib/types'
import type { QuestionnaireEntry } from '@/lib/types'
import type { Question } from '@/utils/questions'
// profileSetupData is collected but used for future profile enrichment


type Screen =
  | 'splash'
  | 'landing'
  | 'auth'
  | 'security-check'
  | 'terms-consent'
  | 'profile-setup'
  | 'questionnaire'
  | 'identity-verify'
  | 'main'

const SCREEN_ORDER: Screen[] = [
  'splash',
  'landing',
  'auth',
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

// ── Splash loader ─────────────────────────────────────────────────────────────
function SplashScreen() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#0f172a]">
      <motion.div
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        className="text-white font-bold text-2xl tracking-tight"
        style={{ letterSpacing: '-0.04em' }}
      >
        tsMedia
      </motion.div>
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

  const getActiveUser = async () => {
    if (user) return user
    const { data } = await supabase.auth.getUser()
    return data.user ?? null
  }

  /** 男性須至少送出職業驗證（verification_status 離開 pending）才可進入主畫面。 */
  const maleNeedsIdentityVerify = (profile: import('@/lib/types').ProfileRow | null) =>
    Boolean(profile?.gender === 'male' && profile.verification_status === 'pending')

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

  const launchMainFromProfile = (profile: import('@/lib/types').ProfileRow | null) => {
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
  const routeAfterSecurityCheck = (profile: import('@/lib/types').ProfileRow | null) => {
    if (!hasAcceptedLatestTerms(profile)) return go('terms-consent')
    if (!profile?.name) return go('profile-setup')
    setCurrentProfileName(profile.name)
    if (profile.gender) setUserGender(profile.gender)
    if (!profile.questionnaire || (profile.questionnaire as unknown[]).length === 0) return go('questionnaire')
    if (femaleNeedsLifePhotoOnboarding(profile)) return go('identity-verify')
    if (maleNeedsIdentityVerify(profile)) return go('identity-verify')
    launchMainFromProfile(profile)
  }

  // 首次登入仍走安全頁；同一裝置同一帳號看過一次後改走 routeAfterSecurityCheck，避免重整／推播冷啟反覆卡住。
  const routeByProfile = (profile: import('@/lib/types').ProfileRow | null, userId: string) => {
    if (profile?.gender) setUserGender(profile.gender)
    if (profile?.name) setCurrentProfileName(profile.name)
    if (readSecurityOnboardingDone(userId)) {
      routeAfterSecurityCheck(profile)
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

    const MIN_VISIBILITY_HIDDEN_MS = 600
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
      requestAnimationFrame(() => {
        window.location.reload()
      })
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

  // ── Auth init: read existing session first, then listen for changes ─────────
  useEffect(() => {
    let cancelled = false

    // Step 1: synchronously read the cached session from localStorage
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return
      const u = session?.user ?? null
      setUser(u)
      setReady(true)
      if (u) {
        // iOS Safari／PWA：冷啟時 React 此 effect 晚於初始 `pageshow`，MainScreen 的 wake 監聽尚不存在，
        // 若 storage 內 access_token 已過期，這裡第一個 getProfile 會失敗（桌面較少見）。
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          await ensureConnectionWithBudget()
        }
        const profile = await getProfile(u.id)
        routeByProfile(profile, u.id)
      } else {
        go('landing')
      }
    })

    // Step 2: keep user state in sync; routing is handled in onSuccess / getSession
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      if (event === 'SIGNED_OUT') go('landing')
      // 信箱確認信（PKCE）：首屏 getSession 仍為 null，換券完成後才會觸發 SIGNED_IN，須在此接 onboarding 路由
      if (event === 'SIGNED_IN' && session?.user) {
        const profile = await getProfile(session.user.id)
        routeByProfile(profile, session.user.id)
      }
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next: Screen) => {
    setPrev((prev) => prev)
    setScreen((prev) => { setPrev(prev); return next })
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

  if (!authReady) return <SplashScreen />

  // Main screen is rendered OUTSIDE AnimatePresence/motion.div so it is not
  // inside any transformed containing block. `position: fixed; inset: 0`
  // pins it to the visual viewport edges — guaranteed no bottom gap on iOS
  // PWA cold start (the dvh / fill-available bugs don't apply).
  if (screen === 'main') {
    return (
      <>
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
            onStart={() => go('auth')}
            onSkip={() => launchMainFromProfile(null)}
          />
        )}

        {screen === 'auth' && (
          <AuthScreen
            onSuccess={async (signedInUser) => {
              // Use the authenticated user returned by Supabase directly to avoid
              // getSession timing races right after login.
              setUser(signedInUser)
              const profile = await getProfile(signedInUser.id)
              routeByProfile(profile, signedInUser.id)
            }}
            onBack={() => go('landing')}
          />
        )}

        {screen === 'security-check' && (
          <SecurityCheckScreen
            onContinue={async () => {
              const activeUser = await getActiveUser()
              if (!activeUser) return go('profile-setup')
              writeSecurityOnboardingDone(activeUser.id)
              const profile = await getProfile(activeUser.id)
              routeAfterSecurityCheck(profile)
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
            onComplete={handleProfileSetupComplete}
            onSkip={() => go('questionnaire')}
          />
        )}

        {screen === 'questionnaire' && (
          <QuestionnaireScreen
            onComplete={handleQuestionnaireComplete}
            onSkip={() => go('identity-verify')}
            gender={userGender}
          />
        )}

        {screen === 'identity-verify' && (
          <IdentityVerifyScreen
            userId={user?.id}
            claimedName={currentProfileName}
            gender={userGender}
            onComplete={async () => {
              const u = await getActiveUser()
              const profile = u ? await getProfile(u.id) : null
              launchMainFromProfile(profile)
            }}
            onSkip={async () => {
              const u = await getActiveUser()
              const profile = u ? await getProfile(u.id) : null
              launchMainFromProfile(profile)
            }}
          />
        )}
      </motion.div>
    </AnimatePresence>
    </>
  )
}
