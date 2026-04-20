import { motion } from 'framer-motion'
import { ChevronRight, Cpu, ShieldCheck, Zap, Users, Lock } from 'lucide-react'
import BlurredAvatar from '@/components/BlurredAvatar'

interface Props {
  onStart: () => void
  onSkip: () => void
}

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
    desc: '僅限台積電或聯發科員工，公司文件人工核驗。',
    accent: '#6366f1',
  },
  {
    icon: Zap,
    title: 'AI 價值觀配對',
    desc: '30 道犀利開放式問題，精準篩選真正契合的對象。',
    accent: '#f59e0b',
  },
  {
    icon: Lock,
    title: '端對端加密',
    desc: '頭像強制模糊，傳輸全程加密，審核後不留存文件。',
    accent: '#10b981',
  },
]

export default function LandingScreen({ onStart, onSkip }: Props) {
  return (
    <div className="min-h-dvh flex flex-col bg-white">

      {/* ── Dark hero (no image) ──────────────────────────────────── */}
      <div
        className="relative overflow-hidden px-5 pt-12 pb-10 flex-shrink-0"
        style={{ background: 'linear-gradient(145deg, #0a0f1e 0%, #111827 50%, #0f1c2e 100%)' }}
      >
        {/* Dot grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        {/* Indigo glow top-right */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: '-80px', right: '-60px',
            width: '280px', height: '280px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)',
          }}
        />
        {/* Blue glow bottom-left */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: '-60px', left: '-40px',
            width: '220px', height: '220px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
          }}
        />

        {/* Top nav */}
        <div className="relative z-10 flex items-center justify-between mb-10">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2.5"
          >
            <div className="w-9 h-9 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
              <Cpu className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <p className="text-white font-bold text-[17px] leading-none tracking-tight">tsMedia</p>
              <p className="text-white/35 text-[9px] tracking-[0.18em] uppercase mt-0.5">Silicon Hearts</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="flex items-center gap-1.5 bg-white/8 backdrop-blur-sm rounded-full px-3 py-1.5 ring-1 ring-white/15"
          >
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span className="text-white/80 text-xs font-semibold">隱私優先</span>
          </motion.div>
        </div>

        {/* Tagline */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.5 }}
          className="relative z-10"
        >
          <p className="text-white/40 text-[11px] font-semibold tracking-[0.2em] uppercase mb-3">
            台積電 × 聯發科・菁英專屬
          </p>
          <h1
            className="text-white font-black leading-[1.08]"
            style={{ fontSize: 'clamp(2rem, 8vw, 2.6rem)', letterSpacing: '-0.04em' }}
          >
            在矽晶圓之外，<br />找到屬於你的<br />那個人
          </h1>
        </motion.div>

        {/* Avatar row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="relative z-10 mt-8 flex items-center gap-3"
        >
          <div className="flex -space-x-2.5">
            {AVATARS.map((a, i) => (
              <div
                key={i}
                className="ring-[2.5px] ring-[#0f1c2e] rounded-full"
                style={{ zIndex: AVATARS.length - i }}
              >
                <BlurredAvatar gradientFrom={a.from} gradientTo={a.to} size="sm" />
              </div>
            ))}
          </div>
          <div>
            <p className="text-sm font-bold text-white">2,400+ 位工程師</p>
            <p className="text-xs text-white/45 flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              頭像受隱私加密保護
            </p>
          </div>
        </motion.div>

        {/* Chip strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          className="relative z-10 mt-6 flex gap-2 flex-wrap"
        >
          {['🔒 端對端加密', '✅ 實名認證', '🤖 AI 配對'].map((chip) => (
            <span
              key={chip}
              className="text-[11px] font-semibold text-white/60 bg-white/8 ring-1 ring-white/12 rounded-full px-3 py-1"
            >
              {chip}
            </span>
          ))}
        </motion.div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pt-7 pb-6 space-y-5">

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, duration: 0.45 }}
          className="space-y-3"
        >
          {FEATURES.map(({ icon: Icon, title, desc, accent }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.42 + i * 0.07, duration: 0.35 }}
              className="flex items-start gap-4 bg-white rounded-2xl px-4 py-4 shadow-sm ring-1 ring-slate-100"
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${accent}18` }}
              >
                <Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18, color: accent }} />
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
          transition={{ delay: 0.62, duration: 0.4 }}
          className="flex gap-3"
        >
          {[
            { value: '94%', label: '配對成功率' },
            { value: '4.9★', label: '用戶評分' },
            { value: '1–3天', label: '審核時效' },
          ].map(({ value, label }) => (
            <div key={label} className="flex-1 text-center py-3.5 bg-slate-50 rounded-2xl ring-1 ring-slate-100">
              <p className="text-[15px] font-black text-slate-900" style={{ letterSpacing: '-0.02em' }}>{value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{label}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.4 }}
        className="px-5 pb-12 pt-2 bg-white"
      >
        <motion.button
          onClick={onStart}
          whileTap={{ scale: 0.97 }}
          className="w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 shadow-xl"
          style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: '#fff',
            boxShadow: '0 8px 32px rgba(15,23,42,0.28)',
          }}
        >
          <Users className="w-5 h-5" />
          申請加入菁英社群
          <ChevronRight className="w-5 h-5" />
        </motion.button>
        <button onClick={onSkip} className="w-full text-slate-300 text-sm py-3 mt-1">
          跳過（測試模式）
        </button>
      </motion.div>

    </div>
  )
}
