import { ChevronRight, CreditCard, Lock, Puzzle, ShieldCheck, Users } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'

interface Props {
  onStart: () => void
  onOpenPaymentInfo: () => void
  authNotice?: string | null
}

const SERIF = '"Noto Serif TC", "Songti TC", "STSong", "Georgia", serif'
const GOLD = '#aa8147'

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
    <div className="flex h-full min-h-full justify-center bg-[#f8f3ed]">
      <div className="relative h-full w-full max-w-[576px] overflow-hidden bg-[#f8f3ed]">
        {authNotice ? (
          <div
            role="alert"
            className="absolute inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-30 rounded-2xl bg-amber-50/95 px-4 py-3 text-sm leading-relaxed text-amber-900 shadow-lg ring-1 ring-amber-200/80"
          >
            {authNotice}
          </div>
        ) : null}

        {/* 高解析背景照片；所有文字與圖示由 HTML 呈現，避免點陣化。 */}
        <img
          src="/assets/landing-couple-premium.png"
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full select-none object-cover object-center"
          draggable={false}
        />

        <header className="absolute inset-x-0 top-[7.4%] z-10 flex flex-col items-center">
          <BrandMark className="h-[clamp(3.2rem,11vw,4rem)] w-[clamp(3.2rem,11vw,4rem)]" />
          <p
            className="mt-[1.2%] text-[clamp(1.7rem,7.2vw,2.6rem)] font-normal leading-none tracking-[0.02em]"
            style={{ color: GOLD, fontFamily: SERIF }}
          >
            tsmedia
          </p>
          <p className="mt-[1.3%] text-[clamp(0.58rem,2.15vw,0.76rem)] tracking-[0.3em] text-[#685b4e]">
            高品質交友平台
          </p>
        </header>

        <section className="absolute inset-x-0 top-[22.2%] z-10 text-center">
          <h1
            className="text-[clamp(1.65rem,7.3vw,2.65rem)] font-normal leading-[1.48] tracking-[0.06em] text-[#3f3932]"
            style={{ fontFamily: SERIF }}
          >
            值得等待的人，
            <br />
            值得<span style={{ color: '#b89058' }}>更好的相遇</span>。
          </h1>
          <div className="mx-auto mt-[3.2%] h-px w-[12%] bg-[#b89058]" />
          <p className="mt-[2.7%] text-[clamp(0.65rem,2.5vw,0.9rem)] tracking-[0.11em] text-[#74695d]">
            在這裡，遇見值得認識的彼此
          </p>
        </section>

        {/* 人像左右較深，先用柔和米白霧層托住特色文字。 */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 top-[69.5%] z-[5]"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, rgba(248,243,237,0.58) 22%, rgba(248,243,237,0.9) 46%, #f8f3ed 66%, #f8f3ed 100%)',
          }}
          aria-hidden
        />

        <section className="absolute inset-x-[4%] top-[74.2%] z-10 grid grid-cols-4 gap-[2%]">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex min-w-0 flex-col items-center text-center">
              <Icon
                className="h-[clamp(1.45rem,6vw,2.25rem)] w-[clamp(1.45rem,6vw,2.25rem)]"
                color={GOLD}
                strokeWidth={1.45}
              />
              <p
                className="mt-[12%] whitespace-nowrap text-[clamp(0.54rem,2.2vw,0.78rem)] font-semibold text-[#473d34]"
                style={{ fontFamily: SERIF }}
              >
                {title}
              </p>
              <p className="mt-[5%] whitespace-pre-line text-[clamp(0.42rem,1.65vw,0.58rem)] font-medium leading-[1.55] text-[#695d51]">
                {desc}
              </p>
            </div>
          ))}
        </section>

        <button
          type="button"
          onClick={onStart}
          className="absolute left-[14.2%] top-[88.05%] z-10 flex h-[5.9%] w-[71.6%] items-center rounded-[clamp(0.75rem,3vw,1rem)] px-[5%] text-white shadow-[0_12px_32px_rgba(151,107,50,0.25)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8f6c38]"
          style={{ background: 'linear-gradient(135deg, #bd9865 0%, #a77d3f 100%)' }}
          aria-label="新規申請或會員登入"
        >
          <span className="flex-1 pl-[6%] text-center text-[clamp(0.85rem,3.5vw,1.2rem)] font-semibold tracking-[0.06em]">
            新規申請 / 會員登入
          </span>
          <ChevronRight className="h-[clamp(1rem,4vw,1.4rem)] w-[clamp(1rem,4vw,1.4rem)]" />
        </button>

        <div className="absolute inset-x-0 bottom-[max(0.65rem,env(safe-area-inset-bottom))] z-10 flex items-center justify-center gap-[1.5%] text-[clamp(0.48rem,1.9vw,0.66rem)] text-[#8a7d70]">
          <Lock className="h-[clamp(0.7rem,2.6vw,0.9rem)] w-[clamp(0.7rem,2.6vw,0.9rem)]" />
          <span>我們承諾保護你的隱私與資料安全</span>
        </div>

        {/* 金流查核入口保留給鍵盤與輔助技術使用。 */}
        <button
          type="button"
          onClick={onOpenPaymentInfo}
          className="sr-only"
        >
          會員收付資訊
        </button>
      </div>
    </div>
  )
}
