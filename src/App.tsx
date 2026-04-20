import { useState, useEffect } from 'react'
import { AnimatePresence, motion, type TargetAndTransition } from 'framer-motion'
import type { User } from '@supabase/supabase-js'

import LandingScreen from '@/screens/LandingScreen'
import AuthScreen from '@/screens/AuthScreen'
import SecurityCheckScreen from '@/screens/SecurityCheckScreen'
import ProfileSetupScreen, { type ProfileSetupData } from '@/screens/ProfileSetupScreen'
import QuestionnaireScreen from '@/screens/QuestionnaireScreen'
import IdentityVerifyScreen from '@/screens/IdentityVerifyScreen'
import MainScreen from '@/screens/MainScreen'

import { supabase } from '@/lib/supabase'
import { upsertProfile, saveQuestionnaire, getProfile } from '@/lib/db'
import type { QuestionnaireEntry } from '@/lib/types'
import type { Question } from '@/utils/questions'
// profileSetupData is collected but used for future profile enrichment


type Screen =
  | 'splash'
  | 'landing'
  | 'auth'
  | 'security-check'
  | 'profile-setup'
  | 'questionnaire'
  | 'identity-verify'
  | 'main'

const SCREEN_ORDER: Screen[] = [
  'splash',
  'landing',
  'auth',
  'security-check',
  'profile-setup',
  'questionnaire',
  'identity-verify',
  'main',
]

const SLIDE: Record<'forward' | 'back', { initial: TargetAndTransition; exit: TargetAndTransition }> = {
  forward: { initial: { opacity: 0, x: 40 }, exit: { opacity: 0, x: -40 } },
  back:    { initial: { opacity: 0, x: -40 }, exit: { opacity: 0, x: 40 } },
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

  const getActiveUser = async () => {
    if (user) return user
    const { data } = await supabase.auth.getUser()
    return data.user ?? null
  }

  // Determine which screen to show based on saved progress.
  // 'pending' is the DB default for verification_status — it does NOT mean
  // the user hasn't verified. Identity verification is optional after onboarding.
  const routeByProfile = (profile: import('@/lib/types').ProfileRow | null) => {
    if (!profile?.name) return go('security-check')
    if (profile.gender) setUserGender(profile.gender)
    if (!profile.questionnaire || (profile.questionnaire as unknown[]).length === 0) return go('questionnaire')
    go('main') // identity-verify is optional — accessible from profile settings
  }

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
        const profile = await getProfile(u.id)
        routeByProfile(profile)
      } else {
        go('landing')
      }
    })

    // Step 2: keep user state in sync; routing is handled in onSuccess / getSession
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      setUser(session?.user ?? null)
      if (event === 'SIGNED_OUT') go('landing')
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
    setUserGender(data.gender)
    const activeUser = await getActiveUser()
    if (activeUser) {
      await upsertProfile({
        userId: activeUser.id,
        name: data.name,
        gender: data.gender,
        interests: data.interests,
        bio: data.bio,
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
    // 女生不需要職業驗證，直接進主畫面
    if (userGender === 'female') {
      go('main')
    } else {
      go('identity-verify')
    }
  }

  if (!authReady) return <SplashScreen />

  return (
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
            onSkip={() => go('main')}
          />
        )}

        {screen === 'auth' && (
          <AuthScreen
            onSuccess={async (signedInUser) => {
              // Use the authenticated user returned by Supabase directly to avoid
              // getSession timing races right after login.
              setUser(signedInUser)
              const profile = await getProfile(signedInUser.id)
              routeByProfile(profile)
            }}
            onBack={() => go('landing')}
          />
        )}

        {screen === 'security-check' && (
          <SecurityCheckScreen
            onContinue={() => go('profile-setup')}
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
            gender={userGender}
            onComplete={() => go('main')}
            onSkip={() => go('main')}
          />
        )}

        {screen === 'main' && (
          <div className="h-[100dvh] flex flex-col overflow-hidden w-full bg-white min-h-0">
            <MainScreen
              user={user}
              onSignOut={() => go('landing')}
            />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
