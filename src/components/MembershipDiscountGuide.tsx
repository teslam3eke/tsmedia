import { ExternalLink, TicketPercent } from 'lucide-react'
import { cn } from '@/lib/utils'

export function MembershipDiscountGuide({
  gender,
  className,
}: {
  gender: 'male' | 'female'
  className?: string
}) {
  const steps = [
    {
      label: '前往 Instagram',
      content: (
        <a
          href="https://www.instagram.com/tsmedia_tw?utm_source=qr"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-black text-[#946a30] underline decoration-[#c8a36d] underline-offset-2"
        >
          @tsmedia_tw
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ),
    },
    {
      label: '點擊「追蹤」',
      content: <span>掌握最新活動消息</span>,
    },
    {
      label: '私訊「折扣碼」',
      content: <span>取得專屬兌換代碼</span>,
    },
  ]

  return (
    <div className={cn('rounded-2xl bg-[#faf5ec] p-3.5 text-left ring-1 ring-[#e4d5bc]', className)}>
      <div className="flex items-center gap-2">
        <TicketPercent className="h-4 w-4 text-[#9b753d]" aria-hidden />
        <p className="text-[12px] font-black tracking-[0.08em] text-[#5f4a2d]">
          {gender === 'male' ? '領取 100 元抵用券' : '免費試用一個月'}
        </p>
      </div>
      <ol className="relative mt-3 space-y-2.5">
        {steps.map((step, index) => (
          <li key={step.label} className="relative flex items-center gap-3">
            {index < steps.length - 1 && (
              <span
                className="absolute left-[13px] top-7 h-[calc(100%+10px)] w-px bg-gradient-to-b from-[#c7a46e] to-[#e6d8c1]"
                aria-hidden
              />
            )}
            <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#c6a264] to-[#9d7740] text-[12px] font-black text-white shadow-sm ring-2 ring-[#f5ecde]">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-black tracking-[0.04em] text-[#574a3b]">
                {step.label}
              </p>
              <p className="mt-0.5 text-[10px] font-medium text-[#8d7e6c]">
                {step.content}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-3 rounded-xl border border-[#e1c99f] bg-gradient-to-r from-[#fffaf1] to-[#f5ead8] px-3 py-2.5 text-center">
        <p className="text-[11px] font-black tracking-[0.04em] text-[#805e2f]">
          完成後即可獲得
          {gender === 'male' ? ' NT$100 會員抵用券' : '免費試用一個月'}
        </p>
      </div>
    </div>
  )
}
