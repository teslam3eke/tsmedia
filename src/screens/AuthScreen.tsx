import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, Lock, ChevronRight, Cpu, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { requestPasswordReset, signIn, signUp } from '@/lib/auth'
import { iosEmailAuthSafariHint } from '@/lib/authBrowser'
import { trackMetaCompleteRegistration } from '@/lib/metaPixel'
import { cn } from '@/lib/utils'

interface Props {
  onSuccess: (user: User) => void | Promise<void>
  onBack: () => void
  /** 從 landing「開始」進入時預設申請加入，避免誤用「已有帳號」漏送 CompleteRegistration */
  initialMode?: Mode
}

type Mode = 'signin' | 'signup'
type AuthPanel = 'form' | 'signupDone' | 'forgotPassword' | 'forgotDone'

export default function AuthScreen({ onSuccess, onBack, initialMode = 'signin' }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [panel, setPanel] = useState<AuthPanel>('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isValidEmail = email.includes('@')
  const isValidSignIn = isValidEmail && password.length >= 6
  const isValidSignUp = isValidSignIn
  const isValid = mode === 'signup' ? isValidSignUp : isValidSignIn
  const iosSafariHint = iosEmailAuthSafariHint()

  const handleHeaderBack = () => {
    if (panel === 'forgotPassword' || panel === 'forgotDone') {
      setPanel('form')
      setMode('signin')
      setError('')
      return
    }
    onBack()
  }

  const handleSubmit = async () => {
    if (!isValid || loading) return
    setLoading(true)
    setError('')

    const result = mode === 'signup'
      ? await signUp(email, password)
      : await signIn(email, password)

    setLoading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    if (mode === 'signup') {
      trackMetaCompleteRegistration(result.user.id)
    }

    if (mode === 'signup' && !result.session) {
      setPanel('signupDone')
      return
    }

    await onSuccess(result.user)
  }

  const handleForgotPassword = async () => {
    if (!isValidEmail || loading) return
    setLoading(true)
    setError('')
    const result = await requestPasswordReset(email.trim())
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPanel('forgotDone')
  }

  const showModeTabs = panel === 'form'

  return (
    <div className="max-w-md mx-auto bg-[#fafafa] pb-safe"  style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}>

      {/* Header */}
      <div
        className="px-5 pt-safe pb-10"
        style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)' }}
      >
        <motion.button
          onClick={handleHeaderBack}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 text-white/70 text-base font-medium mb-7 hover:text-white transition-colors active:opacity-70 py-1 pr-3"
        >
          <ArrowLeft className="w-5 h-5" />
          返回
        </motion.button>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex items-center gap-2.5 mb-5"
        >
          <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-none">tsMedia</h1>
            <p className="text-white/40 text-[10px] tracking-widest uppercase mt-0.5">Silicon Hearts</p>
          </div>
        </motion.div>

        {/* Mode tabs：左「已有帳號」、右「申請加入」 */}
        {showModeTabs && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex bg-white/10 rounded-2xl p-1"
          >
            {(['signin', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError('') }}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200',
                  mode === m
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-white/60 hover:text-white/90',
                )}
              >
                {m === 'signin' ? '已有帳號' : '申請加入'}
              </button>
            ))}
          </motion.div>
        )}
      </div>

      {/* Form */}
      <div className="px-5 pt-8">
        <AnimatePresence mode="wait">
          {panel === 'signupDone' ? (
            <motion.div
              key="signup-done"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-10"
            >
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">確認信已寄出</h2>
              <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
                請前往 <span className="font-semibold text-slate-800">{email}</span> 點擊確認連結，完成後即可繼續申請流程。
              </p>
              {iosSafariHint ? (
                <p className="mt-4 text-xs leading-relaxed text-amber-800 bg-amber-50 rounded-2xl px-3 py-2.5 max-w-xs mx-auto text-left">
                  {iosSafariHint}
                </p>
              ) : null}
              <button
                onClick={() => setPanel('form')}
                className="mt-6 text-sm text-slate-400 underline underline-offset-2"
              >
                重新輸入信箱
              </button>
            </motion.div>
          ) : panel === 'forgotDone' ? (
            <motion.div
              key="forgot-done"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-10"
            >
              <div className="w-16 h-16 rounded-2xl bg-sky-100 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-sky-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">重設密碼信已寄出</h2>
              <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
                請前往 <span className="font-semibold text-slate-800">{email}</span> 開啟信件，點擊
                <span className="font-semibold text-slate-700">重設密碼連結</span>。
              </p>
              <p className="mt-3 text-xs text-slate-400 leading-relaxed max-w-xs mx-auto text-left">
                接下來：① 點連結回到 tsMedia → ② 在此設定新密碼 → ③ 完成後即可登入。
                若未收到，請檢查垃圾郵件；連結通常 24 小時內有效。
              </p>
              {iosSafariHint ? (
                <p className="mt-4 text-xs leading-relaxed text-amber-800 bg-amber-50 rounded-2xl px-3 py-2.5 max-w-xs mx-auto text-left">
                  {iosSafariHint}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setPanel('form')
                  setMode('signin')
                  setError('')
                }}
                className="mt-6 text-sm font-semibold text-slate-600 underline underline-offset-2"
              >
                返回登入
              </button>
            </motion.div>
          ) : panel === 'forgotPassword' ? (
            <motion.div
              key="forgot"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div>
                <p className="text-2xl font-extrabold text-slate-900" style={{ letterSpacing: '-0.03em' }}>
                  忘記密碼
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  輸入註冊信箱，我們會寄送重設密碼連結
                </p>
              </div>

              <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-slate-100 flex items-center gap-3 focus-within:ring-slate-300 transition-all">
                <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError('') }}
                  onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                  placeholder="your@email.com"
                  autoComplete="email"
                  onKeyDown={(e) => e.key === 'Enter' && void handleForgotPassword()}
                  className="flex-1 text-sm text-slate-900 placeholder:text-slate-300 outline-none bg-transparent"
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-sm text-red-500 text-center px-2"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={() => {
                  setPanel('form')
                  setMode('signin')
                  setError('')
                }}
                className="w-full text-center text-sm font-semibold text-slate-500 underline underline-offset-2"
              >
                返回登入
              </button>
            </motion.div>
          ) : (
            <motion.div
              key={mode}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div>
                <p className="text-2xl font-extrabold text-slate-900" style={{ letterSpacing: '-0.03em' }}>
                  {mode === 'signup' ? '建立你的帳號' : '歡迎回來'}
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  {mode === 'signup'
                    ? '填寫信箱與密碼，開始申請流程'
                    : '登入後繼續你的配對旅程'}
                </p>
              </div>

              {/* Email */}
              <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-slate-100 flex items-center gap-3 focus-within:ring-slate-300 transition-all">
                <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError('') }}
                  onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                  placeholder="your@email.com"
                  autoComplete="email"
                  className="flex-1 text-sm text-slate-900 placeholder:text-slate-300 outline-none bg-transparent"
                />
              </div>

              {/* Password */}
              <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-slate-100 flex items-center gap-3 focus-within:ring-slate-300 transition-all">
                <Lock className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  onFocus={(e) => { const el = e.currentTarget; setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                  placeholder={mode === 'signup' ? '設定密碼（至少 6 碼）' : '輸入密碼'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  className="flex-1 text-sm text-slate-900 placeholder:text-slate-300 outline-none bg-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="text-slate-300 hover:text-slate-500 transition-colors"
                >
                  {showPw
                    ? <EyeOff className="w-4 h-4" />
                    : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {mode === 'signin' && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setPanel('forgotPassword')
                      setError('')
                    }}
                    className="text-sm font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-700"
                  >
                    忘記密碼？
                  </button>
                </div>
              )}

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-sm text-red-500 text-center px-2"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Privacy notice for signup */}
              {mode === 'signup' && (
                <p className="text-xs text-slate-400 text-center leading-relaxed px-2">
                  建立帳號即代表同意 tsMedia 隱私政策。你的資料僅用於身份驗證，不對外揭露。
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* CTA */}
      {panel === 'form' && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="px-5 pb-12 pt-4"
        >
          <motion.button
            whileTap={{ scale: isValid && !loading ? 0.97 : 1 }}
            onClick={handleSubmit}
            disabled={!isValid || loading}
            className={cn(
              'w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 transition-all',
              isValid && !loading
                ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20'
                : 'bg-slate-100 text-slate-300',
            )}
          >
            {loading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              >
                <Cpu className="w-5 h-5" />
              </motion.div>
            ) : (
              <>
                {mode === 'signup' ? '建立帳號，開始申請' : '登入'}
                <ChevronRight className="w-5 h-5" />
              </>
            )}
          </motion.button>
        </motion.div>
      )}

      {panel === 'forgotPassword' && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="px-5 pb-12 pt-4"
        >
          <motion.button
            whileTap={{ scale: isValidEmail && !loading ? 0.97 : 1 }}
            onClick={() => void handleForgotPassword()}
            disabled={!isValidEmail || loading}
            className={cn(
              'w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 transition-all',
              isValidEmail && !loading
                ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20'
                : 'bg-slate-100 text-slate-300',
            )}
          >
            {loading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              >
                <Cpu className="w-5 h-5" />
              </motion.div>
            ) : (
              <>
                寄送重設密碼連結
                <ChevronRight className="w-5 h-5" />
              </>
            )}
          </motion.button>
        </motion.div>
      )}
    </div>
  )
}
