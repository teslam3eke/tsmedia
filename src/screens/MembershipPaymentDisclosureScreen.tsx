import { ChevronLeft, Crown } from 'lucide-react'
import { membershipMonthlyPriceNtd } from '@/lib/membershipProducts'
import SupportEmailFooter from '@/components/SupportEmailFooter'

interface Props {
  onBack: () => void
}

/** 金流審核用：僅展示 30 天 VIP 收付資訊，無購買功能 */
export default function MembershipPaymentDisclosureScreen({ onBack }: Props) {
  const malePrice = membershipMonthlyPriceNtd('male')
  const femalePrice = membershipMonthlyPriceNtd('female')

  return (
    <div className="min-h-dvh flex flex-col bg-[#fafafa]">
      <header className="flex-shrink-0 flex items-center gap-2 border-b border-slate-100 bg-white px-4 pt-safe pb-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 active:bg-slate-200"
          aria-label="返回"
        >
          <ChevronLeft className="h-5 w-5 text-slate-700" />
        </button>
        <h1 className="text-lg font-black tracking-tight text-slate-900">會員收付資訊</h1>
      </header>

      <div
        className="flex-1 overflow-y-auto px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="mx-auto max-w-md space-y-5">
          <p className="text-sm leading-relaxed text-slate-600">
            以下為 tsMedia 網站對外揭露之會員收費項目，供查核參考。本頁僅供資訊展示，無法在此完成付款。
          </p>

          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100">
                <Crown className="h-6 w-6 text-amber-700" aria-hidden />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900">30 天 VIP 月卡</h2>
                <p className="text-xs text-slate-500">單次購買 · 非自動續扣</p>
              </div>
            </div>

            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                <dt className="font-semibold text-slate-700">男性會員</dt>
                <dd className="font-black text-slate-900">NT$ {malePrice}／30 天</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                <dt className="font-semibold text-slate-700">女性會員</dt>
                <dd className="font-black text-slate-900">NT$ {femalePrice}／30 天</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                <dt className="font-semibold text-slate-700">計費週期</dt>
                <dd className="text-right text-slate-800">自付款成功日起算 30 日</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 pb-3">
                <dt className="font-semibold text-slate-700">付款方式</dt>
                <dd className="text-right text-slate-800">信用卡（藍新金流 NewebPay 安全付款頁）</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700">服務內容</dt>
                <dd className="mt-1.5 leading-relaxed text-slate-600">
                  購買後取得 30 天 VIP 會員資格。到期後若需延長，須再次手動購買（系統不會自動扣款）。
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
            <p className="text-xs leading-relaxed text-slate-600">
              <span className="font-bold text-slate-800">退費與取消：</span>
              數位會員服務一經開通即開始計算效期。如有帳務或退費疑問，請來信客服信箱，我們將依平台規範與金流機制協助處理。
            </p>
          </section>

          <section className="rounded-2xl bg-white px-4 py-4 ring-1 ring-slate-100">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">營運資訊</p>
            <p className="mt-2 text-sm font-semibold text-slate-800">tsMedia（Silicon Hearts）</p>
            <p className="mt-1 text-xs text-slate-500">網址：https://www.tsmedia.tw</p>
          </section>

          <SupportEmailFooter className="pt-2 pb-4" />
        </div>
      </div>
    </div>
  )
}
