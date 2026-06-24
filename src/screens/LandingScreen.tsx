import { motion } from 'framer-motion'
import { ChevronRight, Cpu, ShieldCheck, Zap, Users, Lock } from 'lucide-react'
import SupportEmailFooter from '@/components/SupportEmailFooter'

interface Props {
  onStart: () => void
  onOpenPaymentInfo: () => void
  authNotice?: string | null
}

const FEATURES = [
  {
    icon: ShieldCheck,
    title: '嚴格身份審核',
    desc: '邀請制與文件核驗並行，維持社群信任與男女比例。',
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

export default function LandingScreen({ onStart, onOpenPaymentInfo, authNotice }: Props) {
  return (
    <div className="min-h-dvh flex flex-col bg-white">

      {authNotice ? (
        <div
          role="alert"
          className="mx-5 mt-safe rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200"
        >
          {authNotice}
        </div>
      ) : null}

      {/* ── Dark hero (no image) ──────────────────────────────────── */}
      <div
        className="relative overflow-hidden px-5 pt-safe pb-10 flex-shrink-0"
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
          <h1
            className="text-white font-medium leading-[1.15]"
            style={{
              fontSize: 'clamp(1.65rem, 5.8vw, 2.35rem)',
              letterSpacing: '-0.04em',
              fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif',
            }}
          >
            <span className="block text-white">先認識彼此，</span>
            <span className="block text-white/90">再看見彼此</span>
          </h1>
        </motion.div>

        {/* Photo hero */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="relative z-10 mt-8"
        >
          <div className="relative overflow-hidden rounded-[28px] ring-1 ring-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <img
              src="/landing-photo.png"
              alt="tsMedia hero"
              className="block w-full h-[260px] object-cover scale-[1.02]"
              style={{ filter: 'blur(4px)' }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4">
              <div className="inline-flex items-center gap-1.5 bg-white/14 backdrop-blur-md rounded-full px-3 py-1.5 ring-1 ring-white/15">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="text-white/90 text-xs font-semibold">隱私保護模式展示</span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end px-1">
            <p className="text-xs text-white/55">單張主視覺 · 輕霧化處理</p>
          </div>
        </motion.div>

        {/* Chip strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          className="relative z-10 mt-6 flex gap-2 flex-wrap"
        >
          {['🔒 端對端加密', '✅ 職業認證', '🤖 AI 配對'].map((chip) => (
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

        {/* 會員資格說明 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.45 }}
          className="rounded-2xl bg-slate-50 px-5 py-6 ring-1 ring-slate-100"
        >
          <p className="text-[15px] text-slate-600 leading-[1.75]">
            為了維持健康的男女比例，
          </p>

          <div className="mt-5 space-y-5">
            <div>
              <p className="text-[13px] font-bold tracking-wide text-slate-900">男性</p>
              <p className="mt-2 text-[14px] text-slate-600 leading-[1.75]">
                採邀請制與資格審核。
                <br />
                男性目前僅開放以下公司之員工。
              </p>
              <ol className="mt-3 space-y-1.5 pl-4 text-[14px] text-slate-700 leading-relaxed list-decimal marker:text-slate-400">
                <li>晶圓製造龍頭</li>
                <li>IC 設計龍頭</li>
              </ol>
            </div>

            <div className="border-t border-slate-200/90 pt-5">
              <p className="text-[13px] font-bold tracking-wide text-slate-900">女性</p>
              <p className="mt-2 text-[14px] text-slate-600 leading-[1.75]">限額開放申請。</p>
            </div>
          </div>
        </motion.div>

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
            { value: '1 分鐘', label: '審核（AI）' },
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

        <div className="mt-8 space-y-4 border-t border-slate-100 pt-6">
          <button
            type="button"
            onClick={onOpenPaymentInfo}
            className="flex w-full items-center justify-center rounded-2xl bg-slate-50 px-4 py-3.5 text-center ring-1 ring-slate-100 active:bg-slate-100"
          >
            <span className="text-sm font-bold text-slate-800">會員收付資訊</span>
          </button>
          <SupportEmailFooter />
        </div>
      </motion.div>

    </div>
  )
}
