import { useState } from 'react'
import { motion } from 'framer-motion'
import { Cpu, Eye, EyeOff, Lock, ChevronRight } from 'lucide-react'
import { updatePassword } from '@/lib/auth'
import { cn } from '@/lib/utils'

interface Props {
  onComplete: () => void | Promise<void>
}

export default function ResetPasswordScreen({ onComplete }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isValid = password.length >= 6 && password === confirm

  const handleSubmit = async () => {
    if (!isValid || loading) return
    setLoading(true)
    setError('')
    const result = await updatePassword(password)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onComplete()
  }

  return (
    <div
      className="max-w-md mx-auto bg-[#fafafa] pb-safe"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
    >
      <div
        className="px-5 pt-safe pb-10"
        style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)' }}
      >
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-none">tsMedia</h1>
            <p className="text-white/40 text-[10px] tracking-widest uppercase mt-0.5">Silicon Hearts</p>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-white/50 text-xs font-semibold tracking-widest uppercase mb-1">重設密碼</p>
          <h2 className="text-white text-2xl font-extrabold" style={{ letterSpacing: '-0.03em' }}>
            設定新密碼
          </h2>
          <p className="text-white/60 text-sm mt-2 leading-relaxed">
            連結已驗證成功。請設定新密碼後繼續使用 tsMedia。
          </p>
        </motion.div>
      </div>

      <div className="px-5 pt-8 space-y-4">
        <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-slate-100 flex items-center gap-3 focus-within:ring-slate-300 transition-all">
          <Lock className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError('')
            }}
            placeholder="新密碼（至少 6 碼）"
            autoComplete="new-password"
            onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
            className="flex-1 text-sm text-slate-900 placeholder:text-slate-300 outline-none bg-transparent"
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="text-slate-300 hover:text-slate-500 transition-colors"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-slate-100 flex items-center gap-3 focus-within:ring-slate-300 transition-all">
          <Lock className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            type={showPw ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value)
              setError('')
            }}
            placeholder="再次輸入新密碼"
            autoComplete="new-password"
            onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
            className="flex-1 text-sm text-slate-900 placeholder:text-slate-300 outline-none bg-transparent"
          />
        </div>

        {confirm.length > 0 && password !== confirm ? (
          <p className="text-sm text-amber-600 text-center">兩次輸入的密碼不一致</p>
        ) : null}

        {error ? <p className="text-sm text-red-500 text-center px-2">{error}</p> : null}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="px-5 pb-12 pt-6"
      >
        <motion.button
          whileTap={{ scale: isValid && !loading ? 0.97 : 1 }}
          onClick={() => void handleSubmit()}
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
              更新密碼
              <ChevronRight className="w-5 h-5" />
            </>
          )}
        </motion.button>
      </motion.div>
    </div>
  )
}
