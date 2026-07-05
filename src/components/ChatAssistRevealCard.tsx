import { getChatAssistPrompt } from '@/utils/chatAssistPrompts'

export default function ChatAssistRevealCard({
  promptId,
  myAnswer,
  peerAnswer,
  peerName,
}: {
  promptId: string
  myAnswer: string
  peerAnswer: string
  peerName: string
}) {
  const prompt = getChatAssistPrompt(promptId)
  const promptText = prompt?.text ?? '聊天小助手'

  return (
    <div className="my-3 flex justify-center px-1">
      <div className="w-full max-w-[92%] rounded-2xl bg-violet-50/95 px-3.5 py-3 ring-1 ring-violet-100">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-500">
          聊天小助手
        </p>
        <p className="mt-1 text-[12px] font-bold leading-snug text-violet-900">{promptText}</p>
        <div className="mt-2.5 space-y-1.5">
          <div className="rounded-xl bg-white/85 px-2.5 py-2 ring-1 ring-violet-100/80">
            <p className="text-[10px] font-bold text-slate-500">你</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-800">
              {myAnswer}
            </p>
          </div>
          <div className="rounded-xl bg-white/85 px-2.5 py-2 ring-1 ring-violet-100/80">
            <p className="text-[10px] font-bold text-slate-500">{peerName}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-800">
              {peerAnswer}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
