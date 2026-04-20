import { motion } from 'framer-motion'
import { ChevronRight, Cpu, ShieldCheck, Zap, Users } from 'lucide-react'
import BlurredAvatar from '@/components/BlurredAvatar'

interface Props {
  onStart: () => void
  onSkip: () => void
}

// Privacy preview avatars — all blurred
const AVATARS = [
  { from: '#667eea', to: '#764ba2' },
  { from: '#f093fb', to: '#f5576c' },
  { from: '#4facfe', to: '#00f2fe' },
  { from: '#43e97b', to: '#38f9d7' },
  { from: '#fa709a', to: '#fee140' },
  { from: '#a18cd1', to: '#fbc2eb' },
]

const FEATURES = [
  {
    icon: ShieldCheck,
    title: '嚴格身份審核',
    desc: '僅限台積電（TSMC）或聯發科（MediaTek）員工，公司文件人工審核。',
  },
  {
    icon: Zap,
    title: 'AI 價值觀深度配對',
    desc: '30 道犀利開放式問題評估，精準篩選出真正契合的對象。',
  },
  {
    icon: ShieldCheck,
    title: '極致隱私保護',
    desc: '頭像強制加密模糊，端對端加密傳輸，不留存任何審核文件。',
  },
]

export default function LandingScreen({ onStart, onSkip }: Props) {
  return (
    <div className="min-h-dvh flex flex-col bg-white">

      {/* ── Hero image ─────────────────────────────────────────── */}
      <div className="relative w-full overflow-hidden flex-shrink-0" style={{ background: '#080b18' }}>
        <img
          src="/hero.png"
          alt="elite couple"
          className="w-full block"
          style={{ maxHeight: '70vh', objectFit: 'contain', objectPosition: 'center top' }}
        />
        {/* bottom fade to white */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, transparent 35%, rgba(255,255,255,0.4) 78%, #fff 100%)',
          }}
        />

        {/* Top nav */}
        <div className="absolute top-0 left-0 right-0 px-5 pt-12 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2"
          >
            <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center ring-1 ring-white/30">
              <Cpu className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-base tracking-tight drop-shadow">tsMedia</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="flex items-center gap-1.5 bg-white/15 backdrop-blur-md rounded-full px-3 py-1.5 ring-1 ring-white/25"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-white" />
            <span className="text-white text-xs font-semibold">隱私優先</span>
          </motion.div>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="flex-1 px-5 -mt-6 relative z-10 pb-6">

        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.45 }}
        >
          <h1
            className="text-[2.05rem] font-black text-slate-900 leading-tight"
            style={{ letterSpacing: '-0.035em' }}
          >
            在矽晶圓之外，找到屬於你的那個人
          </h1>
          <p className="text-slate-500 text-sm mt-2.5 leading-relaxed">
            台積電 × 聯發科菁英專屬交友社群・身份嚴格審核・極致隱私保護
          </p>
        </motion.div>

        {/* Privacy avatar row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.4 }}
          className="mt-6 flex items-center gap-3"
        >
          <div className="flex -space-x-2.5">
            {AVATARS.map((a, i) => (
              <div
                key={i}
                className="ring-2 ring-white rounded-full"
                style={{ zIndex: AVATARS.length - i }}
              >
                <BlurredAvatar gradientFrom={a.from} gradientTo={a.to} size="sm" />
              </div>
            ))}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">2,400+ 位工程師</p>
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              頭像受隱私加密保護
            </p>
          </div>
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, duration: 0.4 }}
          className="mt-6 space-y-3"
        >
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.07, duration: 0.35 }}
              className="flex items-start gap-4 bg-slate-50 rounded-2xl px-4 py-3.5"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Stat strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          className="mt-5 flex gap-3"
        >
          {[
            { value: '94%', label: '配對成功率' },
            { value: '4.9★', label: '用戶評分' },
            { value: '1–3天', label: '審核時效' },
          ].map(({ value, label }) => (
            <div key={label} className="flex-1 text-center py-3 bg-slate-50 rounded-2xl">
              <p className="text-base font-black text-slate-900" style={{ letterSpacing: '-0.02em' }}>{value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{label}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ── CTA ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.4 }}
        className="px-5 pb-12 pt-2 bg-white"
      >
        <motion.button
          onClick={onStart}
          whileTap={{ scale: 0.97 }}
          className="w-full bg-slate-900 text-white rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 shadow-xl shadow-slate-900/25"
        >
          <Users className="w-5 h-5" />
          申請加入菁英社群
          <ChevronRight className="w-5 h-5" />
        </motion.button>
        <button onClick={onSkip} className="w-full text-slate-400 text-sm py-3 mt-1">
          跳過（測試模式）
        </button>
      </motion.div>

    </div>
  )
}
