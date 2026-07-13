import { BrandMark } from '@/components/BrandMark'
import SupportEmailFooter from '@/components/SupportEmailFooter'

/** 全站維護：白底黑字公告，阻擋新舊使用者進入主流程 */
export default function MaintenanceScreen() {
  return (
    <div className="min-h-dvh bg-white flex flex-col px-6 pt-safe pb-safe text-slate-900">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col justify-center py-10">
        <div className="flex items-center gap-2.5 mb-8">
          <BrandMark
            framed
            className="w-9 h-9"
            frameClassName="rounded-xl bg-slate-100 ring-1 ring-slate-200 p-1.5"
          />
          <p className="font-bold text-[17px] tracking-tight">tsMedia</p>
        </div>

        <h1 className="text-2xl font-black tracking-[-0.03em]">本站暫停開放</h1>

        <div className="mt-6 space-y-4 text-[15px] leading-[1.85] text-slate-900">
          <p>目前進行內部封測中，預計八月初會與大家見面。</p>
        </div>

        <SupportEmailFooter className="mt-10 !text-slate-600 [&_a]:!text-slate-900" />
      </div>
    </div>
  )
}
