import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/supportContact'

export default function SupportEmailFooter({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs leading-relaxed text-slate-500 ${className}`.trim()}>
      客服聯絡信箱：
      <a href={SUPPORT_MAILTO} className="ml-1 font-semibold text-slate-700 underline underline-offset-2">
        {SUPPORT_EMAIL}
      </a>
    </p>
  )
}
