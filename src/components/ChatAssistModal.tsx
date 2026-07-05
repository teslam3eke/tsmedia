import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageSquare, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getChatAssistPrompt } from '@/utils/chatAssistPrompts'
import type { ChatAssistSessionRow } from '@/lib/db'

const MAX_ANSWER_LEN = 500

/** 聊天小助手 modal 專用：iOS 鍵盤彈出時對齊 visualViewport，不影響其他畫面。 */
function useChatAssistViewport(open: boolean) {
  const [keyboardInsetBottom, setKeyboardInsetBottom] = useState(0)
  const [viewportTop, setViewportTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setKeyboardInsetBottom(0)
      setViewportTop(0)
      setViewportHeight(null)
      return
    }

    const vv = window.visualViewport
    const update = () => {
      const layoutH = window.innerHeight
      const vvH = vv?.height ?? layoutH
      const vvTop = vv?.offsetTop ?? 0
      const inset = vv ? Math.max(0, Math.round(layoutH - vvH - vvTop)) : 0
      setKeyboardInsetBottom(inset)
      setViewportTop(vvTop)
      setViewportHeight(vvH)
    }

    update()
    vv?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      vv?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [open])

  return { keyboardInsetBottom, viewportTop, viewportHeight }
}

export default function ChatAssistModal({
  open,
  session,
  peerName,
  onClose,
  onSubmit,
  submitting,
  submitError,
}: {
  open: boolean
  session: ChatAssistSessionRow
  peerName: string
  onClose: () => void
  onSubmit: (text: string) => void | Promise<void>
  submitting?: boolean
  submitError?: string | null
}) {
  const prompt = getChatAssistPrompt(session.prompt_id)
  const promptText = prompt?.text ?? '分享一點關於你的小想法'
  const revealed = session.status === 'revealed'
  const waitingPeer = session.my_submitted && !session.peer_submitted && !revealed
  const answering = !revealed && !session.my_submitted

  const [draft, setDraft] = useState(session.my_answer ?? '')
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const { keyboardInsetBottom, viewportTop, viewportHeight } = useChatAssistViewport(open)
  const keyboardOpen = keyboardInsetBottom > 36

  useEffect(() => {
    if (open) setDraft(session.my_answer ?? '')
  }, [open, session.my_answer, session.id])

  useEffect(() => {
    if (!open || !answering) return
    const el = answerTextareaRef.current
    if (!el) return
    const scrollIntoView = () => {
      el.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
    const t = window.setTimeout(scrollIntoView, 320)
    return () => clearTimeout(t)
  }, [open, answering, keyboardInsetBottom])

  if (typeof document === 'undefined') return null

  const canDismiss = session.my_submitted || revealed
  const mobileSheet = typeof window !== 'undefined' && window.innerWidth < 640
  const sheetMaxHeight =
    viewportHeight != null
      ? mobileSheet && keyboardOpen
        ? `${viewportHeight}px`
        : mobileSheet
          ? `min(${Math.round(viewportHeight * 0.92)}px, 640px)`
          : 'min(92dvh, 640px)'
      : undefined

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-x-0 z-[480] flex flex-col bg-black/45 sm:inset-0 sm:items-center sm:justify-center sm:p-4"
          style={
            mobileSheet
              ? {
                  top: viewportHeight != null ? viewportTop : 0,
                  height: viewportHeight ?? '100dvh',
                  justifyContent: keyboardOpen ? 'flex-start' : 'flex-end',
                }
              : undefined
          }
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-assist-title"
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className={cn(
              'flex w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl sm:rounded-3xl',
              mobileSheet && keyboardOpen ? 'min-h-0 flex-1 rounded-none' : 'rounded-t-3xl',
            )}
            style={{
              maxHeight: sheetMaxHeight,
            }}
          >
            <div
              className={cn(
                'flex-shrink-0 border-b border-slate-100 px-4 pb-3',
                mobileSheet && keyboardOpen
                  ? 'pt-3'
                  : 'pt-[calc(env(safe-area-inset-top,0px)+14px)]',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {!(mobileSheet && keyboardOpen) && (
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-600 shadow-lg shadow-violet-600/25">
                      <MessageSquare className="h-5 w-5 text-white" />
                    </div>
                  )}
                  <p className={cn('text-[10px] font-bold uppercase tracking-[0.18em] text-violet-500', !(mobileSheet && keyboardOpen) && 'mt-2')}>
                    聊天小助手
                  </p>
                  <h2 id="chat-assist-title" className="text-base font-black text-slate-950">
                    同一題，各自回答
                  </h2>
                  {!(mobileSheet && keyboardOpen) && (
                    <p className="mt-1 text-xs text-slate-500">
                      雙方都送出後才會公開答案；完成可各解鎖 3 格拼圖。
                    </p>
                  )}
                </div>
                {canDismiss && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 active:bg-slate-200"
                    aria-label="關閉"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              <div className="rounded-2xl bg-violet-50 px-4 py-3 ring-1 ring-violet-100">
                <p className="text-[13px] font-bold leading-relaxed text-violet-900">{promptText}</p>
              </div>

              {!revealed && !session.my_submitted && (
                <div className="mt-4 space-y-2">
                  <label htmlFor="chat-assist-answer" className="text-xs font-bold text-slate-600">
                    你的回答
                  </label>
                  <textarea
                    ref={answerTextareaRef}
                    id="chat-assist-answer"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, MAX_ANSWER_LEN))}
                    rows={mobileSheet && keyboardOpen ? 3 : 4}
                    placeholder="想到什麼就寫，對方還看不到…"
                    className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[15px] leading-relaxed text-slate-900 outline-none ring-violet-200 focus:border-violet-300 focus:ring-2"
                    style={{ fontSize: '16px' }}
                  />
                  <p className="text-right text-[10px] text-slate-400">
                    {draft.length}/{MAX_ANSWER_LEN}
                  </p>
                  {submitError && (
                    <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                      {submitError}
                    </p>
                  )}
                </div>
              )}

              {waitingPeer && (
                <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-center ring-1 ring-slate-100">
                  <p className="text-sm font-bold text-slate-800">已送出你的回答</p>
                  <p className="mt-1 text-xs text-slate-500">等 {peerName} 也填完，就會公開雙方答案。</p>
                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-left text-[13px] text-slate-700 ring-1 ring-slate-100">
                    {session.my_answer}
                  </div>
                </div>
              )}

              {!session.my_submitted && session.peer_submitted && !revealed && (
                <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-center ring-1 ring-amber-100">
                  <p className="text-sm font-bold text-amber-800">{peerName} 已回答</p>
                  <p className="mt-1 text-xs text-amber-700">輪到你啦，填完就能一起公開。</p>
                </div>
              )}

              {revealed && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                    <Sparkles className="h-4 w-4" />
                    雙方答案公開
                  </div>
                  <AnswerCard label="你" text={session.my_answer ?? '—'} highlight />
                  <AnswerCard label={peerName} text={session.peer_answer ?? '—'} />
                  {session.my_claimed && (
                    <p className="rounded-xl bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700">
                      拼圖獎勵已入帳（+3 格）
                    </p>
                  )}
                </div>
              )}
            </div>

            <div
              className="flex-shrink-0 border-t border-slate-100 bg-white px-4 pt-3"
              style={{
                paddingBottom: keyboardOpen
                  ? '12px'
                  : 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
              }}
            >
              {!revealed && !session.my_submitted ? (
                <button
                  type="button"
                  disabled={!draft.trim() || submitting}
                  onClick={() => void onSubmit(draft.trim())}
                  className={cn(
                    'w-full rounded-2xl py-3.5 text-sm font-bold text-white shadow-lg',
                    draft.trim() && !submitting
                      ? 'bg-violet-600 shadow-violet-600/20 active:bg-violet-700'
                      : 'bg-slate-300 shadow-none',
                  )}
                >
                  {submitting ? '送出中…' : '送出回答'}
                </button>
              ) : canDismiss ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-900/15"
                >
                  {revealed ? '回到聊天' : '先回聊天室等待'}
                </button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function AnswerCard({
  label,
  text,
  highlight,
}: {
  label: string
  text: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-2xl px-4 py-3 ring-1',
        highlight ? 'bg-emerald-50 ring-emerald-100' : 'bg-white ring-slate-100',
      )}
    >
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-900">{text}</p>
    </div>
  )
}
