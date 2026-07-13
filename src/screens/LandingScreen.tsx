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
const PAGE_BG = '#faf7f2'
const LANDING_COUPLE_BG = '/assets/landing-couple-bg.png'

/** 上下羽化：頂部保留臉部，只柔化邊緣 */
const PHOTO_MASK =
  'linear-gradient(to bottom, transparent 0%, black 6%, black 84%, transparent 100%)'

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
    <div className="min-h-dvh overflow-x-hidden" style={{ backgroundColor: PAGE_BG }}>
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
          className="relative z-20 mt-8 text-center"
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

        {/* 全寬人像：緊接標語下方，如設計稿 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.12, duration: 0.55 }}
          className="relative z-10 -mx-5 -mt-2 h-[clamp(13rem,40vw,16.5rem)] shrink-0"
          aria-hidden
        >
          <div
            className="absolute inset-0 left-1/2 w-screen -translate-x-1/2"
            style={{
              WebkitMaskImage: PHOTO_MASK,
              maskImage: PHOTO_MASK,
            }}
          >
            <img
              src={LANDING_COUPLE_BG}
              alt=""
              className="h-full w-full object-cover object-[center_38%]"
            />
          </div>
        </motion.div>

        {/* 四大特色 */}
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.45 }}
          className="relative z-20 -mt-2 grid grid-cols-4 gap-2 px-0.5"
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

        <div className="min-h-4 flex-1" aria-hidden />

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.4 }}
          className="relative z-20 mt-6"
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
          className="relative z-20 mt-5 flex items-center justify-center gap-1.5 text-[10px] text-[#9a8d7e]"
        >
          <Lock className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span>我們承諾保護你的隱私與資料安全</span>
        </motion.footer>
      </div>
    </div>
  )
}
