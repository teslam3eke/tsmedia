import { Cpu } from 'lucide-react'
import SupportEmailFooter from '@/components/SupportEmailFooter'

/** 全站維護：白底黑字公告，阻擋新舊使用者進入主流程 */
export default function MaintenanceScreen() {
  return (
    <div className="min-h-dvh bg-white flex flex-col px-6 pt-safe pb-safe text-slate-900">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col justify-center py-10">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center ring-1 ring-slate-200">
            <Cpu className="w-[18px] h-[18px] text-slate-700" />
          </div>
          <p className="font-bold text-[17px] tracking-tight">tsMedia</p>
        </div>

        <h1 className="text-2xl font-black tracking-[-0.03em]">本站暫停開放</h1>

        <div className="mt-6 space-y-4 text-[15px] leading-[1.85] text-slate-900">
          <p>由於女生數量太多，導致男女比例差異懸殊。</p>
          <p>我們將會調整行銷策略並盡速改善，</p>
          <p>現在正在努力抓工程師回來，請稍候。</p>
        </div>

        <SupportEmailFooter className="mt-10 !text-slate-600 [&_a]:!text-slate-900" />
      </div>
    </div>
  )
}
