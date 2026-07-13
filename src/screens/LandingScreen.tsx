import { motion } from 'framer-motion'
import { ChevronRight, CreditCard, Lock, Puzzle, ShieldCheck, Users } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'

interface Props {
  onStart: () => void
  onOpenPaymentInfo: () => void
  authNotice?: string | null
}

const SERIF = '"Noto Serif TC", "Songti TC", "STSong", "Georgia", serif'
const GOLD = '#A8884E'
const GOLD_LIGHT = '#C4A574'

const FEATURES = [
  {
    icon: ShieldCheck,
    title: '全人工審核',
    desc: '嚴格把關每一位會員\n確保真實與品質',
  },
  {
    icon: Users,
    title: '男女比例 1:1',
    desc: '嚴格控管會員性別比例\n維持良好的交友環境',
  },
  {
    icon: Puzzle,
    title: '拼圖解鎖機制',
    desc: '透過互動一步步解鎖\n更真實的彼此',
  },
  {
    icon: CreditCard,
    title: '全會員付費制度',
    desc: '降低詐騙與殭屍帳號\n打造真誠交友空間',
  },
] as const

export default function LandingScreen({ onStart, onOpenPaymentInfo, authNotice }: Props) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#f7f3ed] text-[#4a4035]">
      {/* 背景人像 */}
      <div className="pointer-events-none absolute inset-0">
        <img
          src="/landing-photo.png"
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-[center_28%] scale-105"
          style={{ filter: 'blur(1.5px) saturate(0.92)' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,252,247,0.94) 0%, rgba(255,250,244,0.72) 34%, rgba(255,248,240,0.55) 58%, rgba(247,241,232,0.88) 100%)',
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-safe">
        {authNotice ? (
          <div
            role="alert"
            className="mb-4 rounded-2xl bg-amber-50/95 px-4 py-3 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200/80"
          >
            {authNotice}
          </div>
        ) : null}

        {/* Logo */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex flex-col items-center pt-6"
        >
          <BrandMark className="h-14 w-14" />
          <p
            className="mt-3 text-[2rem] font-normal leading-none tracking-[0.02em]"
            style={{ fontFamily: SERIF, color: GOLD }}
          >
            tsmedia
          </p>
          <p className="mt-2 text-[11px] font-medium tracking-[0.28em] text-[#8a7d6e]">
            高品質交友平台
          </p>
        </motion.header>

        {/* Hero copy */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.5 }}
          className="mt-8 text-center"
        >
          <h1
            className="text-[clamp(1.65rem,6.2vw,2rem)] font-normal leading-[1.45] tracking-[0.01em] text-[#3f372f]"
            style={{ fontFamily: SERIF }}
          >
            值得等待的人，
            <br />
            值得
            <span style={{ color: GOLD_LIGHT }}>更好</span>
            的相遇。
          </h1>
          <div className="mx-auto mt-5 h-px w-16" style={{ backgroundColor: GOLD_LIGHT }} />
          <p className="mt-4 text-[13px] leading-relaxed tracking-[0.04em] text-[#7a6f62]">
            在這裡，遇見值得認識的彼此
          </p>
        </motion.div>

        {/* Spacer：讓背景人像落在中段 */}
        <div className="min-h-[clamp(7rem,22vw,10rem)] flex-1" aria-hidden />

        {/* 四大特色 */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.45 }}
          className="grid grid-cols-4 gap-2 px-0.5"
        >
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 + i * 0.05, duration: 0.35 }}
              className="flex flex-col items-center text-center"
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ color: GOLD, backgroundColor: 'rgba(168,136,78,0.12)' }}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
              </div>
              <p
                className="mt-2 text-[10px] font-bold leading-tight text-[#5c5248]"
                style={{ fontFamily: SERIF }}
              >
                {title}
              </p>
              <p className="mt-1 whitespace-pre-line text-[8.5px] leading-[1.45] text-[#8a7d6e]">
                {desc}
              </p>
            </motion.div>
          ))}
        </motion.section>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.4 }}
          className="mt-8"
        >
          <motion.button
            type="button"
            onClick={onStart}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-between rounded-xl px-5 py-4 text-[15px] font-semibold tracking-[0.06em] text-white shadow-[0_10px_28px_rgba(168,136,78,0.28)]"
            style={{
              background: 'linear-gradient(135deg, #B8956A 0%, #A8884E 52%, #9A7944 100%)',
            }}
          >
            <span className="flex-1 text-center pl-6">新規申請 / 會員登入</span>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2.2} />
          </motion.button>

          <button
            type="button"
            onClick={onOpenPaymentInfo}
            className="mt-4 w-full py-2 text-center text-[11px] font-medium text-[#8a7d6e] underline-offset-2 active:text-[#5c5248]"
          >
            會員收付資訊
          </button>
        </motion.div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.42, duration: 0.4 }}
          className="mt-5 flex items-center justify-center gap-1.5 text-[10px] text-[#9a8d7e]"
        >
          <Lock className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span>我們承諾保護你的隱私與資料安全</span>
        </motion.footer>
      </div>
    </div>
  )
}
