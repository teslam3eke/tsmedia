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
        if (!profile?.name)                                                      go('security-check')
        else if (!profile.questionnaire || (profile.questionnaire as unknown[]).length === 0) go('questionnaire')
        else if (profile.verification_status === 'pending')                      go('identity-verify')
        else                                                                     go('main')
      } else {
        go('landing')
      }
    })

    // Step 2: listen for subsequent sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return
      const u = session?.user ?? null
      setUser(u)
      if (event === 'SIGNED_OUT') { go('landing'); return }
      if (event === 'SIGNED_IN' && u) {
        const profile = await getProfile(u.id)
        if (!profile?.name)                                                      go('security-check')
        else if (!profile.questionnaire || (profile.questionnaire as unknown[]).length === 0) go('questionnaire')
        else if (profile.verification_status === 'pending')                      go('identity-verify')
        else                                                                     go('main')
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

  // ── ProfileSetup complete → save basic profile ───────────────
  const handleProfileSetupComplete = async (data: ProfileSetupData) => {
    setProfileSetupData(data)
    if (user) {
      await upsertProfile({
        userId: user.id,
        name: data.name,
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
    if (user) {
      await saveQuestionnaire(user.id, entries)
    }
    go('identity-verify')
  }

  if (!authReady) return <SplashScreen />

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={screen}
        initial={anim.initial}
        animate={{ opacity: 1, x: 0 }}
        exit={anim.exit}
        transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        style={{ minHeight: 'var(--app-height, 100svh)' }}
      >
        {screen === 'landing' && (
          <LandingScreen
            onStart={() => go('auth')}
            onSkip={() => go('main')}
          />
        )}

        {screen === 'auth' && (
          <AuthScreen
            onSuccess={() => go('security-check')}
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
          />
        )}

        {screen === 'identity-verify' && (
          <IdentityVerifyScreen
            userId={user?.id}
            onComplete={() => go('main')}
            onSkip={() => go('main')}
          />
        )}

        {screen === 'main' && (
          <MainScreen
            user={user}
            onSignOut={() => go('landing')}
          />
        )}
      </motion.div>
    </AnimatePresence>
  )
}
